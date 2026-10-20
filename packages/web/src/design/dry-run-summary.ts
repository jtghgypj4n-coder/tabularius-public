// A script dry run summed up in a sentence (script-dry-run.ts shows the records).
import type { ScriptDryRun } from './client.ts';

type Records = ScriptDryRun['changes']['records'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Would create 1 record, change 3 and delete 1", or that it changes nothing. */
export function dryRunSummary(r: ScriptDryRun): string {
  const c = r.changes;
  const count = (k: Records[number]['kind']) => c.records.filter((x) => x.kind === k).length;
  const parts = [[count('create'), 'create'], [count('update'), 'change'], [count('delete'), 'delete']]
    .filter(([n]) => n).map(([n, verb], i) => (i === 0 ? `${verb} ${plural(n as number, 'record')}` : `${verb} ${n}`));
  const said = parts.length ? `It would ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts.at(-1)}` : 'It would change no records';
  const more = c.more ? `, and ${plural(c.more, 'more record')} not listed` : '';
  const emptied = c.truncated.length ? `. It would empty ${c.truncated.map((t) => `${t.table} (${plural(t.records, 'record')})`).join(', ')}` : '';
  const ended = r.ended.error ? `. It stops with error ${r.ended.error}${r.message ? ` (${r.message})` : ''}` : r.ended.result ? `. It ends with the result “${r.ended.result}”` : '';
  const partial = c.incomplete ? '. It changes so much that only its first changes were read, so there is more than this' : '';
  return `${said}${more}${emptied}${ended}${partial}.`;
}
