// Server-side scripts (Perform Script on Server, schedules, automations and inbound hooks) wait their turn in one
// queue, first come first served, with at most so many running at once: the greater of 50 and the number of CPU
// cores, as on FileMaker Server 21.1.4 and later. A long-running script can't starve the rest of the server.
//
// The admin console lists what is running, what is waiting and the last runs, each with how long it waited and
// took and how it ended, and can cancel any of them: a waiting one never starts, a running one stops at its next
// step (FileMaker Server's admin console can only disconnect the client).

import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { ScriptError, type ServerQueue, type ServerScriptAbout } from '../../scripts/src/index.ts';
import type { ServerLogs } from './server-logs.ts';

/** A server-side script waiting or running, as the admin console lists it. Names only, never parameters or results. */
export interface QueuedScript {
  id: string;
  file: string;
  script: string;
  account?: string;
  /** What started it: Perform Script on Server, a schedule, an automation or an inbound hook. */
  kind: NonNullable<ServerScriptAbout['kind']>;
  state: 'queued' | 'running';
  queuedAt: string;
  startedAt?: string;
}

/** A finished server-side script. */
export interface FinishedScript extends Omit<QueuedScript, 'state'> {
  /** How long it waited for a turn, and how long it ran. */
  waitMs: number;
  ms: number;
  outcome: 'ok' | 'error' | 'failed' | 'canceled';
  /** Get ( LastError ) at the end, for "error". */
  error?: number;
  canceledBy?: string;
}

/** Thrown to a caller whose script was canceled before it started: FileMaker's "user canceled action". */
export class CanceledError extends Error {
  readonly code = 1;
}

const RECENT = 100;

/** How the script log names each kind of run. */
const LABEL: Record<QueuedScript['kind'], string> = { server: 'Perform Script on Server', schedule: 'Schedule', automation: 'Automation', hook: 'Inbound hook' };
/** Schedules write their own line to the script log. */
const logged = (about: ServerScriptAbout) => about.kind !== 'schedule';

interface Job extends QueuedScript {
  stop: AbortController;
  canceledBy?: string;
  turn?: () => void;
  /** It holds a run slot: given one at once, or handed one when the script before it ended. */
  slot?: boolean;
  queued: number;
  started?: number;
}

/** What one queue holds: what is running and waiting (oldest first), and the last runs (newest first). */
export interface QueueList {
  limit: number;
  running: QueuedScript[];
  queued: QueuedScript[];
  recent: FinishedScript[];
}

export class ScriptQueue implements ServerQueue {
  readonly limit: number;
  readonly pendingLimit: number;
  readonly perProducerLimit: number;
  /** Where server-side scripts that end with an error are logged (ScriptEvent.log). */
  logs?: ServerLogs;
  /** With several workers (cluster.ts): the other workers' queues, and a cancel passed on to them. */
  elsewhere?: { lists: () => QueueList[]; cancel: (id: string, by: string) => void };
  /** Goes up whenever the list changes, so a worker only reports it to the others when it has. */
  version = 0;
  private active = 0;
  private readonly waiting: Job[] = [];
  private readonly jobs = new Map<string, Job>();
  private readonly done: FinishedScript[] = [];

  constructor(limit = Math.max(50, availableParallelism()), pending: { pending?: number; perProducer?: number } = {}) {
    this.limit = limit;
    this.pendingLimit = pending.pending ?? 1000;
    this.perProducerLimit = pending.perProducer ?? 100;
    for (const value of [this.limit, this.pendingLimit, this.perProducerLimit]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid server script queue limit');
    }
  }

  /** Scripts running now, and waiting for a turn. */
  get running(): number {
    return this.active;
  }
  get queued(): number {
    return this.waiting.length;
  }

  /** What is running and waiting (oldest first), and the last runs (newest first). */
  list(): QueueList {
    const shown = (j: Job): QueuedScript => ({
      id: j.id, file: j.file, script: j.script, ...(j.account ? { account: j.account } : {}), kind: j.kind, state: j.state,
      queuedAt: j.queuedAt, ...(j.startedAt ? { startedAt: j.startedAt } : {}),
    });
    const all = [...this.jobs.values()];
    return {
      limit: this.limit,
      running: all.filter((j) => j.state === 'running').map(shown),
      queued: this.waiting.map(shown),
      recent: this.done.slice(),
    };
  }

  /** Every worker's queue together, for the admin console: running and waiting oldest first, the last runs newest first. */
  overview(): QueueList & { workers: number } {
    const lists = [this.list(), ...(this.elsewhere?.lists() ?? [])];
    const by = <K extends 'queuedAt' | 'startedAt'>(k: K, dir: 1 | -1) => (a: { [P in K]?: string }, b: { [P in K]?: string }) => dir * String(a[k] ?? '').localeCompare(String(b[k] ?? ''));
    const at = (x: FinishedScript) => Date.parse(x.startedAt ?? x.queuedAt) + x.ms;
    return {
      workers: lists.length,
      limit: lists.reduce((n, l) => n + l.limit, 0),
      running: lists.flatMap((l) => l.running).sort(by('startedAt', 1)),
      queued: lists.flatMap((l) => l.queued).sort(by('queuedAt', 1)),
      recent: lists.flatMap((l) => l.recent).sort((a, b) => at(b) - at(a)).slice(0, RECENT),
    };
  }

  /**
   * Cancels a script in this worker's queue or another's. False when no queue lists it (it has already ended);
   * another worker's script stops when that worker hears of the cancel, within a moment.
   */
  cancelAnywhere(id: string, by: string): boolean {
    if (this.cancel(id, by)) return true;
    const there = this.elsewhere?.lists().some((l) => [...l.running, ...l.queued].some((j) => j.id === id));
    if (there) this.elsewhere!.cancel(id, by);
    return !!there;
  }

  /**
   * Cancels a waiting or running script: a waiting one is taken out of the line and never starts, a running one
   * stops at its next step. False when there is no such script (it has already ended).
   */
  cancel(id: string, by?: string): boolean {
    const j = this.jobs.get(id);
    if (!j || j.stop.signal.aborted) return false;
    j.canceledBy = by ?? 'an administrator';
    j.stop.abort();
    this.version++;
    // Still in line (not yet handed a slot): take it out and let its run end at once.
    const at = this.waiting.indexOf(j);
    if (at >= 0) {
      this.waiting.splice(at, 1);
      j.turn?.();
    }
    return true;
  }

  run<T>(script: (stop: AbortSignal) => Promise<T>, about?: ServerScriptAbout): Promise<T> {
    // Admission is synchronous so non-waiting scripts receive the same capacity error as waiting callers.
    if (this.active >= this.limit) {
      const file = (about?.file ?? '').toLowerCase();
      const kind = about?.kind ?? 'server';
      const producerPending = this.waiting.filter(j => j.file.toLowerCase() === file && j.kind === kind).length;
      if (this.waiting.length >= this.pendingLimit || producerPending >= this.perProducerLimit) {
        throw new ScriptError(812, 'The server script queue is full; try again after pending scripts finish');
      }
    }
    return this.execute(script, about);
  }

  private async execute<T>(script: (stop: AbortSignal) => Promise<T>, about?: ServerScriptAbout): Promise<T> {
    const now = Date.now();
    const job: Job = {
      id: randomUUID(), file: about?.file ?? '', script: about?.script ?? '', ...(about?.account ? { account: about.account } : {}),
      kind: about?.kind ?? 'server', state: 'queued', queuedAt: new Date(now).toISOString(), queued: now, stop: new AbortController(),
    };
    this.jobs.set(job.id, job);
    this.version++;
    if (this.active >= this.limit) {
      this.waiting.push(job);
      await new Promise<void>((turn) => (job.turn = turn));
    } else {
      this.active++;
      job.slot = true;
    }
    if (job.stop.signal.aborted) {
      // Canceled before it started: it never runs. A slot handed to it just before passes on.
      this.jobs.delete(job.id);
      if (job.slot) this.release();
      this.finish(job, 'canceled');
      throw new CanceledError(`Canceled by ${job.canceledBy} before it started`);
    }
    job.state = 'running';
    this.version++;
    job.started = Date.now();
    job.startedAt = new Date(job.started).toISOString();
    try {
      const r = await script(job.stop.signal);
      const error = (r as { error?: unknown } | undefined)?.error;
      if (about && logged(about) && typeof error === 'number' && error) {
        this.logs?.write('ScriptEvent', 'Error', about.file, `${LABEL[job.kind]} "${about.script}"${about.account ? ` (${about.account})` : ''} ended with error ${error}`);
      }
      this.finish(job, job.stop.signal.aborted ? 'canceled' : typeof error === 'number' && error ? 'error' : 'ok', typeof error === 'number' && error ? error : undefined);
      return r;
    } catch (e) {
      if (about && logged(about)) this.logs?.write('ScriptEvent', 'Error', about.file, `${LABEL[job.kind]} "${about.script}"${about.account ? ` (${about.account})` : ''} failed: ${(e as Error).message}`);
      this.finish(job, job.stop.signal.aborted ? 'canceled' : 'failed');
      throw e;
    } finally {
      this.jobs.delete(job.id);
      this.release();
    }
  }

  /** The next in line takes a slot over, or it comes free. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next.slot = true;
      next.turn!();
    } else this.active--;
  }

  private finish(j: Job, outcome: FinishedScript['outcome'], error?: number): void {
    const end = Date.now();
    const started = j.started ?? end;
    this.done.unshift({
      id: j.id, file: j.file, script: j.script, ...(j.account ? { account: j.account } : {}), kind: j.kind,
      queuedAt: j.queuedAt, ...(j.startedAt ? { startedAt: j.startedAt } : {}),
      waitMs: started - j.queued, ms: end - started, outcome, ...(error ? { error } : {}),
      ...(outcome === 'canceled' && j.canceledBy ? { canceledBy: j.canceledBy } : {}),
    });
    if (this.done.length > RECENT) this.done.length = RECENT;
    this.version++;
  }
}
