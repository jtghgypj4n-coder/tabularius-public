// The AI tool for syncing with FileMaker Server: what is set up, what the last check found, and which scheduled
// syncs are waiting for a person. Read-only and for the administrator's own client only; a person settles
// conflicts and starts writes in the admin console's Sync page. Values of records, passwords and password file
// paths are never shown.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callerText } from './fault-log.ts';
import { z } from 'zod';
import type { SyncConsole } from './sync-console.ts';
import type { Schedules } from './schedules.ts';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

/** How many conflicts and log lines are listed per file. */
const LISTED = 20;

/** The server's name without a scheme, path or credentials. */
function serverName(server: string): string {
  try {
    return new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`).host;
  } catch {
    return '(not a valid address)';
  }
}

export function registerSyncTools(server: McpServer, sync: SyncConsole, schedules: Schedules, usable: (database: string) => boolean): void {
  server.registerTool('sync_status', {
    description: 'Where syncing hosted files with FileMaker Server stands: for each file with a sync setup, the FileMaker Server it syncs with, ' +
      'the tables, whether sending and bringing in are allowed, what the latest check found (counts, and records changed on both sides ' +
      'with the fields that differ but not their values), the scheduled syncs, and which of them are waiting on a decision. ' +
      'Read-only: conflicts are settled and writes started by an administrator in the admin console\'s Sync page.',
    inputSchema: {
      database: z.string().optional().describe('Only this hosted file'),
      log: z.boolean().optional().describe(`Also the last ${LISTED} lines of the sync log (what was sent and brought in)`),
    },
    annotations: { readOnlyHint: true },
  }, async ({ database, log }) => {
    try {
      const files = sync.list().filter((o) => usable(o.database) && (!database || o.database.toLowerCase() === database.toLowerCase()));
      if (database && !files.length) return fail(`"${database}" has no sync setup, or isn't open to AI tools`);
      const alerts = schedules.syncAlerts();
      return json({
        files: files.map((o) => ({
          database: o.database,
          server: serverName(o.setup.server),
          remoteDatabase: o.setup.database,
          tables: o.setup.tables.map((t) => t.localTable),
          allowWrites: !!o.setup.allowWrites,
          allowPulls: !!o.setup.allowPulls,
          allowContainers: !!o.setup.allowContainers,
          running: o.running,
          passwordSaved: o.passwordSaved,
          ...(o.last ? {
            last: {
              at: o.last.at,
              trigger: o.last.trigger,
              ...(o.last.error ? { error: o.last.error } : {}),
              ...(o.last.refused ? { refused: o.last.refused } : {}),
              ...(o.last.stopped ? { stopped: o.last.stopped } : {}),
              tables: o.last.tables.map((t) => ({
                table: t.localTable, ...(t.skipped ? { skipped: t.skipped } : {}),
                toSend: t.pendingPushes, toBringIn: t.pendingPulls, sent: t.created + t.updated + t.deleted,
                broughtIn: t.pulled.created + t.pulled.updated + t.pulled.deleted, failed: t.failed.length,
              })),
              conflicts: o.last.conflicts.length + o.last.moreConflicts,
              conflictsListed: o.last.conflicts.slice(0, LISTED).map((c) => ({ table: c.table, uuid: c.uuid, kind: c.kind, fields: c.clashes.map((x) => x.field) })),
            },
          } : {}),
          schedules: schedules.all().filter((s) => s.sync && s.database.toLowerCase() === o.database.toLowerCase()).map((s) => ({
            name: s.name, enabled: s.enabled, mode: s.sync!.write && s.sync!.pull ? 'send and bring in' : s.sync!.write ? 'send' : s.sync!.pull ? 'bring in' : 'check only',
            everyMinutes: s.everyMinutes, ...(s.next ? { next: s.next } : {}),
            ...(s.last ? { lastRun: { at: s.last.at, result: s.last.error ? `error ${s.last.error}` : s.last.result, conflicts: s.last.conflicts ?? 0 } } : {}),
          })),
          ...(log ? { log: sync.logOf(o.database, { limit: LISTED }).map((r) => ({ ...r })) } : {}),
        })),
        waitingOnADecision: alerts.filter((a) => usable(a.database)).map((a) => ({ schedule: a.name, database: a.database, at: a.at, conflicts: a.conflicts, ...(a.problem ? { problem: a.problem } : {}) })),
      });
    } catch (e) {
      return fail(callerText(e));
    }
  });
}
