// MBS ( "List.…" ) against the examples on MBS's own function pages (mbsplugins.eu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';
import { MBS_LIST } from '../src/mbs-list.ts';
import { MbsError } from '../src/mbs-text.ts';

const x = (name: string, ...args: (string | number)[]) => MBS_LIST[name.toLowerCase()](args.map(String));
const L = (s: string) => s.replace(/¶/g, '\r');

test('MBS List: values by index', () => {
  assert.equal(x('List.AddValue', L('Hello¶World'), 'Third'), L('Hello¶World¶Third'));
  assert.equal(x('List.GetValue', L('Hello¶World'), 0), 'Hello');
  assert.equal(x('List.SetValue', L('Hello¶World'), 1, 'Third'), L('Hello¶Third'));
  assert.equal(x('List.SetValue', L('Hello¶World'), 2, 'Third'), L('Hello¶World¶Third'));
  assert.equal(x('List.InsertValue', L('Hello¶World'), 1, 'Third'), L('Hello¶Third¶World'));
  assert.equal(x('List.InsertValue', L('Hello¶World'), 2, 'Third'), L('Hello¶World¶Third'));
  assert.equal(x('List.Remove', L('Hello¶World¶Test'), 1), L('Hello¶Test'));
  assert.throws(() => x('List.GetValue', L('Hello¶World'), 2), MbsError);
  assert.equal(x('List.Find', L('Hello¶World¶Test'), 'World'), 1);
  assert.equal(x('List.Find', L('Hello¶World¶Test'), 'world', 1), 1);
  assert.equal(x('List.Find', L('Hello¶World¶Test'), 'world'), -1);
  assert.equal(x('List.ValueIndex', L('Hello¶1¶2¶3¶World'), 'world'), 4);
  assert.equal(x('List.ValueIndex', L('Hello'), 'x'), '');
  assert.equal(x('List.HasValue', L('1¶2¶3'), '2'), 1);
  assert.equal(x('List.SubList', 'Hello', 0, 1, 1), 'Hello');
  assert.equal(x('List.SubList', L('a¶b¶c¶d¶e'), 0, -1), L('a¶b¶c¶d¶e¶'));
  assert.equal(x('List.SubList', L('a¶b¶c¶d¶e'), 2, 2), L('c¶d¶'));
  assert.equal(x('List.MapEntries', L('1¶2¶3¶4'), L('2¶4'), L('Hello¶World¶Test¶Other'), 1), L('World¶Other'));
});

test('MBS List: matching, columns and counting', () => {
  assert.equal(x('List.MatchesPrefix', L('Hello¶www¶World'), 'w', 1), L('www¶World'));
  assert.equal(x('List.MatchesPostfix', L('Hello¶auto¶World'), 'o', 1), L('Hello¶auto'));
  assert.equal(x('List.MatchesSubString', L('1234¶5678¶12¶34¶5432¶0123¶3'), '12', 0, 1), L('1234¶12¶0123'));
  assert.equal(x('List.MatchesSubString', L('1234¶5678¶12¶34¶5432¶0123¶3'), '12', 4, 1), L('5678¶34¶5432¶3'));
  assert.equal(x('List.ColumnMatchesPrefix', L('1,Hello¶2,auto¶3,World'), ',', 1, 'a', 1), '2,auto');
  assert.equal(x('List.ColumnMatchesPostfix', L('1,Hello¶2,auto¶3,World'), ',', 1, 'o', 1), L('1,Hello¶2,auto'));
  assert.equal(x('List.ColumnMatchesSubString', L('1,Hello¶2,auto¶3,World'), ',', 1, 'el', 0, 1), '1,Hello');
  assert.equal(x('List.GetColumn', L('Hello,123,abc¶World,456,def'), ',', 1, 1), L('123¶456'));
  assert.equal(x('List.DeleteColumn', L('a,b,c¶1,2,3'), ',', 1, 1), L('a,c¶1,3'));
  const t = L('Hello|The|World¶Thats|What|WeMake¶YUPP|Thats|Fun');
  assert.equal(x('List.DeCombine', t, '|', 1, 1, 1), L('The¶What¶Thats'));
  assert.equal(x('List.DeCombine', t, '|', 0, 0, 1), L('Hello¶Thats¶YUPP'));
  assert.equal(x('List.DeCombine', t, '|', 0, 1, 1), L('Hello|The¶Thats|What¶YUPP|Thats'));
  assert.equal(x('List.AndColumn', L('1 test 3¶a b c¶d¶e f'), L('2 test 4¶a f c¶d b'), ' ', 1, 1), L('2 test 4¶a f c¶d b'));
  assert.equal(x('List.CountValues', L('Hello¶World¶Hello')), L('1\tWorld¶2\tHello'));
  assert.equal(x('List.CountValuesMatching', L('1¶2¶3¶4'), '>=', 3), 2);
  assert.equal(x('List.CountValuesMatching', L('10¶20¶300¶40'), '<', 100, 1), 3);
  assert.equal(x('List.IndexOfFirstValueMatching', L('1¶2¶3¶4'), '=', 2), 1);
  assert.equal(x('List.IndexOfFirstValueMatching', L('1¶2¶3¶4'), '>=', 3), 2);
  assert.equal(x('List.IndexOfFirstValueMatching', L('test¶hello_123¶audi 34'), 'prefix', 'hello'), 1);
  assert.equal(x('List.IndexOfFirstValueMatching', L('1¶2'), '=', 9), -1);
  assert.equal(x('List.BestMatch', L('Test¶Hello¶World¶Hallo'), 'Hilo'), 'Hello');
  assert.equal(x('List.BestMatch', L('Test¶World'), 'Hilo'), '');
  assert.equal(x('List.RegExMatch', L('Hello¶Test¶World¶House¶Test'), 'H(.*)o', 0, 0, 1), L('Hello¶House'));
});

test('MBS List: sets, duplicates and cleaning up', () => {
  assert.equal(x('List.And', L('1¶2¶3¶4'), L('3¶4¶5¶6'), 1), L('3¶4'));
  assert.equal(x('List.Or', L('1¶2¶3¶4'), L('3¶4¶5¶6'), 1), L('1¶2¶3¶4¶5¶6'));
  assert.equal(x('List.XOr', L('1¶2¶3¶4'), L('3¶4¶5¶6'), 1), L('1¶2¶5¶6'));
  assert.equal(x('List.Not', L('Abc¶Def¶Ghi¶Jkl'), L('Abc¶Jkl¶Zui¶Edf'), 1), L('Def¶Ghi'));
  assert.equal(x('List.FindUnequals', L('Hello¶World'), L('Hello¶Friends'), 1), L('World¶Friends'));
  assert.equal(x('List.FindUnequals', L('Hello¶World'), L('Hello¶Friends'), 1, 1), 'World');
  assert.equal(x('List.Intersection', 'A', L('B¶A'), L('A¶C')), 'A\r');
  assert.equal(x('List.FindDuplicateItems', L('1¶2¶3¶4¶1¶7¶7¶8¶1'), 1), L('1¶7'));
  assert.equal(x('List.HasDuplicateItems', L('Hello¶Test¶World¶Test')), 1);
  assert.equal(`${x('List.HasDuplicateItems', L('a¶A'), 0)}${x('List.HasDuplicateItems', L('a¶A'), 1)}`, '01');
  assert.equal(x('List.RemoveDuplicateItems', L('Hello¶World¶Hello'), 1), L('Hello¶World'));
  assert.equal(x('List.RemoveDuplicateItems', L('Hello¶World¶Hello'), 1, 1), 'World');
  assert.equal(x('List.RemoveEmptyItems', L('Hello¶¶World'), 1), L('Hello¶World'));
  assert.equal(x('List.RemoveValue', L('Hello¶123¶World¶123¶abc'), '123'), L('Hello¶World¶123¶abc'));
  assert.equal(x('List.RemoveValue', L('Hello¶123¶World¶123¶abc'), '123', 1), L('Hello¶World¶abc'));
  assert.equal(x('List.RemoveValues', L('a¶b¶c¶b¶e¶f'), L('b¶e')), L('a¶c¶f'));
  assert.equal(x('List.RemovePrefix', L('testHello¶Other¶TestWorld'), 'test', 1), L('Hello¶Other¶World'));
  assert.equal(x('List.RemovePrefix', L('testHello¶Other¶TestWorld'), 'test', 1, 1), L('Hello¶Other¶TestWorld'));
  assert.equal(x('List.RemovePostfix', L('Hello?¶Other¶World?'), '?', 1), L('Hello¶Other¶World'));
  assert.equal(x('List.AddPrefix', L('Hello¶World'), '!'), L('!Hello¶!World¶'));
  assert.equal(x('List.AddPostfix', L('Hello¶World'), '!', 1), L('Hello!¶World!'));
  assert.equal(x('List.Trim', L(' Hello ¶\tWith tab \t¶'), 1), L('Hello¶With tab'));
  assert.equal(x('List.Reverse', L('Hello¶World¶Test'), 1), L('Test¶World¶Hello'));
  assert.equal(x('List.CrossProduct', L('Hello¶World'), L('1¶2'), 'before', 'middle', 'after', 1),
    L('beforeHellomiddle1after¶beforeHellomiddle2after¶beforeWorldmiddle1after¶beforeWorldmiddle2after'));
  assert.equal(x('List.CrossProduct', L('Hello¶World'), L('1¶2'), '', '\t', '', 3), L('Hello\t1¶World\t2'));
  assert.equal(String(x('List.Shuffle', L('a¶b¶c¶d¶e¶f'))).split('\r').sort().join(''), 'abcdef');
  assert.equal(x('List.Deserialize', x('List.Serialize', L('Hello¶World¶1234¶Just a test!')), 1), L('Hello¶World¶1234¶Just a test!'));
  assert.throws(() => x('List.Deserialize', 'eA=='), /List.Serialize/);
});

test('MBS List: sorting', () => {
  assert.equal(x('List.Sort', L('1¶555¶7'), 16), L('1¶7¶555¶'));
  assert.equal(x('List.Sort', L('Hello¶World¶Test'), 0, 1), L('Hello¶Test¶World'));
  assert.equal(x('List.Sort', L('Hello¶World¶test'), 0, 1), L('Hello¶World¶test'));
  assert.equal(x('List.Sort', L('Hello¶World¶test'), 1, 1), L('Hello¶test¶World'));
  assert.equal(x('List.Sort', L('Hello¶World¶Test'), 2, 1), L('World¶Test¶Hello'));
  assert.equal(x('List.Sort', L('Hello¶World¶test'), 3, 1), L('World¶test¶Hello'));
  assert.equal(x('List.Sort', L('01.01.2001¶12.04.1981¶01.04.1981¶12.07.1981¶12.01.1981¶23.11.2014'), 4, 1),
    L('12.01.1981¶01.04.1981¶12.04.1981¶12.07.1981¶01.01.2001¶23.11.2014'));
  assert.equal(x('List.Sort', L('01/01/2001¶04/12/1981¶04/01/1981¶07/12/1981¶01/12/1981¶11/23/2014'), 8, 1),
    L('01/12/1981¶04/01/1981¶04/12/1981¶07/12/1981¶01/01/2001¶11/23/2014'));
});

test('MBS List through MBS ( … )', () => {
  assert.equal(evaluateText('MBS ( "List.Find" ; "Hello¶World¶Test" ; "World" ) + 1', {}), '2');
  assert.match(evaluateText('MBS ( "List.CSVSplit" ; "a,b" )', {}), /not available/);
});

test('MBS List.BestMatch refuses a call that would compare too much', () => {
  const v = 'a'.repeat(200);
  assert.throws(() => x('List.BestMatch', Array(5000).fill(v).join('\r'), 'b'.repeat(200)), /at most 100000000/);
  assert.equal(x('List.BestMatch', Array(100).fill(v).join('\r'), v), v);
});
