import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateText } from '../src/index.ts';

test('TrText_GetLine follows the published line and switch examples on generated text', () => {
  const literal = (value: string) => JSON.stringify(value).replaceAll('\\r', '¶');
  for (let count = 1; count <= 40; count++) {
    const source = Array.from({ length: count }, (_, i) => `row-${count}-${i}`).join('\r');
    for (let line = 1; line <= count; line++) {
      const suffix = line < count ? '\r' : '';
      assert.equal(evaluateText(`TrText_GetLine ( ${line} ; ${literal(source)} )`), `row-${count}-${line - 1}${suffix}`);
      assert.equal(evaluateText(`TrText_GetLine ( "-ReturnAtEnd" ; ${line} ; ${literal(source)} )`), `row-${count}-${line - 1}\r`);
    }
  }
  assert.equal(evaluateText('TrText_GetLine ( "-Unused" ; 2 ; "abc\rdef\rghi" )'), 'def\r');
  assert.equal(evaluateText('TrText_GetLine ( "" ; 4 ; "one\r\rthree" )'), '');
  assert.equal(evaluateText('TrText_GetLine ( 2 ; "one\r\rthree" )'), '\r');
  assert.equal(evaluateText('TrText_GetLine ( 0 ; "one" )'), '');
  assert.equal(evaluateText('TrText_GetLine ( 1.5 ; "one" )'), '');
});

test('Dial_CenterPointOfRect supports both documented forms on generated rectangles', () => {
  const literal = (value: string) => JSON.stringify(value).replaceAll('\\r', '¶');
  for (let i = -20; i <= 20; i++) {
    const left = i * 13;
    const top = i * -7;
    const width = Math.abs(i) * 3 + 1;
    const height = Math.abs(i) * 5 + 2;
    const expected = `${left + width / 2}\r${top + height / 2}`;
    assert.equal(evaluateText(`Dial_CenterPointOfRect ( "-Unused" ; ${left} ; ${top} ; ${width} ; ${height} )`), expected);
    assert.equal(evaluateText(`Dial_CenterPointOfRect ( "-Unused" ; ${literal(`${left}\r${top}\r${width}\r${height}`)} )`), expected);
  }
});

test('documented but unsupported vendor calls use the missing-plug-in result', () => {
  for (const name of ['TrText_XML', 'Dial_Dialog', 'Actr_Version', 'TURL_Get', 'Serial_Version']) {
    assert.equal(evaluateText(`${name} ( "" )`), '?', name);
  }
});
