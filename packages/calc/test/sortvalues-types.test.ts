// SortValues and UniqueValues datatype and locale arguments (Claris Pro Help "SortValues", "UniqueValues").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, NameTable, type CalcContext } from '../src/index.ts';

const ctx: CalcContext = {
  names: new NameTable({ fields: [], occurrences: [] }),
  occurrence: 'T',
  field: () => { throw new Error('no fields'); },
  related: () => [],
  now: () => new Date(2026, 9, 15, 14, 30, 0),
} as never;
const ev = (f: string) => evaluateText(f, ctx).replace(/\r/g, '¶');

test('SortValues: dates and timestamps sort by time, not as text', () => {
  assert.equal(ev('SortValues ( "12/25/2025¶1/5/2026¶3/4/2024" ; 3 )'), '3/4/2024¶12/25/2025¶1/5/2026¶');
  assert.equal(ev('SortValues ( "12/25/2025¶1/5/2026¶3/4/2024" ; -3 )'), '1/5/2026¶12/25/2025¶3/4/2024¶');
  assert.equal(ev('SortValues ( "1/5/2026 1:00:00 PM¶1/5/2026 9:00:00 AM¶12/31/2025 11:00:00 PM" ; 5 )'), '12/31/2025 11:00:00 PM¶1/5/2026 9:00:00 AM¶1/5/2026 1:00:00 PM¶');
});

test('SortValues: times, numbers, text and values that do not read as the type', () => {
  assert.equal(ev('SortValues ( "10:00:00¶9:30:00¶1:15:00" ; 4 )'), '1:15:00¶9:30:00¶10:00:00¶');
  assert.equal(ev('SortValues ( "34¶600¶18¶29" ; -2 )'), '600¶34¶29¶18¶');
  assert.equal(ev('SortValues ( "b¶B¶a" ; 1 )'), 'a¶b¶B¶');
  assert.equal(ev('SortValues ( "b¶a" ; 9 )'), 'a¶b¶', 'an unrecognised type sorts as text');
  assert.equal(ev('SortValues ( "x¶3/4/2024¶1/2/2020" ; 3 )'), '1/2/2020¶3/4/2024¶x¶', 'what is not a date goes last');
});

test('UniqueValues: the type decides which spellings are the same value', () => {
  assert.equal(ev('UniqueValues ( "18¶18.0¶19" ; 2 )'), '18¶19¶');
  assert.equal(ev('UniqueValues ( "3/4/2024¶03/04/2024¶3/5/2024" ; 3 )'), '3/4/2024¶3/5/2024¶');
  assert.equal(ev('UniqueValues ( "9:00:00¶09:00:00 AM¶10:00:00" ; 4 )'), '9:00:00¶10:00:00¶');
  assert.equal(ev('UniqueValues ( "a¶A¶b" )'), 'a¶b¶');
});

test('SortValues and UniqueValues: a named locale is accepted, an unknown one answers ?', () => {
  assert.equal(ev('SortValues ( "b¶a" ; 1 ; "English" )'), 'a¶b¶');
  assert.equal(ev('SortValues ( "b¶a" ; 1 ; "" )'), 'a¶b¶');
  assert.equal(ev('SortValues ( "b¶a" ; 1 ; "Klingon" )'), '?');
  assert.equal(ev('UniqueValues ( "a¶a" ; 1 ; "French" )'), 'a¶');
  assert.equal(ev('UniqueValues ( "a¶a" ; 1 ; "Klingon" )'), '?');
});

test('SortValues sorts text in the order of the locale it is given', () => {
  assert.equal(ev('SortValues ( "zebra¶åre¶apple¶ärlig" ; 1 ; "Swedish_Custom" )'), 'apple¶zebra¶åre¶ärlig¶');
  assert.equal(ev('SortValues ( "zebra¶åre¶apple¶ärlig" ; -1 ; "Swedish_Custom" )'), 'ärlig¶åre¶zebra¶apple¶');
  assert.equal(ev('SortValues ( "zebra¶åre¶apple¶ärlig" )'), 'apple¶åre¶ärlig¶zebra¶');
  assert.equal(ev('SortValues ( "zebra¶åre¶apple¶ärlig" ; 1 ; "English" )'), 'apple¶åre¶ärlig¶zebra¶');
  assert.equal(ev('SortValues ( "中¶一¶大" ; 1 ; "Chinese_Stroke" )'), '一¶大¶中¶');
  assert.equal(ev('SortValues ( "b¶a" ; 1 ; "swedish" )'), 'a¶b¶', 'a name is read without regard to case');
});
