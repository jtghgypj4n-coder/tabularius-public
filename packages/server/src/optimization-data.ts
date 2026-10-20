// What the optimization report finds by reading the records, not only the design: text fields that hold a lot of data
// (often pictures written into text as data: addresses, which are container files in disguise), stored fields that
// are empty in every record (one pass over each big table covers all its fields), and layouts that put unstored
// calculations and summaries in front of a big table.

import type { Field, Table } from '../../fmp12/src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { q } from '../../store/src/import.ts';
import { bytesText, SLOW_RECORDS, type Finding } from './optimization.ts';
import { solutionIndex } from './insight.ts';

/** Text fields holding this much, in all, are worth a line. */
const BIG_TEXT = 5 * 1024 ** 2;
const HUGE_TEXT = 50 * 1024 ** 2;
/** Tables with more records than this aren't read through: a scan would take longer than the report is worth. */
const SCAN_LIMIT = 5_000_000;
/** Fields read in one pass; a table with more than three passes' worth is read for its first ones only. */
const PASS = 80;
const PASSES = 3;
const WHERE = 5;

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const key = (t: Table, f: Field) => `${t.name}::${f.name}`;

/** A stored column of its own: summaries, unstored calculations and globals keep nothing per record. */
const stored = (f: Field) => f.kind !== 'summary' && !(f.kind === 'calculation' && f.options?.unstored) && !f.options?.global && (f.options?.repetitions ?? 1) <= 1;

interface Held { field: Field; filled: number; bytes: number; longest: number; pictureBytes: number; pictures: number }

/** For each stored field of a table: how many records fill it, how many bytes it holds, and how much of that is written-in pictures. */
function held(store: Store, t: Table): Held[] {
  const fields = t.fields.filter(stored).slice(0, PASS * PASSES);
  const out: Held[] = [];
  for (let i = 0; i < fields.length; i += PASS) {
    const part = fields.slice(i, i + PASS);
    const cols = part.map((f, n) => {
      const c = q(f.name);
      const text = f.type === 'text';
      return `count(nullif(${c}, '')) AS f${n}, ` +
        (text ? `coalesce(sum(length(${c})), 0) AS b${n}, coalesce(max(length(${c})), 0) AS m${n}, ` +
          `coalesce(sum(CASE WHEN substr(${c}, 1, 5) = 'data:' THEN length(${c}) ELSE 0 END), 0) AS p${n}, ` +
          `coalesce(sum(substr(${c}, 1, 5) = 'data:'), 0) AS n${n}` : `0 AS b${n}, 0 AS m${n}, 0 AS p${n}, 0 AS n${n}`);
    });
    let row: Record<string, number | bigint>;
    try {
      row = store.sql.prepare(`SELECT ${cols.join(', ')} FROM ${q(t.name)}`).get() as Record<string, number | bigint>;
    } catch {
      continue;
    }
    part.forEach((field, n) => out.push({
      field, filled: Number(row[`f${n}`]), bytes: Number(row[`b${n}`]), longest: Number(row[`m${n}`]),
      pictureBytes: Number(row[`p${n}`]), pictures: Number(row[`n${n}`]),
    }));
  }
  return out;
}

export function dataFindings(store: Store): Finding[] {
  const out: Finding[] = [];
  for (const t of store.schema.tables) {
    const records = store.recordCount(t.name);
    if (records < SLOW_RECORDS || records > SCAN_LIMIT) continue;
    const fields = held(store, t);

    for (const h of fields) {
      if (h.field.type !== 'text' || h.bytes < BIG_TEXT) continue;
      const k = key(t, h.field);
      const inPictures = h.pictureBytes >= h.bytes / 2;
      out.push({
        id: `big-text:${k}`, impact: h.bytes >= HUGE_TEXT ? 'high' : 'medium',
        title: `${inPictures ? 'Pictures and files written into a text field' : 'A text field holding a lot of data'}: ${k}`,
        what: `${plural(h.filled, 'record')} of ${t.name} fill ${k} with ${bytesText(h.bytes)} in all; the longest value is ${bytesText(h.longest)}.` +
          (h.pictures ? ` ${plural(h.pictures, 'value')} start${h.pictures === 1 ? 's' : ''} with "data:": a picture or file written into the text (${bytesText(h.pictureBytes)}).` : ''),
        instead: inPictures
          ? 'These are container files in disguise: they travel with every record that is read, cannot be previewed or streamed, and take a third more room than the files themselves. Put them in a container field, and from there in S3-compatible storage, keeping only a link.'
          : 'Long text, HTML, JSON or logs are read with every record, so layouts, finds and sync all carry them. Keep them in their own related table, so a record is read without them.',
        speed: 'Finds, sorts, layouts and sync read the record without its bulk.',
        ...(h.pictureBytes ? { savesBytes: h.pictureBytes } : {}),
        count: h.filled, where: [k],
      });
    }

    // Stored fields nobody has ever filled in this table (when it is big enough for that to mean something).
    const empty = fields.filter((h) => h.filled === 0);
    if (empty.length) {
      out.push({
        id: `empty-fields:${t.name}`, impact: 'low', title: `Fields empty in every record: ${t.name}`,
        what: `${plural(empty.length, 'field')} in ${t.name} ${empty.length === 1 ? 'is' : 'are'} empty in all ${records.toLocaleString('en-US')} records. They may be filled from outside the file, or by a script that runs rarely.`,
        instead: 'Check what reads or writes them, then remove the ones nothing does: every record, find and export carries them.',
        count: empty.length, where: empty.slice(0, WHERE).map((h) => key(t, h.field)),
      });
    }
  }
  return out;
}

/** A layout over a table this big works out every unstored calculation it shows for each record on screen, and every summary over the found set. */
const SLOW_LAYOUT_RECORDS = 10_000;

/** Layouts of big tables that show unstored calculations or summary fields of that table. */
export function layoutFindings(store: Store): Finding[] {
  const out: Finding[] = [];
  const named = new Map<string, Set<string>>();
  for (const site of solutionIndex(store).sites) {
    const m = /^Layout "(.*?)"(?:,|$)/.exec(site.where);
    if (site.kind !== 'layout' || !m) continue;
    if (!named.has(m[1])) named.set(m[1], new Set());
    for (const k of site.refs.fields) named.get(m[1])!.add(k);
  }
  for (const layout of store.designs().layouts) {
    const home = layout.tableOccurrenceId !== undefined ? store.calc.occurrenceTable(layout.tableOccurrenceId) : undefined;
    if (!home || home.store !== store) continue;
    const records = store.recordCount(home.table.name);
    if (records < SLOW_LAYOUT_RECORDS) continue;
    const slow = [...(named.get(layout.name) ?? [])].flatMap((k) => {
      const [table, name] = k.split('::');
      const f = table === home.table.name ? home.table.fields.find((x) => x.name === name) : undefined;
      return f && (f.kind === 'summary' || (f.kind === 'calculation' && f.options?.unstored)) ? [{ f, k }] : [];
    });
    if (!slow.length) continue;
    out.push({
      id: `slow-layout:${layout.name}`, impact: records >= 50_000 && slow.length >= 5 ? 'high' : 'medium',
      title: `Layout shows unstored calculations over a big table: ${layout.name}`,
      what: `${layout.name} shows ${plural(slow.length, 'unstored calculation or summary field')} of ${home.table.name}, which has ${plural(records, 'record')}. Each is worked out again for every record the layout draws, and a summary over the whole found set every time it is shown.`,
      instead: 'Store the calculations the layout needs (see the suggestions about unstored calculations), move summaries to a footer or a small separate layout, or show only what people need in a list.',
      speed: 'The layout draws and scrolls faster, and opens faster on a large found set.',
      count: slow.length, where: slow.slice(0, WHERE).map((x) => x.k),
    });
  }
  return out;
}
