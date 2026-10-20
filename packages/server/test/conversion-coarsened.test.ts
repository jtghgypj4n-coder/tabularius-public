// The conversion report flags privilege "coarsening" (custom per-layout/value-list/
// script privileges imported at the set's overall level) only for a file that has
// at least one of its own sets — not for every file that has any set, since the
// three built-in sets are uniform and lose nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '@tabularius/store';
import { conversionReport } from '../src/conversion.ts';
import { conversionGuide } from '../src/conversion-guide.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('a file with only built-in sets is not reported as coarsened; adding a custom set flips it', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-coarsen-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    // Charts ships only [Full Access], [Data Entry Only] and [Read-Only Access].
    const before = conversionReport(store);
    assert.equal(before.privileges.coarsened, false, 'built-in-only file is not coarsened');
    assert.doesNotMatch(before.summary, /whole-file level/, 'and gets no whole-file caveat');

    // A custom (non-built-in) set is the only kind that can carry custom privileges.
    store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
    const after = conversionReport(store);
    assert.equal(after.privileges.coarsened, true, 'a custom set makes the file coarsened');
    assert.ok(after.privileges.sets.some((s) => s.name === 'Clerk'), 'the custom set is listed');
    assert.match(after.summary, /whole-file level/, 'and the summary warns about whole-file-level import');
    assert.match(after.summary, /limited by a calculation isn't told apart/, 'and that limited record access is not decoded');
    // The guide says what does come across (per-table and per-field access, printing and exporting) and what doesn't.
    const item = conversionGuide(store).differs.find((d) => d.title === 'Privilege sets');
    assert.match(item?.what ?? '', /^Per-table and per-field record access come across/);
    assert.match(item?.what ?? '', /Per-layout, per-value-list and per-script custom privileges aren't decoded yet/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
