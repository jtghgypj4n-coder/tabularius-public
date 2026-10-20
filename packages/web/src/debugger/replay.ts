// Time travel in the Script Debugger: a recorded run (the server ran it to the end on a scratch copy, noting where
// it stood before each step) that the debugger steps back and forth through. These helpers read the recording.

export interface RecordChange {
  table: string;
  recordId: number;
  kind: 'create' | 'update' | 'delete';
  fields: { field: string; before: string; after: string }[];
}

export interface RecordedStep {
  script: string;
  index: number;
  line: string;
  stack: { script: string; index: number }[];
  lastError: number;
  layout?: string;
  mode: 'browse' | 'find';
  foundCount: number;
  foundSet: number[];
  recordId?: number;
  variables?: { locals: Record<string, string>; globals: Record<string, string> };
  changes?: RecordChange[];
  edits?: { table: string; recordId?: number; field: string; value: string }[];
  emptied?: { table: string; records: number }[];
}

export interface Recording {
  script: string;
  steps: RecordedStep[];
  done: { result: string; error: number; halted: boolean; steps: number; layout?: string; foundCount: number; recordId?: number; foundSet: number[] };
  stopped?: boolean;
  incomplete?: boolean;
}

/** The variables before step `at`: a step leaves them out when they didn't change since the step before. */
export function variablesAt(rec: Recording, at: number): { locals: Record<string, string>; globals: Record<string, string> } {
  for (let i = Math.min(at, rec.steps.length - 1); i >= 0; i--) {
    const v = rec.steps[i].variables;
    if (v) return v;
  }
  return { locals: {}, globals: {} };
}

/** One change a step made to a field: set (not yet saved), saved, or the record created or deleted with it. */
export interface FieldChange {
  step: number;
  recordId?: number;
  kind: 'set' | 'saved' | 'created' | 'deleted';
  before?: string;
  after: string;
}

/** Every field the run changed ("Table::Field"), with each step that changed it, in order. */
export function fieldChanges(rec: Recording): Map<string, FieldChange[]> {
  const out = new Map<string, FieldChange[]>();
  const add = (key: string, c: FieldChange) => {
    const list = out.get(key) ?? [];
    list.push(c);
    out.set(key, list);
  };
  rec.steps.forEach((s, step) => {
    for (const e of s.edits ?? []) {
      add(`${e.table}::${e.field.replace(/\(1\)$/, '')}`, { step, ...(e.recordId !== undefined ? { recordId: e.recordId } : {}), kind: 'set', after: e.value });
    }
    for (const c of s.changes ?? []) {
      for (const f of c.fields) {
        add(`${c.table}::${f.field}`, {
          step, recordId: c.recordId, kind: c.kind === 'create' ? 'created' : c.kind === 'delete' ? 'deleted' : 'saved',
          before: f.before, after: f.after,
        });
      }
    }
  });
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** A field change in a few words, for the list to jump from. */
export function describeChange(rec: Recording, c: FieldChange): string {
  const s = rec.steps[c.step];
  const where = `Run step ${c.step + 1}, line ${s.index + 1} of ${s.script}`;
  const record = c.recordId !== undefined ? ` record ${c.recordId}` : '';
  const value = (v: string) => (v === '' ? 'empty' : JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v));
  switch (c.kind) {
    case 'set': return `${where}: set${record} to ${value(c.after)}`;
    case 'saved': return `${where}: saved${record}, ${value(c.before ?? '')} → ${value(c.after)}`;
    case 'created': return `${where}: created${record} with ${value(c.after)}`;
    case 'deleted': return `${where}: deleted${record}, which had ${value(c.before ?? '')}`;
  }
}
