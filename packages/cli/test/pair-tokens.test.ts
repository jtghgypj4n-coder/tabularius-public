import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FmpDatabase, BLOCK_SIZE } from '../../fmp12/src/index.ts';
import { decodeCalc } from '../../fmp12/src/calc.ts';
import { pairTokenCalcs, pairTokenFile } from '../src/pair-tokens.ts';

const snippet = (...formulas: string[]) => `<fmxmlsnippet type="FMObjectList">${formulas.map((f, i) => `<CustomFunction id="${i + 1}"><Calculation><![CDATA[${f}]]></Calculation></CustomFunction>`).join('')}</fmxmlsnippet>`;
const str = (s: string) => Buffer.from([0x13, s.length, ...Buffer.from(s).map((c) => c ^ 0x5a), 0]);
const call = (id: string, s: string) => decodeCalc(Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([4]), str(s), Buffer.from([5])])).text;

test('three distinct synthetic token/text pairs produce one unanimous candidate; output contains no calculations', () => {
  const values = ['private-a', 'private-b', 'private-c'];
  const result = pairTokenCalcs(values.map((s) => call('39', s)), snippet(...values.map((s) => `Abs ( "${s}" )`)));
  assert.deepEqual(result.tokens, [{ id: 'fn:0x39', names: [{ name: 'Abs', agreements: 3, independent: 3 }], candidate: 'Abs' }]);
  assert.doesNotMatch(JSON.stringify(result), /private-|Calculation|fmxmlsnippet/);
});

test('unknown XML function and Get names are anonymous in observations and candidates, with stable case-insensitive IDs', () => {
  const privateNames = ['SyntheticPrivateFunction', 'SyntheticPrivateOption'];
  const input = [1, 2, 3].map((n) => `⟨fn:39⟩(${n}) + Get(⟨get:73⟩)`);
  const pair = (names: string[]) => pairTokenCalcs(input, snippet(...[1, 2, 3].map((n) => `${names[0]}(${n}) + Get(${names[1]})`)));
  const result = pair(privateNames);
  assert.deepEqual(pair(privateNames.map((name) => name.toLowerCase())), result);
  assert.deepEqual(pair(privateNames), result);
  assert.equal(result.tokens.length, 2);
  for (const token of result.tokens) {
    assert.equal(token.names.length, 1);
    assert.match(token.names[0].name, /^name#[0-9a-f]{8}$/);
    assert.equal(token.names[0].agreements, 3);
    assert.equal(token.names[0].independent, 3);
    assert.equal(token.candidate, token.names[0].name);
  }
  assert.notEqual(result.tokens[0].candidate, result.tokens[1].candidate);
  for (const name of privateNames) assert.ok(!JSON.stringify(result).toLowerCase().includes(name.toLowerCase()));
});

test('known runtime, FileMaker, plug-in and Get names remain readable regardless of case', () => {
  for (const name of ['Abs', 'aCoS', 'JSONRaw', 'BE_ScriptStepInstall']) {
    const result = pairTokenCalcs(['⟨fn:39⟩(1)'], snippet(`${name}(1)`));
    assert.deepEqual(result.tokens[0].names, [{ name, agreements: 1, independent: 1 }]);
  }
  for (const name of ['currentDATE', 'AccountGroupName', 'LastODBCError']) {
    const result = pairTokenCalcs(['Get(⟨get:73⟩)'], snippet(`Get(${name})`));
    assert.deepEqual(result.tokens[0].names, [{ name, agreements: 1, independent: 1 }]);
  }
});

test('different anonymous names remain conflicting evidence', () => {
  const input = [1, 2, 3].map((n) => `⟨fn:39⟩(${n})`);
  const result = pairTokenCalcs(input, snippet('SyntheticPrivateOne(1)', 'SyntheticPrivateOne(2)', 'SyntheticPrivateOne(3)', 'SyntheticPrivateTwo(1)'));
  assert.equal(result.tokens[0].names.length, 2);
  assert.ok(result.tokens[0].names.every((entry) => /^name#[0-9a-f]{8}$/.test(entry.name)));
  assert.equal(result.tokens[0].candidate, undefined);
});

test('repeated input and repeated occurrences cannot manufacture three independent alignments', () => {
  const calc = call('39', 'a');
  const result = pairTokenCalcs([calc, calc, calc], snippet('Abs("a")', 'Abs ( "a" )', 'Abs("a")'));
  assert.equal(result.tokens[0].candidate, undefined);
  assert.equal(result.tokens[0].names[0].independent, 1);
});

test('case-only changes to Let bindings are not independent evidence', () => {
  const variables = ['ab', 'Ab', 'aB'];
  const result = pairTokenCalcs(variables.map((v) => `Let ( ${v} = "x" ; ⟨fn:39⟩ ( ${v} ) )`), snippet(...variables.map((v) => `Let ( ${v} = "x" ; Abs ( ${v} ) )`)));
  assert.equal(result.tokens[0].names[0].independent, 1);
  assert.equal(result.tokens[0].candidate, undefined);
});

test('three source expressions cannot count the same XML expression three times', () => {
  const result = pairTokenCalcs(['89', 'a2', 'c8'].map((id) => `⟨fn:39⟩("a") + ⟨fn:${id}⟩("a")`), snippet('Abs("a") + Abs("a")'));
  const token = result.tokens.find((t) => t.id === 'fn:0x39')!;
  assert.equal(token.names[0].agreements, 3);
  assert.equal(token.names[0].independent, 1);
  assert.equal(token.candidate, undefined);
});

test('all alignments must agree, including ambiguous equal-shaped formulas', () => {
  const input = ['a', 'b', 'c'].map((s) => call('39', s));
  const result = pairTokenCalcs(input, snippet('Abs("a")', 'Abs("b")', 'Abs("c")', 'Length("a")'));
  assert.equal(result.tokens[0].candidate, undefined);
  assert.deepEqual(result.tokens[0].names.map((n) => n.name), ['Abs', 'Length']);
});

test('an alignment is atomic: mismatched known functions, operators, arities or leaves contribute nothing', () => {
  const result = pairTokenCalcs(['⟨fn:39⟩("a") + Length("b")'], snippet('Abs("a") + Lower("b")', 'Abs("a") - Length("b")', 'Abs("a";1) + Length("b")', 'Abs("c") + Length("b")'));
  assert.deepEqual(result.tokens, [{ id: 'fn:0x39', names: [] }]);
});

test('tree alignment finds nested two-byte tokens, unknown Get and FMDR positions; strings/comments are not evidence', () => {
  const result = pairTokenCalcs(['⟨fn:fb0a⟩(Get(⟨get:73⟩);⟨FMDR:2⟩("x"))', '"⟨fn:89⟩" /* ⟨fn:c8⟩ */'], snippet('Left(Get(CurrentDate);FieldBounds("x"))', '"⟨fn:89⟩"'));
  assert.deepEqual(result.tokens.map((t) => [t.id, t.names[0]?.name]), [['FMDR:2', 'FieldBounds'], ['fn:0xfb0a', 'Left'], ['get:0x73', 'CurrentDate']]);
  assert.ok(result.tokens.every((t) => !t.candidate));
});

test('unsupported XML and malformed input fail with fixed messages, without echoing text', () => {
  assert.throws(() => pairTokenCalcs([], '<FMSaveAsXML File="private-value"/>'), /clipboard XML/);
  assert.throws(() => pairTokenCalcs([], '<fmxmlsnippet><private-value>'), (e: Error) => !e.message.includes('private-value'));
  const result = pairTokenCalcs(['⟨fn:39⟩("private-value"'], snippet('Abs("private-value"'));
  assert.doesNotMatch(JSON.stringify(result), /private-value/);
  assert.equal(result.skipped.decoded, 1);
  assert.equal(result.skipped.xml, 1);
});

test('pair-tokens CLI help documents read-only clipboard inputs', () => {
  const result = spawnSync(process.execPath, ['--no-warnings', 'packages/cli/src/main.ts', 'pair-tokens', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /pair-tokens <file.fmp12> <clipboard.xml>/);
  assert.match(result.stdout, /read-only/i);
  assert.match(result.stdout, /known names, anonymous IDs for other names/);
});

function generatedFile(entries = ['private-a', 'private-b', 'private-c'].map((value) => ({ id: 0x39, value }))): Buffer {
  const bytes = Buffer.alloc(3 * BLOCK_SIZE);
  bytes.set([0, 1, 0, 0, 0, 2, 0, 1, 0, 5, 0, 2, 0, 2, 0xc0]);
  bytes.write('HBAM7', 15, 'ascii');
  bytes[521] = 0x1e;
  bytes.writeUInt32BE(2, BLOCK_SIZE + 8);
  bytes.writeUInt16BE(1, BLOCK_SIZE + 12);
  // Custom function calculations at 16.5.[id].35, token stream in key 5.
  const chunks: number[] = [0x20, 16, 0x20, 5];
  for (const [i, { id, value }] of entries.entries()) {
    const tokens = Buffer.concat([Buffer.from([id, 4]), str(value), Buffer.from([5])]);
    chunks.push(0x20, i + 1, 0x20, 35, 6, 5, tokens.length, ...tokens, 0x40, 0x40);
  }
  bytes.set(chunks, 2 * BLOCK_SIZE + 20);
  return bytes;
}

test('CLI anonymizes three custom-function XML calls while still printing Abs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pair-privacy-'));
  const fmp = join(dir, 'generated.fmp12'), xml = join(dir, 'clipboard.xml');
  const custom = 'SyntheticPrivateCustomFunction';
  const values = ['private-a', 'private-b', 'private-c'];
  try {
    writeFileSync(fmp, generatedFile([...values.map((value) => ({ id: 0x39, value })), { id: 0x89, value: 'public' }]));
    writeFileSync(xml, snippet(...values.map((value) => `${custom}("${value}")`), 'Abs("public")'));
    const result = spawnSync(process.execPath, ['--no-warnings', 'packages/cli/src/main.ts', 'pair-tokens', fmp, xml], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.toLowerCase().includes(custom.toLowerCase()));
    assert.doesNotMatch(result.stdout + result.stderr, /private-|generated\.fmp12|Calculation/);
    const report = JSON.parse(result.stdout);
    const anonymous = report.tokens.find((token: { id: string }) => token.id === 'fn:0x39');
    assert.match(anonymous.candidate, /^name#[0-9a-f]{8}$/);
    assert.deepEqual(anonymous.names, [{ name: anonymous.candidate, agreements: 3, independent: 3 }]);
    assert.deepEqual(report.tokens.find((token: { id: string }) => token.id === 'fn:0x89').names, [{ name: 'Abs', agreements: 1, independent: 1 }]);
  } finally { rmSync(dir, { recursive: true }); }
});

test('pair-tokens reads generated fmp12 and UTF-16 clipboard files without modifying inputs or producing sidecars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pair-tokens-'));
  const fmp = join(dir, 'generated.fmp12'), xml = join(dir, 'clipboard.xml');
  const bytes = generatedFile();
  const xmlBytes = Buffer.from('\ufeff' + snippet(...['private-a', 'private-b', 'private-c'].map((s) => `Abs("${s}")`)), 'utf16le');
  writeFileSync(fmp, bytes);
  writeFileSync(xml, xmlBytes);
  try {
    const result = spawnSync(process.execPath, ['--no-warnings', 'packages/cli/src/main.ts', 'pair-tokens', fmp, xml], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).tokens[0].candidate, 'Abs');
    assert.doesNotMatch(result.stdout + result.stderr, /private-|generated\.fmp12|Calculation/);
    assert.deepEqual(readFileSync(fmp), bytes);
    assert.deepEqual(readFileSync(xml), xmlBytes);
    assert.deepEqual(readdirSync(dir).sort(), ['clipboard.xml', 'generated.fmp12']);
  } finally { rmSync(dir, { recursive: true }); }
});

test('file pairing closes its binary handle on both success and read failure, and masks diagnostics', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pair-lifecycle-'));
  const fmp = join(dir, 'generated.fmp12'), xml = join(dir, 'clipboard.xml');
  writeFileSync(fmp, generatedFile());
  writeFileSync(xml, snippet('Abs("private-a")'));
  const close = FmpDatabase.prototype.close;
  let closes = 0;
  t.mock.method(FmpDatabase.prototype, 'close', function(this: FmpDatabase) { closes++; close.call(this); });
  try {
    pairTokenFile(fmp, xml);
    assert.equal(closes, 1);
    t.mock.method(FmpDatabase.prototype, 'schema', () => { throw new Error('private-value'); }, { getter: true });
    assert.throws(() => pairTokenFile(fmp, xml), /^Error: pair-tokens: could not read or pair definitions$/);
    assert.equal(closes, 2);
  } finally { rmSync(dir, { recursive: true }); }
});
