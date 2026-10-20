import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { jsonStringArray, jsonStringSize } from '../src/text-budget.ts';

// Keep expansion regressions away from the test runner's heap; pass large inputs as fields, not parsed literals.
function isolated(body: string): void {
  const run = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { evaluateText } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
    const ctx = { pluginSession: {} };
    const call = (name, ...args) => {
      ctx.field = ({ field }) => ({ type: 'text', value: String(args[Number(field.slice(1))]) });
      return evaluateText('MBS ( "' + name + '"' + args.map((_, i) => ' ; p' + i).join('') + ' )', ctx);
    };
    ${body}
  `], { timeout: 15_000, encoding: 'utf8', maxBuffer: 32_000 });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 0, run.stderr);
}

for (const name of ['Dictionary.Serialize', 'Dictionary.ToJSON']) {
  test(`MBS output cap: ${name} refuses aggregate values without changing the dictionary`, () => isolated(`
    const value = 'a'.repeat(5000000);
    const ref = call('Dictionary.Create', 'a', value, 'b', value);
    assert.equal(call('Dictionary.Count', ref), '2');
    assert.match(call(${JSON.stringify(name)}, ref), /too large/);
    assert.equal(call('IsError'), '1');
    assert.equal(call('Dictionary.Count', ref), '2');
    assert.equal(call('Dictionary.ValueForKey', ref, 'a'), value);
    assert.equal(call('Dictionary.ValueForKey', ref, 'b'), value);
  `));
}

test('MBS output cap: Dictionary.Serialize counts UTF-8, escaping and base64 padding exactly', () => isolated(`
  const overhead = Buffer.byteLength(JSON.stringify(['openhbam-dictionary-1', [['k', 'text', '', null]]]));
  const ref = call('Dictionary.Create', 'k', 'a'.repeat(6000000 - overhead));
  const encoded = call('Dictionary.Serialize', ref);
  assert.equal(encoded.length, 8000000);
  const back = call('Dictionary.Deserialize', encoded);
  assert.equal(call('Dictionary.ValueForKey', back, 'k').length, 6000000 - overhead);
  assert.equal(call('Dictionary.SetValueForKey', ref, 'k', 'a'.repeat(6000001 - overhead)), 'OK');
  assert.match(call('Dictionary.Serialize', ref), /too large/);
  for (const value of ['€'.repeat(2100000), '\\u0000'.repeat(1000001), '\\ud800'.repeat(1000001)]) {
    assert.equal(call('Dictionary.SetValueForKey', ref, 'k', value), 'OK');
    assert.match(call('Dictionary.Serialize', ref), /too large/);
  }
`));

test('MBS output cap: Dictionary.Serialize counts container base64 before building it', () => isolated(`
  const { MBS_DICT } = await import(${JSON.stringify(new URL('../src/mbs-dict.ts', import.meta.url).href)});
  const scope = {};
  const invoke = (name, values) => MBS_DICT[name]({ values, texts: values.map(v => String(v.value)) }, scope);
  const data = new Uint8Array(4500000);
  const ref = invoke('dictionary.create', [{ type: 'text', value: 'k' }, { type: 'container', value: 'file', data }]);
  assert.throws(() => invoke('dictionary.serialize', [ref]), /too large/);
  assert.deepEqual(invoke('dictionary.valueforkey', [ref, { type: 'text', value: 'k' }]), { type: 'container', value: 'file', data });
  const small = invoke('dictionary.create', [{ type: 'text', value: 'k' }, { type: 'container', value: 'file', data: data.subarray(0, 5) }]);
  const back = invoke('dictionary.deserialize', [invoke('dictionary.serialize', [small])]);
  assert.deepEqual(invoke('dictionary.valueforkey', [back, { type: 'text', value: 'k' }]).data, data.subarray(0, 5));
`));

test('MBS output cap: Dictionary.ToJSON counts formatting, escaped keys and values', () => isolated(`
  const overhead = '{\\n\\t"k": ""\\n}'.length;
  const ref = call('Dictionary.Create', 'k', 'a'.repeat(8000000 - overhead));
  const json = call('Dictionary.ToJSON', ref);
  assert.equal(json.length, 8000000);
  assert.equal(JSON.parse(json).k.length, 8000000 - overhead);
  assert.equal(call('Dictionary.SetValueForKey', ref, 'k', 'a'.repeat(8000001 - overhead)), 'OK');
  assert.match(call('Dictionary.ToJSON', ref), /too large/);
  assert.equal(call('Dictionary.SetValueForKey', ref, 'k', '\\u0000'.repeat(1400000)), 'OK');
  assert.match(call('Dictionary.ToJSON', ref), /too large/);
  const key = '\\u0000'.repeat(1400000);
  const keyed = call('Dictionary.Create', key, 'small');
  assert.match(call('Dictionary.ToJSON', keyed), /too large/);
  assert.match(call('Dictionary.Serialize', keyed), /too large/);
  const lone = call('Dictionary.Create', 'k', '\\ud800'.repeat(8000000 - overhead));
  assert.equal(call('Dictionary.ToJSON', lone).length, 8000000);
`));

for (const name of ['Text.Concat', 'Text.ConcatWithDelimiter']) {
  test(`MBS output cap: ${name} refuses two 5M strings and accepts the exact limit`, () => isolated(`
    const name = ${JSON.stringify(name)};
    const concat = (...parts) => call(name, ...(name.endsWith('Delimiter') ? [''] : []), ...parts);
    assert.match(concat('a'.repeat(5000000), 'b'.repeat(5000000)), /too large/);
    assert.equal(call('IsError'), '1');
    assert.equal(concat('a'.repeat(4000000), 'b'.repeat(4000000)).length, 8000000);
  `));
}

test('MBS output cap: ConcatWithDelimiter counts separators but ignores empty values', () => isolated(`
  const a = 'a'.repeat(4000000), b = 'b'.repeat(3999999);
  assert.equal(call('Text.ConcatWithDelimiter', '-', a, '', b).length, 8000000);
  assert.match(call('Text.ConcatWithDelimiter', '--', a, '', b), /too large/);
  assert.equal(call('Text.ConcatWithDelimiter', 'x'.repeat(8000001), '', ''), '');
`));

const encoders = [
  ['Text.EncodeToBase64', 'a', 6000001, 'UTF-8'],
  ['Text.EncodeToBase64URL', 'a', 6000001, 'UTF-8'],
  ['Text.EncodeToHex', 'é', 2000001, 'UTF-8'],
  ['Text.EncodeToHTML', '<', 2000001],
  ['Text.EncodeToXML', '<', 2000001],
  ['Text.EncodeToURL', '€', 900000, 'UTF-8'],
  ['Text.EncodeURLComponent', '€', 900000, 'UTF-8'],
  ['Text.EncodeToQuotedPrintable', '=', 3000000, 'UTF-8'],
  ['Text.EncodeEmailSubject', 'é', 1400000],
] as const;
for (const [name, character, count, ...options] of encoders) {
  test(`MBS output cap: ${name} refuses expanded output`, () => isolated(`
    assert.match(call(${JSON.stringify(name)}, ${JSON.stringify(character)}.repeat(${count}), ...${JSON.stringify(options)}), /too large/);
    assert.equal(call('IsError'), '1');
  `));
}

test('MBS output cap: binary encoders accept exact boundaries and use encoded byte counts', () => isolated(`
  for (const name of ['Text.EncodeToBase64', 'Text.EncodeToBase64URL']) {
    assert.equal(call(name, 'a'.repeat(6000000), 'UTF-8').length, 8000000);
    assert.equal(call(name, 'a'.repeat(5999999), 'UTF-8').length, name.endsWith('URL') ? 7999999 : 8000000);
    assert.match(call(name, 'a'.repeat(3000001), 'UTF-16'), /too large/);
  }
  assert.equal(call('Text.EncodeToHex', 'é'.repeat(2000000), 'UTF-8').length, 8000000);
  assert.match(call('Text.EncodeToHex', 'a'.repeat(2000001), 'UTF-16BE'), /too large/);
`));

test('MBS output cap: entity encoders accept the boundary, drop controls and count HTML modes', () => isolated(`
  for (const name of ['Text.EncodeToHTML', 'Text.EncodeToXML']) {
    assert.equal(call(name, '\\u0000' + '<'.repeat(2000000)).length, 8000000);
  }
  assert.match(call('Text.EncodeToHTML', 'a'.repeat(1600001), 8), /too large/);
  assert.match(call('Text.EncodeToHTML', 'a'.repeat(1400000), 10), /too large/);
`));

test('MBS output cap: email wrapper, quoted-printable breaks and trailing spaces count', () => isolated(`
  const subject = 'é' + 'a'.repeat(7999982);
  assert.equal(call('Text.EncodeEmailSubject', subject).length, 8000000);
  assert.match(call('Text.EncodeEmailSubject', subject + 'a'), /too large/);
  assert.equal(call('Text.EncodeEmailSubject', 'a'.repeat(8000000)).length, 8000000);
  assert.match(call('Text.EncodeEmailSubject', 'a'.repeat(8000001)), /too large/);
  assert.equal(call('Text.EncodeToQuotedPrintable', 'a'.repeat(7999997) + ' ', 'UTF-8', 9000000).length, 8000000);
  assert.match(call('Text.EncodeToQuotedPrintable', 'a'.repeat(7999998) + ' ', 'UTF-8', 9000000), /too large/);
  assert.match(call('Text.EncodeToQuotedPrintable', 'a'.repeat(4000002), 'UTF-8', 4), /too large/);
`));

test('MBS output cap: URL encoders accept an exact mixed-byte boundary', () => isolated(`
  for (const name of ['Text.EncodeToURL', 'Text.EncodeURLComponent']) {
    const input = '€'.repeat(888888) + 'aaaaaaaa';
    assert.equal(call(name, input, 'UTF-8').length, 8000000);
    assert.match(call(name, input + 'a', 'UTF-8'), /too large/);
  }
`));

test('MBS QuickList: documented aggregate cap refuses SetList without changing values', () => isolated(`
  const ref = call('QuickList.New', 'old');
  const value = 'a'.repeat(4000000);
  assert.equal(call('QuickList.SetList', ref, value + '\\r' + value), 'OK');
  assert.equal(call('QuickList.Count', ref), '2');
  assert.match(call('QuickList.SetList', ref, value + '\\r' + value + 'a'), /too large/);
  assert.equal(call('IsError'), '1');
  assert.equal(call('QuickList.Count', ref), '2');
  assert.equal(call('QuickList.GetValue', ref, 0), value);
  assert.equal(call('QuickList.GetValue', ref, 1), value);
`));

test('JSON sizing matches serialization for escapes, Unicode and lone surrogates', () => {
  const samples = ['', 'plain', '"\\\b\f\n\r\t\u0000\u001f', 'é€😀', '\ud800x\udfff', '\ud800\udfff'];
  for (const s of samples) {
    assert.equal(jsonStringSize(s), JSON.stringify(s).length);
    assert.equal(jsonStringSize(s, 'utf8'), Buffer.byteLength(JSON.stringify(s)));
    assert.equal(jsonStringArray([s]), JSON.stringify([s]));
  }
  assert.equal(jsonStringSize('\ud800', 'utf16', false), 3);
});
