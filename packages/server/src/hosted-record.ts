// Approval memory for files in a hosted folder. It is local state, never a backup input.
import { closeSync, constants, existsSync, fstatSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const HOSTED_RECORD_FILE = '.openhbam-hosted.json';
export type ApprovalHow = 'first-start' | 'admin' | 'upload' | 'create' | 'restore';
export interface HostedRecord {
  version: 1;
  files: Record<string, { id: string; approvedAt: string; by: string; how: ApprovalHow }>;
}
/** undefined means absent; null means damaged and must never be replaced. */
export function loadHostedRecord(dir: string): HostedRecord | null | undefined {
  const path = join(dir, HOSTED_RECORD_FILE);
  let raw: string;
  try {
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) return null;
      raw = readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
  }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !existsSync(path)) return undefined; return null; }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || Object.keys(record).sort().join(',') !== 'files,version' ||
        !record.files || typeof record.files !== 'object' || Array.isArray(record.files)) return null;
    for (const [name, entry] of Object.entries(record.files)) {
      if (name !== name.toLowerCase() || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      if (Object.keys(item).sort().join(',') !== 'approvedAt,by,how,id' ||
          typeof item.id !== 'string' || !item.id || typeof item.approvedAt !== 'string' ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.approvedAt) ||
          !Number.isFinite(Date.parse(item.approvedAt)) || new Date(item.approvedAt).toISOString() !== item.approvedAt ||
          typeof item.by !== 'string' || !item.by || !['first-start', 'admin', 'upload', 'create', 'restore'].includes(String(item.how))) return null;
    }
    return record as unknown as HostedRecord;
  } catch { return null; }
}

export function vet(record: HostedRecord | null | undefined, name: string, id: string): 'approved' | 'held' | 'unknown-record' {
  if (record === null) return 'unknown-record';
  const key = name.toLowerCase();
  const entry = record && Object.hasOwn(record.files, key) ? record.files[key] : undefined;
  return entry?.id === id ? 'approved' : 'held';
}

function writeRecord(dir: string, record: HostedRecord): void {
  const path = join(dir, HOSTED_RECORD_FILE);
  const temp = path + '.tmp';
  let fd: number | undefined;
  let created = false;
  try {
    rmSync(temp, { force: true });
    fd = openSync(temp, 'wx', 0o600);
    created = true;
    writeSync(fd, JSON.stringify(record) + '\n');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) rmSync(temp, { force: true });
  }
}

/** Synchronous read-modify-write operations form the in-process lock. */
export function approveInRecord(dir: string, name: string, id: string, by: string, how: ApprovalHow): void {
  const record = loadHostedRecord(dir);
  if (record === null) throw new Error(`${HOSTED_RECORD_FILE} is damaged; move it aside to start fresh`);
  const next: HostedRecord = { version: 1, files: Object.assign(Object.create(null) as HostedRecord['files'], record?.files) };
  next.files[name.toLowerCase()] = { id, approvedAt: new Date().toISOString(), by, how };
  writeRecord(dir, next);
}

/** Called once by the leader, after startup conversions and before hosting files. */
export function firstStartRecord(dir: string, files: { name: string; id: string }[]): void {
  if (loadHostedRecord(dir) !== undefined) return;
  const entries: HostedRecord['files'] = Object.create(null) as HostedRecord['files'];
  const now = new Date().toISOString();
  for (const file of files) entries[file.name.toLowerCase()] = { id: file.id, approvedAt: now, by: 'first start', how: 'first-start' };
  writeRecord(dir, { version: 1, files: entries });
}

/** Merge restored stores in one publication, preserving all other approvals. */
export function approveRestoredFiles(dir: string, names: string[], log: (line: string) => void = console.error): void {
  const record = loadHostedRecord(dir);
  if (record === null) {
    log(`${HOSTED_RECORD_FILE} is damaged; restored files are held until an administrator moves it aside and starts fresh`);
    return;
  }
  const files: HostedRecord['files'] = Object.assign(Object.create(null) as HostedRecord['files'], record?.files);
  for (const name of names) {
    const sql = new DatabaseSync(join(dir, name + '.openhbam.sqlite'));
    try {
      const row = sql.prepare("SELECT json FROM _fm_meta WHERE key = 'fileId'").get() as { json: string } | undefined;
      const id = row ? JSON.parse(row.json) as string : randomUUID();
      if (!row) sql.prepare("INSERT INTO _fm_meta (key, json) VALUES ('fileId', ?)").run(JSON.stringify(id));
      files[name.toLowerCase()] = { id, approvedAt: new Date().toISOString(), by: 'restore', how: 'restore' };
    } finally { sql.close(); }
  }
  writeRecord(dir, { version: 1, files });
}
