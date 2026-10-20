// MBS ( "QuickList.…" ) against the examples on MBS's own function pages (mbsplugins.eu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';
import { MBS_QUICKLIST } from '../src/mbs-quicklist.ts';
import { MbsError } from '../src/mbs-text.ts';

const L = (s: string) => s.replace(/¶/g, '\r');
const session = () => {
  const scope = {};
  return (name: string, ...args: (string | number)[]) => MBS_QUICKLIST[name.toLowerCase()](args.map(String), scope);
};

test('MBS QuickList: making, adding and reading', () => {
  const x = session();
  const q = x('QuickList.New', L('Hello¶World'));
  assert.equal(q, 12000);
  assert.equal(x('QuickList.New', 'Hello|World', '|'), 12001);
  assert.equal(x('QuickList.GetList', x('QuickList.New', '1\r2\n3\r4')), L('1¶2¶3¶4¶'));
  x('QuickList.AddValue', q, '1234');
  x('QuickList.AddValue', q, '5678');
  assert.equal(x('QuickList.GetList', q), L('Hello¶World¶1234¶5678¶'));
  assert.equal(x('QuickList.GetList', q, 1, ''), 'HelloWorld12345678');
  assert.equal(x('QuickList.GetList', q, 1, ' '), 'Hello World 1234 5678');
  assert.equal(x('QuickList.Count', q), 4);
  assert.equal(x('QuickList.GetValue', q, 1), 'World');
  assert.throws(() => x('QuickList.GetValue', q, 4), MbsError);
  const m = x('QuickList.New');
  x('QuickList.AddValue', m, 'First');
  x('QuickList.AddMultiValue', m, 'Middle', 10);
  x('QuickList.AddValue', m, 'Last');
  assert.equal(x('QuickList.GetList', m, 1), ['First', ...Array(10).fill('Middle'), 'Last'].join('\r'));
  const h = x('QuickList.New');
  x('QuickList.AddMultiValue', h, L('Hello¶World'), 3);
  assert.equal(x('QuickList.GetList', h, 1), L('Hello¶World¶Hello¶World¶Hello¶World'));
  const o = x('QuickList.New', L('1¶2'));
  x('QuickList.AddQuickList', q, o);
  x('QuickList.AddList', o, L('a¶b'));
  assert.equal(x('QuickList.GetList', o, 1), L('1¶2¶a¶b'));
  assert.equal(x('QuickList.SetValue', q, 0, 'Element 0'), 'OK');
  assert.equal(x('QuickList.GetValue', q, 0), 'Element 0');
  const named = x('QuickList.New', 'a', '', 'IDs');
  assert.equal(named, 'IDs');
  assert.equal(x('QuickList.Count', 'IDs'), 1);
  assert.equal(x('QuickList.JSONArray', x('QuickList.New', L('Hello¶World'))), '["Hello", "World"]');
  const j = x('QuickList.New');
  ['{"id": 1}', '{"id": 2}'].forEach((v) => x('QuickList.AddValue', j, v));
  assert.equal(x('QuickList.JoinJSON', j), '[{"id": 1}, {"id": 2}]');
  x('QuickList.AddValue', j, 'nope');
  assert.throws(() => x('QuickList.JoinJSON', j), /not JSON/);
});

test('MBS QuickList: Push, Pop, prefixes and matching', () => {
  const x = session();
  const s = x('QuickList.New');
  x('QuickList.Push', s, 'Hello');
  x('QuickList.Push', s, 'World');
  assert.equal(x('QuickList.Pop', s), 'World');
  assert.equal(x('QuickList.Pop', s), 'Hello');
  assert.equal(x('QuickList.Pop', s), '');
  const p = x('QuickList.New', L('Hello¶World'));
  x('QuickList.AddPrefix', p, '>');
  x('QuickList.AddPostfix', p, '<');
  assert.equal(x('QuickList.GetList', p, 1), L('>Hello<¶>World<'));
  x('QuickList.RemovePrefix', p, '>');
  x('QuickList.RemovePostfix', p, '<');
  assert.equal(x('QuickList.GetList', p, 1), L('Hello¶World'));
  const w = x('QuickList.New', L('Hello¶World¶auto'));
  assert.equal(x('QuickList.MatchesPrefix', w, 'w', 0), 'OK');
  assert.equal(x('QuickList.GetList', w, 1), 'World');
  const n = x('QuickList.New', L('Hello¶World¶auto'));
  x('QuickList.MatchesPrefix', n, 'w', 4);
  assert.equal(x('QuickList.GetList', n, 1), L('Hello¶auto'));
  const sp = x('QuickList.New', L('Hello¶World¶auto'));
  const hits = x('QuickList.MatchesSubString', sp, 'orl', 3);
  assert.equal(x('QuickList.GetList', hits, 1), 'World');
  assert.equal(x('QuickList.GetList', sp, 1), L('Hello¶auto'));
  const c = x('QuickList.New', L('1-a-A¶2-b-B¶3-c-C'));
  x('QuickList.DeleteColumn', c, '-', 1);
  assert.equal(x('QuickList.GetList', c, 1), L('1-A¶2-B¶3-C'));
  const g = x('QuickList.New', L('Hello,123,abc¶World,456,def'));
  assert.equal(x('QuickList.GetList', x('QuickList.GetColumn', g, ',', 1, 1), 1), L('123¶456'));
  assert.equal(x('QuickList.CountValuesMatching', x('QuickList.New', L('1¶2¶3¶4')), '<', 4), 3);
  assert.equal(x('QuickList.IndexOfFirstValueMatching', x('QuickList.New', L('1¶2¶3¶4')), '≥', 4), 3);
  assert.equal(x('QuickList.HasValues', x('QuickList.New', L('Hello¶World¶123')), L('World¶Other¶123')), L('World¶123'));
  assert.equal(x('QuickList.ValueIndex', w, 'WORLD'), 0);
});

test('MBS QuickList: sets, sorting with other lists and references', () => {
  const x = session();
  const l1 = x('QuickList.New', L('a¶b¶c¶d'));
  const l3 = x('QuickList.And', l1, x('QuickList.New', L('a¶d')), 1);
  assert.equal(x('QuickList.GetList', l3, 1), L('a¶d'));
  assert.equal(x('QuickList.GetList', l1, 1), L('a¶b¶c¶d'));
  assert.equal(x('QuickList.Or', l1, x('QuickList.New', L('d¶e'))), 'OK');
  assert.equal(x('QuickList.GetList', l1, 1), L('a¶b¶c¶d¶e'));
  const keys = x('QuickList.New', L('234¶123¶545¶152'));
  const first = x('QuickList.New', L('Bob¶John¶Bill¶Chris'));
  const cities = x('QuickList.New', L('New York¶Santa Clara¶San Francisco¶Atlanta'));
  assert.equal(x('QuickList.SortWith', keys, 0, first, cities), 'OK');
  assert.equal(x('QuickList.GetList', keys, 1), L('123¶152¶234¶545'));
  assert.equal(x('QuickList.GetList', first, 1), L('John¶Chris¶Bob¶Bill'));
  assert.equal(x('QuickList.GetList', cities, 1), L('Santa Clara¶Atlanta¶New York¶San Francisco'));
  const people = x('QuickList.New', L('65412|Schreiber|Klaus¶76542|Abraham|Hermmann¶85112|Behrens|Robert'));
  const names = x('QuickList.DeCombine', people, '|', 1, 1, 1);
  x('QuickList.SortWith', names, 1, people);
  assert.equal(x('QuickList.GetList', people, 1), L('76542|Abraham|Hermmann¶85112|Behrens|Robert¶65412|Schreiber|Klaus'));
  assert.equal(x('QuickList.SubList', people, 1, 1, 0, 1), '85112|Behrens|Robert');
  const ser = x('QuickList.Deserialize', x('QuickList.Serialize', x('QuickList.New', L('Hello¶World¶1234¶Just a test!'))));
  assert.equal(x('QuickList.GetList', ser, 1), L('Hello¶World¶1234¶Just a test!'));
  const r = x('QuickList.New', L('a¶b¶c¶b¶e¶f'));
  x('QuickList.RemoveValues', r, x('QuickList.New', L('b¶e')));
  assert.equal(x('QuickList.GetList', r, 1), L('a¶c¶f'));
  assert.equal(x('QuickList.Release', r), 'OK');
  assert.equal(x('QuickList.Free', l3), 'OK');
  assert.throws(() => x('QuickList.Count', r), /not a QuickList reference/);
  assert.throws(() => x('QuickList.AddMultiValue', x('QuickList.New'), 'x', 6_000_000), /at most/);
});

test('MBS QuickList through MBS ( … ): lists last for the calculation context', () => {
  const c = {};
  assert.equal(evaluateText('Let ( q = MBS ( "QuickList.New" ; "b¶a" ) ; MBS ( "QuickList.Sort" ; q ) & MBS ( "QuickList.GetList" ; q ; 1 ) )', c), 'OKa\rb');
  assert.match(evaluateText('MBS ( "QuickList.CSVSplit" ; "a,b" )', c), /not available/);
});

test('MBS Dictionary.SetQuickList reads key and value lines from a QuickList', () => {
  const c = {};
  assert.equal(evaluateText('Let ( [ q = MBS ( "QuickList.New" ; "Hello=World¶Other=Value" ) ; d = MBS ( "Dictionary.Create" ) ; r = MBS ( "Dictionary.SetQuickList" ; d ; q ; "=" ) ] ; r & MBS ( "Dictionary.ValueForKey" ; d ; "Other" ) )', c), 'OKValue');
});

test('MBS QuickList limits: empty AddMultiValue, the session total, and cheap appends', () => {
  const x = session();
  const e = x('QuickList.New');
  const t0 = Date.now();
  assert.equal(x('QuickList.AddMultiValue', e, '', 1e12), 'OK');
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(x('QuickList.Count', e), 0);
  const a = x('QuickList.New');
  x('QuickList.AddMultiValue', a, 'x', 5_000_000);
  assert.throws(() => x('QuickList.InsertValue', a, 0, 'y'), /at most 5000000/);
  assert.throws(() => x('QuickList.SetValue', a, 5_000_000, 'y'), /at most 5000000/);
  assert.equal(x('QuickList.SetValue', a, 0, 'y'), 'OK');
  const b = x('QuickList.New');
  x('QuickList.AddMultiValue', b, 'x', 5_000_000);
  assert.throws(() => x('QuickList.New', 'one'), /together/);
  assert.throws(() => x('QuickList.AddValue', e, 'one'), /together/);
  assert.throws(() => x('QuickList.Clone', b), /together/);
  x('QuickList.Release', b);
  const t1 = Date.now();
  for (let i = 0; i < 2000; i++) x('QuickList.AddValue', e, 'v');
  assert.ok(Date.now() - t1 < 2000);
});

test('MBS QuickList matching with flag 2 keeps the source when no new list can be made', () => {
  const x = session();
  const src = x('QuickList.New', L('Hello¶World'));
  for (let i = 1; i < 10_000; i++) x('QuickList.New');
  assert.throws(() => x('QuickList.MatchesPrefix', src, 'W', 2), /Too many/);
  assert.equal(x('QuickList.GetList', src, 1), L('Hello¶World'));
});
