// Server settings that change while it runs and that every process of a
// cluster must follow at once: kept in the folder's settings file
// (.openhbam-settings.json, beside the hosted files), which each process
// re-reads when it changes. For now that is the session timeout and "block new users", as FileMaker
// Server's Admin API and admin console set it: while on, nobody starts a new
// session (Data API and web client sign-ins, AI app sign-ins, SQL
// connections); sessions already open carry on, and administrators still sign
// in to the console.

import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { readSettingsObject, SETTINGS_FILE } from './fms-migrate.ts';
import { NOTIFY_ADDRESS, type NotifySettings } from './notifications.ts';

export const DEFAULT_IDLE_MINUTES = 15;
export const MIN_IDLE_MINUTES = 1;
export const DEFAULT_STACK_BELOW = 640;
export const MAX_STACK_BELOW = 10000;
export const MAX_IDLE_MINUTES = 1440;

export class ServerConfig {
  private readonly file: string;
  private readonly dir: string;
  private seen?: { mtimeMs: number; size: number; values: Record<string, unknown> };

  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, SETTINGS_FILE);
  }

  /** Whether new users are refused. */
  blockNewUsers(): boolean {
    return this.values().blockNewUsers === true;
  }

  setBlockNewUsers(on: boolean): void {
    this.write({ blockNewUsers: on || undefined });
  }

  /** Minutes a Data API session may sit idle before it ends (the Admin API's session timeout); the web client follows it unless it has its own. 15 unless set. */
  sessionIdleMinutes(): number {
    const v = this.values().sessionIdleMinutes;
    return typeof v === 'number' && Number.isInteger(v) && v >= MIN_IDLE_MINUTES && v <= MAX_IDLE_MINUTES ? v : DEFAULT_IDLE_MINUTES;
  }

  setSessionIdleMinutes(minutes: number): void {
    if (!Number.isInteger(minutes) || minutes < MIN_IDLE_MINUTES || minutes > MAX_IDLE_MINUTES) {
      throw new RangeError(`the session timeout is a whole number of minutes from ${MIN_IDLE_MINUTES} to ${MAX_IDLE_MINUTES}`);
    }
    this.write({ sessionIdleMinutes: minutes === DEFAULT_IDLE_MINUTES ? undefined : minutes });
  }

  /**
   * The folder backups go to when it was set in the admin console (or came with a migration from FileMaker Server, which
   * writes it relative to the folder); a --backup-dir given at start wins over it. The same key `tabularius serve` reads.
   */
  backupDir(): string | undefined {
    const v = this.values().backupDir;
    return typeof v === 'string' && v ? resolve(this.dir, v) : undefined;
  }

  setBackupDir(dir: string | undefined): void {
    this.write({ backupDir: dir || undefined });
  }

  /** Minutes a web client session may sit idle before it ends: its own setting when one was given, else the Data API's. */
  webSessionIdleMinutes(): number {
    const v = this.values().webSessionIdleMinutes;
    return typeof v === 'number' && Number.isInteger(v) && v >= MIN_IDLE_MINUTES && v <= MAX_IDLE_MINUTES ? v : this.sessionIdleMinutes();
  }

  /** Whether the web client has an idle time of its own, rather than following the Data API's. */
  webSessionIdleIsOwn(): boolean {
    const v = this.values().webSessionIdleMinutes;
    return typeof v === 'number' && Number.isInteger(v) && v >= MIN_IDLE_MINUTES && v <= MAX_IDLE_MINUTES;
  }

  /** Gives the web client its own idle time, or null to have it follow the Data API's again. */
  setWebSessionIdleMinutes(minutes: number | null): void {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < MIN_IDLE_MINUTES || minutes > MAX_IDLE_MINUTES)) {
      throw new RangeError(`the web client's session timeout is a whole number of minutes from ${MIN_IDLE_MINUTES} to ${MAX_IDLE_MINUTES}`);
    }
    this.write({ webSessionIdleMinutes: minutes ?? undefined });
  }

  /** Where server events are emailed, when set. */
  notifications(): NotifySettings | undefined {
    const v = this.values().notifications as Partial<NotifySettings> | undefined;
    return v && typeof v.to === 'string' && NOTIFY_ADDRESS.test(v.to) ? { to: v.to, level: v.level === 'Warning' ? 'Warning' : 'Error' } : undefined;
  }

  setNotifications(settings: NotifySettings | undefined): void {
    if (settings && !NOTIFY_ADDRESS.test(settings.to)) throw new RangeError('that is not an email address');
    this.write({ notifications: settings });
  }

  /**
   * The window width, in points, below which the web client stacks a layout in one column when the layout has no
   * breakpoint of its own (0: layouts only stack where they say so). 640 unless set.
   */
  responsiveStackBelow(): number {
    const v = this.values().responsiveStackBelow;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_STACK_BELOW ? v : DEFAULT_STACK_BELOW;
  }

  setResponsiveStackBelow(width: number | null): void {
    if (width !== null && (!Number.isInteger(width) || width < 0 || width > MAX_STACK_BELOW)) {
      throw new RangeError(`the stacking width is a whole number of points from 0 (never) to ${MAX_STACK_BELOW}`);
    }
    this.write({ responsiveStackBelow: width === null || width === DEFAULT_STACK_BELOW ? undefined : width });
  }

  /** Whether scripts may install plug-in packages (Install Plug-In File). Off until an administrator turns it on. */
  scriptPluginInstall(): boolean {
    return this.values().scriptPluginInstall === true;
  }

  setScriptPluginInstall(on: boolean): void {
    this.write({ scriptPluginInstall: on || undefined });
  }

  /** The file's values, read again only when it changed. Invalid settings are surfaced to the admin caller. */
  private values(): Record<string, unknown> {
    let st;
    try {
      st = statSync(this.file);
    } catch {
      this.seen = undefined;
      return {};
    }
    if (this.seen && this.seen.mtimeMs === st.mtimeMs && this.seen.size === st.size) return this.seen.values;
    const values = readSettingsObject(this.dir);
    this.seen = { mtimeMs: st.mtimeMs, size: st.size, values };
    return values;
  }

  /** Sets some keys (undefined removes one), keeping the rest of the file as it is. */
  private write(changes: Record<string, unknown>): void {
    let current: Record<string, unknown> = {};
    try {
      const v = readJsonStateSync<unknown>(this.file);
      if (v && typeof v === 'object' && !Array.isArray(v)) current = v as Record<string, unknown>;
    } catch (e) {
      // Missing is fine; a file there that isn't JSON is someone's to fix, not to overwrite.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`${SETTINGS_FILE} could not be read: ${(e as Error).message}`);
    }
    updateJsonStateSync<Record<string, unknown>>(this.file, current, (latest) => {
      const next = { ...latest, ...changes };
      for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
      return next;
    }, { mode: 0o600 });
    this.seen = undefined;
  }
}
