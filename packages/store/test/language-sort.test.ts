// A text field sorts, ranges and groups in the order of its Default language (Manage Database > Fields > Options >
// Storage), the same way through Sort Records, the Data API, a find's < > and ranges, SQL ORDER BY and SortValues.
// The orders are ICU's standing in for Claris's, an approximation that is unverified (docs/sort-languages.md); these
// tests hold the parts that must agree with each other, and a few letters whose place no one disputes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asText } from '@tabularius/calc';
import { SORT_LANGUAGES, sortKey } from '../../calc/src/collation.ts';
import { createStore, Store } from '../src/index.ts';

const WORDS: Record<string, string[]> = {
  Swedish_Custom: ['zebra', 'ärlig', 'åre', 'apple', 'öl', 'vase', 'wasa', 'Zoo', 'ålder'],
  Danish: ['zebra', 'ærø', 'åre', 'øl', 'apple', 'Zoo', 'sø'],
  Norwegian: ['zebra', 'ærlig', 'åre', 'øl', 'apple', 'Zoo'],
  Polish: ['zebra', 'łódź', 'lato', 'ąb', 'ab', 'ac', 'zażółć', 'Zoo'],
  German_Dictionary: ['Müller', 'Muller', 'Mueller', 'Mulaer', 'apple', 'Zoo'],
  German: ['Müller', 'Muller', 'Mueller', 'Mulaer', 'apple', 'Zoo'],
  Spanish: ['ñu', 'nz', 'oa', 'nu', 'apple', 'Zoo'],
  Turkish: ['ı', 'i', 'z', 'ç', 'c', 'ş', 's'],
  Russian: ['яблоко', 'арбуз', 'берег', 'ёж', 'эхо', 'юла'],
  Greek: ['ωμέγα', 'άλφα', 'βήτα', 'γάμμα'],
  Chinese: ['中', '一', '大', '人', '天'],
  Chinese_Stroke: ['中', '一', '大', '人', '天'],
  Korean: ['하나', '가나', '다라', '마바'],
  Hebrew: ['שלום', 'אבא', 'גן', 'דג'],
  Czech: ['zebra', 'čaj', 'cena', 'řeka', 'rak', 'šaty', 'sada'],
  Unicode_Raw: ['zebra', 'Ärlig', 'apple', 'Banana', 'Åre', 'cafe', 'café', 'Zoo'],
};

function withStore(language: string, run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-lang-'));
  try {
    const path = join(dir, 'L.sqlite');
    createStore(path);
    const store = new Store(path, 'L');
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name', type: 'text', options: { indexLanguage: language } }, { name: 'Plain', type: 'text' }, { name: 'N', type: 'number' }] }]);
    run(store);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sorted = (store: Store, fieldName: string, query?: Record<string, string>[], dir = 'ascend'): string[] =>
  store.find('T', { ...(query ? { query } : {}), sort: [{ fieldName, sortOrder: dir }], limit: 100 }).records.map((r) => String(r.fieldData[fieldName]));

test('a field sorts in its language\'s order, others in English order', () => {
  const place = (language: string, words: string[]): string[] => {
    let out: string[] = [];
    withStore(language, (store) => {
      for (const w of words) store.create('T', { Name: w, Plain: w });
      out = sorted(store, 'Name');
      // The field without a language keeps the English order: case and accents do not matter.
      assert.deepEqual(sorted(store, 'Plain'), [...words].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)));
    });
    return out;
  };
  // Letters whose place is the same in every description of the language.
  const swedish = place('Swedish_Custom', WORDS.Swedish_Custom);
  assert.ok(swedish.indexOf('zebra') < swedish.indexOf('åre') && swedish.indexOf('åre') < swedish.indexOf('ärlig') && swedish.indexOf('ärlig') < swedish.indexOf('öl'), swedish.join(' '));
  const danish = place('Danish', WORDS.Danish);
  assert.ok(danish.indexOf('Zoo') < danish.indexOf('ærø') && danish.indexOf('ærø') < danish.indexOf('øl') && danish.indexOf('øl') < danish.indexOf('åre'), danish.join(' '));
  const polish = place('Polish', WORDS.Polish);
  assert.ok(polish.indexOf('lato') < polish.indexOf('łódź') && polish.indexOf('ac') < polish.indexOf('ąb') && polish.indexOf('ąb') < polish.indexOf('zebra'), polish.join(' '));
  const spanish = place('Spanish', WORDS.Spanish);
  assert.ok(spanish.indexOf('nz') < spanish.indexOf('ñu') && spanish.indexOf('ñu') < spanish.indexOf('oa'), spanish.join(' '));
  // English puts å with a; the Unicode and Default settings keep that order.
  assert.deepEqual(place('Unicode_Raw', WORDS.Unicode_Raw), ['apple', 'Åre', 'Ärlig', 'Banana', 'cafe', 'café', 'zebra', 'Zoo']);
  assert.deepEqual(place('English', WORDS.Unicode_Raw), place('Unicode_Standard', WORDS.Unicode_Raw));
  assert.deepEqual(place('Chinese', WORDS.Chinese), ['大', '人', '天', '一', '中'], 'ICU zh approximation; Claris unverified');
  assert.deepEqual(place('Chinese_Stroke', WORDS.Chinese_Stroke), ['一', '人', '大', '中', '天'], 'ICU stroke approximation; Claris unverified');
  // German treats ü as ue in one list (so Müller comes before Mulaer) and as u in the other (after it).
  const phonebook = place('German', WORDS.German);
  assert.ok(phonebook.indexOf('Müller') < phonebook.indexOf('Mulaer'), phonebook.join(' '));
  const dictionary = place('German_Dictionary', WORDS.German_Dictionary);
  assert.ok(dictionary.indexOf('Mueller') < dictionary.indexOf('Mulaer') && dictionary.indexOf('Mulaer') < dictionary.indexOf('Müller'), dictionary.join(' '));
});

test('the language of an unknown name is English; a name is read without regard to case', () => {
  withStore('Klingon', (store) => {
    for (const w of ['zebra', 'Åre', 'apple']) store.create('T', { Name: w });
    assert.deepEqual(sorted(store, 'Name'), ['apple', 'Åre', 'zebra']);
  });
  withStore('swedish_custom', (store) => {
    for (const w of ['zebra', 'Åre', 'apple']) store.create('T', { Name: w });
    assert.deepEqual(sorted(store, 'Name'), ['apple', 'zebra', 'Åre']);
  });
});

test('finds with < > <= >= and ranges agree with the sort order of the same field, in every language', () => {
  for (const { name: language } of SORT_LANGUAGES) {
    const words = WORDS[language] ?? ['zebra', 'apple', 'banana'];
    withStore(language, (store) => {
      // Words the language sorts as equal have no fixed place among themselves: one of each.
      const seen = new Set<string>();
      const distinct = words.filter((w) => !seen.has(sortKey(w, language)) && seen.add(sortKey(w, language)));
      for (const w of distinct) store.create('T', { Name: w });
      const order = sorted(store, 'Name');
      assert.equal(order.length, distinct.length, language);
      // Every pair of bounds, against the position in the sorted list.
      for (let i = 0; i < order.length; i++) {
        const at = (op: string) => sorted(store, 'Name', [{ Name: `${op}${order[i]}` }]);
        assert.deepEqual(at('>='), order.slice(i), `${language}: >=${order[i]}`);
        assert.deepEqual(at('<='), order.slice(0, i + 1), `${language}: <=${order[i]}`);
        assert.deepEqual(at('>'), order.slice(i + 1), `${language}: >${order[i]}`);
        assert.deepEqual(at('<'), order.slice(0, i), `${language}: <${order[i]}`);
        for (let j = i; j < order.length; j++) {
          assert.deepEqual(sorted(store, 'Name', [{ Name: `${order[i]}...${order[j]}` }]), order.slice(i, j + 1), `${language}: ${order[i]}...${order[j]}`);
        }
      }
    });
  }
});

test('SQL ORDER BY on a field uses the same language order as Sort Records', () => {
  withStore('Swedish_Custom', (store) => {
    for (const w of ['zebra', 'åre', 'apple', 'väg']) store.create('T', { Name: w, Plain: w });
    const run = (q: string) => store.calc.executeSQL(q, []).map((r) => asText(r[0]));
    const expected = sorted(store, 'Name');
    assert.deepEqual(run('SELECT Name FROM T ORDER BY Name'), expected);
    assert.deepEqual(run("SELECT Name FROM T WHERE Name <> 'missing' ORDER BY Name"), expected);
    assert.deepEqual(run('SELECT x.Name FROM T AS x ORDER BY x.Name'), expected);
    assert.deepEqual(run('SELECT x."Name" FROM "T" AS x ORDER BY x."Name"'), expected);
    assert.deepEqual(run('SELECT Name FROM T ORDER BY T.Name DESC'), [...expected].reverse());
    assert.deepEqual(run('SELECT UPPER(Name) AS Name FROM T ORDER BY Name'),
      run('SELECT UPPER(Name) AS Name FROM T ORDER BY UPPER(Name)'), 'a projected alias keeps its SQL expression');
    assert.deepEqual(store.select('SELECT Name FROM T ORDER BY Name').rows.map((r) => String(r[0])), expected);
    assert.deepEqual(run('SELECT Plain FROM T ORDER BY Plain'), sorted(store, 'Plain'));
  });
});

test('SQL ORDER BY keeps the field language for an account that sees only part of the table', () => {
  withStore('Swedish_Custom', (store) => {
    for (const w of ['zebra', 'åre', 'apple', 'väg', 'Zoo']) store.create('T', { Name: w, Plain: w });
    store.savePrivilegeSet({
      name: 'Clerk', records: { view: 'Plain <> "none-match"', edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
      tables: { T: { view: 'Plain <> "none-match"', edit: false, create: false, delete: false, fields: { Plain: 'none' } } },
    });
    store.setPassword('clerk', 'pw', 'Clerk');
    const privileges = store.privileges('clerk');
    const names = (q: string, who?: typeof privileges) => store.calc.executeSQL(q, [], who).map((r) => asText(r[0]));
    const expected = sorted(store, 'Name');
    assert.deepEqual(names('SELECT Name FROM T ORDER BY Name'), expected);
    assert.deepEqual(names('SELECT Name FROM T ORDER BY Name', privileges), expected);
    assert.deepEqual(names('SELECT Name FROM T ORDER BY 1', privileges), names('SELECT Name FROM T ORDER BY 1'));
    assert.deepEqual(names('SELECT Name FROM T ORDER BY Name DESC LIMIT 2', privileges), [...expected].reverse().slice(0, 2));
  });
});

test('a sub-summary groups values the field\'s language sorts as equal', () => {
  const group = (language: string, words: string[]): number => {
    let runs = 0;
    withStore(language, (store) => {
      const ids = words.map((w) => store.create('T', { Name: w }).recordId);
      runs = store.groupSummaries('T', ids, ['Name'])[0].length;
    });
    return runs;
  };
  assert.equal(group('French', ['cafe', 'café', 'Café']), 1, 'French sorts them as one value');
  assert.equal(group('Swedish_Custom', ['ar', 'år', 'Är']), 3, 'Swedish has a, å and ä as different letters');
  assert.equal(group('English', ['cafe', 'Cafe']), 1);
  assert.equal(group('English', ['cafe', 'café']), 2, 'English groups keep telling accents apart, as before');
});
