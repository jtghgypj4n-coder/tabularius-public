import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStepParams, stepLine, undecodedOptionError, type ParamContext } from '../src/script-params.ts';
import { Node } from '../src/tree.ts';

const ctx: ParamContext = {
  formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined,
  tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined,
};
const record = (stepId: number, flags = 0) => {
  const rec = new Uint8Array(28);
  rec[20] = stepId >> 8;
  rec[21] = stepId & 255;
  rec[26] = flags;
  return rec;
};
const calculations = (slots: number[]) => {
  const tree = new Node();
  for (const slot of slots) {
    const node = new Node();
    node.children.set(5, new Node());
    tree.children.set(slot, node);
  }
  return tree;
};

test('Revert Transaction without option evidence remains unconditional', () => {
  const rec = record(207);
  rec[2] = 129; rec[3] = 10; rec[4] = 99; rec[5] = 12; rec[25] = 2; rec[27] = 128;
  for (const tree of [undefined, new Node()]) {
    const p = decodeStepParams(207, rec, tree, ctx);
    assert.equal(p, undefined);
    assert.equal(stepLine('Revert Transaction', p), 'Revert Transaction');
    assert.equal(undecodedOptionError(207, p), undefined);
  }
});

test('Revert Transaction option flags survive missing or undecodable formulas', () => {
  for (const flags of [0x01, 0x02, 0x03, 0x40]) {
    for (const tree of [undefined, calculations([128])]) {
      for (const formula of [() => undefined, () => { throw new Error('Malformed calculation'); }]) {
        const p = decodeStepParams(207, record(207, flags), tree, { ...ctx, formula });
        assert.ok(p?.undecodedOptions?.length);
        assert.ok(undecodedOptionError(207, p));
        assert.equal(p?.calculation, undefined);
        assert.equal(p?.errorCode, undefined);
        assert.equal(p?.errorMessage, undefined);
      }
    }
  }
});

test('Revert Transaction does not assign unidentified calculation slots', () => {
  for (const slots of [[128], [129], [130], [128, 129, 130]]) {
    const p = decodeStepParams(207, record(207), calculations(slots), { ...ctx, formula: (n) => n ? '0' : undefined });
    assert.deepEqual(Object.keys(p!.slots!).map(Number), slots);
    assert.ok(p?.undecodedOptions?.length);
    assert.equal(p?.calculation, undefined);
    assert.equal(p?.errorCode, undefined);
    assert.equal(p?.errorMessage, undefined);
  }
  const tree = new Node();
  const slot = new Node();
  slot.kv.set(1, Uint8Array.of(0));
  tree.children.set(129, slot);
  assert.ok(decodeStepParams(207, record(207), tree, ctx)?.undecodedOptions?.length, 'raw non-calculation options are retained too');
  assert.ok(decodeStepParams(207, record(207), calculations([64]), ctx)?.undecodedOptions?.length, 'raw calculation nodes outside familiar slots are unresolved too');
});

test('Set Revert Transaction on Error never guesses binary On or Off', () => {
  for (const state of [0, 2]) for (const tree of [undefined, new Node(), calculations([128])]) {
    const rec = record(223); rec[25] = state;
    const p = decodeStepParams(223, rec, tree, ctx);
    assert.deepEqual(p?.undecodedOptions, ['On/Off']);
    assert.equal(p?.on, undefined);
    assert.match(stepLine('Set Revert Transaction on Error', p), /Undecoded options: On\/Off/);
    const readable = decodeStepParams(223, rec, tree, { ...ctx, formula: (n) => n ? '1' : undefined });
    assert.equal(readable?.slots?.[128], tree?.child(128, 5) ? '1' : undefined);
    const failed = decodeStepParams(223, rec, tree, { ...ctx, formula: () => { throw new Error('Malformed state formula'); } });
    assert.deepEqual(failed?.undecodedOptions, ['On/Off']);
  }
});

test('Binary Import Records never invents an action', () => {
  const tree = new Node();
  const source = new Node();
  // One source path, kind "file", empty folder, filename "data.csv".
  source.kv.set(130, Uint8Array.from([0, 0, 0, 1, 4, ...Buffer.from('file').map((b) => b ^ 0x5a), 0, 8, ...Buffer.from('data.csv').map((b) => b ^ 0x5a)]));
  tree.children.set(128, source);
  tree.kv.set(134, Buffer.from('COMS'));
  // Target TO 128, two fields: a known import flag and an unknown flag.
  tree.kv.set(132, Uint8Array.from([2, 1, 128, 0, 0, 2, 0, 2, 2, 1, 1, 0, 2, 1, 2, 99]));
  for (const params of [undefined, tree]) {
    const p = decodeStepParams(35, record(35), params, ctx);
    assert.equal(p?.importAction, undefined);
    assert.deepEqual(p?.undecodedOptions, ['Import mode']);
    assert.match(stepLine('Import Records', p), /Mode: Undecoded/);
    assert.ok(undecodedOptionError(35, p));
  }
  const decoded = decodeStepParams(35, record(35), tree, ctx)!;
  assert.deepEqual(decoded.fieldMapping?.map((m) => m.import), [true, false]);
  assert.deepEqual(decoded.filePaths, ['file:data.csv']);
  const failed = decodeStepParams(35, record(35), tree, { ...ctx, tableOccurrenceName: () => { throw new Error('Bad reference'); } });
  assert.deepEqual(failed?.undecodedOptions, ['Import mode'], 'optional metadata failure must not erase binary provenance');
  assert.equal(undecodedOptionError(35, { ...decoded, importAction: 'add' }), undefined, 'an authored mode repairs the import');
});
