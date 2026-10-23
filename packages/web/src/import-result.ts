export interface ImportResultSummaryInput {
  imported: number;
  updated?: number;
  skipped: { row: number; why: string }[];
  blankRows?: number;
  headerRows?: number;
  pendingApproval?: number;
}

function reasonCategory(why: string): [string, string] {
  if (/^same as row \d+$/.test(why)) return ['repeated row', 'repeated rows'];
  if (/^same as record \d+$/.test(why)) return ['row matching an existing record', 'rows matching existing records'];
  if (/couldn't be fixed|could not be fixed|invalid|not valid|not a number|not a date|not a time|not an option/i.test(why) || /^[^:]+:/.test(why)) return ['row with a value that could not be fixed', 'rows with a value that could not be fixed'];
  if (why === 'matches no record in the found set') return ['row matching no record', 'rows matching no record'];
  if (why === 'more rows than records in the found set') return ['row beyond the found set', 'rows beyond the found set'];
  return ['other row', 'other rows'];
}

function countPhrase(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function importResultSummary(result: ImportResultSummaryInput): string {
  const skipped = result.skipped.length;
  const updated = result.updated === undefined ? '' : `; ${countPhrase(result.updated, 'record')} updated`;
  const reasons = new Map<string, { plural: string; count: number }>();
  for (const row of result.skipped) {
    const [singular, plural] = reasonCategory(row.why);
    const current = reasons.get(singular);
    reasons.set(singular, { plural, count: (current?.count ?? 0) + 1 });
  }
  const details = [...reasons].map(([singular, { plural, count }]) => `${count} ${count === 1 ? singular : plural}`).join(', ');
  const leftOut = `; ${countPhrase(skipped, 'row')} left out${details ? ` (${details})` : ''}`;
  const blank = result.blankRows ? `; ${countPhrase(result.blankRows, 'blank row')} added nothing` : '';
  const header = result.headerRows ? `; ${countPhrase(result.headerRows, 'header row')} used for column names` : '';
  const pending = result.pendingApproval ? `; ${countPhrase(result.pendingApproval, 'record')} waiting for approval` : '';
  const verb = result.updated === undefined ? 'Imported' : 'Added';
  return `${verb} ${countPhrase(result.imported, 'record')}${updated}${leftOut}${blank}${header}${pending}.`;
}

export function importSkippedRows(skipped: { row: number; why: string }[], limit = 200): { rows: { row: number; why: string }[]; remaining: number; more: string } {
  const remaining = Math.max(0, skipped.length - limit);
  return { rows: skipped.slice(0, limit), remaining, more: remaining ? `and ${remaining} more` : '' };
}
