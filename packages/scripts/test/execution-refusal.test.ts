import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, writer } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-execution-refusal-'));
  const stores = ['A', 'B'].map((name) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    const store = new Store(path, name);
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
    for (const account of ['Admin', 'Worker', 'Other']) store.setPassword(account, 'pw', '[Full Access]');
    store.setExternalAccount('Team', '[Full Access]');
    return store;
  });
  const [a, b] = stores;
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  const options = { layout: 'T', account: 'Worker', executionAccount: 'Worker', executionVia: 'Team', privileges: a.privileges('Worker', 'Team') };
  return { a, b, options };
}

for (const capture of ['On', 'Off']) {
  for (const revoked of ['Worker', 'Other', 'Team']) {
    for (const mode of ['wait', 'callback', 'queued']) test(`final server subscript ${mode} refuses ${revoked}, Error Capture ${capture}`, async (t) => {
      const { a, b, options } = setup(t);
      const { recordId } = a.create('T', { Value: 'original' });
      b.applyDesign([{ op: 'createScript', name: 'Child', text: 'New Record/Request\nBeep' }]);
      a.applyDesign([
        // Permit entry so revocation at the child/queue boundary is what refuses execution.
        { op: 'createDataSource', name: 'B', paths: ['file:B'] },
        { op: 'createScript', name: 'Callback', text: 'Set Field [ T::Value ; "callback" ]' },
        { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nRe-Login [ Account Name: "Other" ; Password: "pw" ; With dialog: Off ]\nSet Field [ T::Value ; "pending" ]\nPerform Script on Server [ Specified: By name ; "B::Child" ; Wait for completion: On ]` },
      ]);
      if (mode === 'callback') {
        const last = a.schema.scripts.find((s) => s.name === 'Caller')!.steps.at(-1)!;
        last.params = { ...last.params, callback: { script: { id: a.schema.scripts.find((s) => s.name === 'Callback')!.id, name: 'Callback' } } };
      }
      let revokedAtBoundary = false;
      const create = b.create.bind(b);
      t.mock.method(b, 'create', (...args: Parameters<typeof create>) => {
        const result = create(...args);
        a.setAccountActive(revoked, false);
        revokedAtBoundary = true;
        return result;
      });
      let refusal: unknown;
      const requireActive = a.requireActiveAccount.bind(a);
      t.mock.method(a, 'requireActiveAccount', (...args: Parameters<typeof requireActive>) => {
        try { return requireActive(...args); } catch (e) { refusal = e; throw e; }
      });
      let thrown: unknown;
      try { await writer.run({ owner: 'caller', account: 'Worker' }, () => runScript(a, 'Caller', { ...options,
        profile: { run: () => {}, step: (_file, script, index) => {
          if (script === 'Caller' && index === 2) assert.equal(a.locks.holder('T', recordId)?.owner, 'caller');
        } },
        ...(mode === 'queued' ? { serverQueue: {
        run: async (go) => { a.setAccountActive(revoked, false); revokedAtBoundary = true; return go(); },
      } } : {}) })); } catch (e) { thrown = e; }
      assert.equal(revokedAtBoundary, true);
      assert.equal(a.get('T', recordId).fieldData.Value, 'original', 'the caller must not commit its pending field');
      assert.ok(thrown instanceof StoreError);
      assert.equal(thrown.code, 212);
      assert.equal(thrown, refusal, 'every caller receives the original refusal object');
      assert.deepEqual(b.select('SELECT Value FROM T').rows, mode === 'queued' ? [] : [[null]]);
      assert.equal(a.locks.holder('T', recordId), undefined, 'refusal releases pending record locks');
    });
  }

  test(`final New Record post-step trigger refuses execution, Error Capture ${capture}`, async (t) => {
    const { a, options } = setup(t);
    a.create('T', { Value: 'original' });
    a.applyDesign([
      { op: 'createScript', name: 'Trigger', text: 'Set Field [ T::Value ; "pending" ]\nBeep' },
      { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nNew Record/Request` },
    ]);
    a.applyDesign([{ op: 'updateLayout', layout: 'T', design: { triggers: [{ event: 'OnRecordLoad', scriptId: a.schema.scripts.find((s) => s.name === 'Trigger')!.id, script: 'Trigger' }] } }]);
    let revoked = false;
    let thrown: unknown;
    try {
      await runScript(a, 'Caller', { ...options, debug: async (point) => {
        if (point.script === 'Trigger' && point.index === 1) {
          assert.equal(point.pending().fields.Value, 'pending');
          a.setAccountActive('Worker', false);
          revoked = true;
        }
      } });
    } catch (e) { thrown = e; }
    assert.equal(revoked, true);
    assert.deepEqual(a.select('SELECT Value FROM T').rows, [['original'], [null]], 'the trigger must not commit pending edits');
    assert.ok(thrown instanceof StoreError);
    assert.equal(thrown.code, 212);
  });

  test(`final Data API step preserves a file-guard refusal, Error Capture ${capture}`, async (t) => {
    const { a, options } = setup(t);
    const { recordId } = a.create('T', { Value: 'original' });
    a.applyDesign([{ op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nExecute FileMaker Data API [ Select ; Target: $data ; JSONSetElement ( "{}" ; "layouts" ; "T" ; JSONString ) ]` }]);
    let armed = false, revoked = false;
    const layout = a.layout.bind(a);
    t.mock.method(a, 'layout', (...args: Parameters<typeof layout>) => {
      if (armed) { armed = false; revoked = true; a.setAccountActive('Worker', false); }
      return layout(...args);
    });
    let refusal: unknown, thrown: unknown;
    try {
      await runScript(a, 'Caller', { ...options,
        debug: async (point) => { if (point.index === 2) armed = true; },
        beforeFile: (file) => {
          try { file.requireActiveAccount('Worker'); } catch (e) { refusal = e; throw e; }
        },
      });
    } catch (e) { thrown = e; }
    assert.equal(revoked, true, 'revocation happened inside the Data API request');
    assert.equal(a.get('T', recordId).fieldData.Value, 'original');
    assert.ok(thrown instanceof StoreError);
    assert.equal(thrown.code, 212);
    assert.equal(thrown, refusal);
  });

  test(`unstored ValueListItems preserves a file-guard refusal, Error Capture ${capture}`, async (t) => {
    const { a, b, options } = setup(t);
    const { recordId } = a.create('T', { Value: 'original' });
    b.applyDesign([{ op: 'createValueList', name: 'Items', values: ['remote'] }]);
    a.applyDesign([
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createValueList', name: 'Remote', values: ['fallback'] },
      { op: 'createField', table: 'T', name: 'Calc', kind: 'calculation', calculation: 'ValueListItems ( "" ; "Remote" )', options: { unstored: true } },
      { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nExit Script [ Result: T::Calc ]` },
    ]);
    a.schema.valueLists.find((v) => v.name === 'Remote')!.external = { dataSourceId: a.schema.dataSources[0].id, valueListId: b.schema.valueLists[0].id };
    let refusal: unknown, revoked = false;
    await assert.rejects(writer.run({ owner: 'caller', account: 'Worker' }, () => runScript(a, 'Caller', { ...options,
      beforeFile: (file) => {
        if (file !== b) return;
        b.setAccountActive('Worker', false);
        revoked = true;
        try { b.requireActiveAccount('Worker'); } catch (e) { refusal = e; throw e; }
      },
    })), (e: unknown) => {
      assert.equal(e, refusal, 'the original refusal escapes the unstored calculation');
      assert.ok(e instanceof StoreError);
      assert.equal(e.code, 212);
      return true;
    });
    assert.equal(revoked, true);
    assert.equal(a.get('T', recordId).fieldData.Value, 'original');
    assert.equal(a.locks.holder('T', recordId), undefined);
  });

  for (const formula of ['ExecuteSQL ( "SELECT Value FROM T" ; "" ; "" )', 'BE_FileMakerSQL ( "SELECT Value FROM T" )']) {
    test(`unstored ${formula.split(' ')[0]} preserves a query file-guard refusal, Error Capture ${capture}`, async (t) => {
      const { a, b, options } = setup(t);
      const { recordId } = a.create('T', { Value: 'original' });
      a.applyDesign([
        { op: 'createField', table: 'T', name: 'Calc', kind: 'calculation', calculation: formula, options: { unstored: true } },
        { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nExit Script [ Result: T::Calc ]` },
      ]);
      let refusal: unknown, queried = false;
      const select = a.select.bind(a);
      t.mock.method(a, 'select', (...args: Parameters<typeof select>) => {
        queried = true;
        // A query callback can cross a file boundary while computing its columns.
        a.resolvedFile('B');
        return select(...args);
      });
      await assert.rejects(writer.run({ owner: 'caller', account: 'Worker' }, () => runScript(a, 'Caller', { ...options,
        beforeFile: (file) => {
          if (file !== b) return;
          b.setAccountActive('Worker', false);
          try { b.requireActiveAccount('Worker'); } catch (e) { refusal = e; throw e; }
        },
      })), (e: unknown) => {
        assert.equal(e, refusal, 'query wrappers preserve the original refusal');
        assert.ok(e instanceof StoreError);
        assert.equal(e.code, 212);
        return true;
      });
      assert.equal(queried, true);
      assert.equal(a.get('T', recordId).fieldData.Value, 'original');
      assert.equal(a.locks.holder('T', recordId), undefined);
    });
  }

  test(`evaluateEach preserves an evaluation file-guard refusal, Error Capture ${capture}`, async (t) => {
    const { a, b, options } = setup(t);
    const { recordId } = a.create('T', { Value: 'original' });
    a.applyDesign([{ op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nExit Script [ Result: "done" ]` }]);
    let refusal: unknown, evaluated = false;
    await assert.rejects(writer.run({ owner: 'caller', account: 'Worker' }, () => runScript(a, 'Caller', { ...options,
      profile: { run: () => {}, step: (_file, script, index) => {
        if (script === 'Caller' && index === 2) {
          a.evaluateEach('T', ['Get ( FileName )'], recordId, { get: () => {
            evaluated = true;
            a.resolvedFile('B');
            return undefined;
          } });
        }
      } },
      beforeFile: (file) => {
        if (file !== b) return;
        b.setAccountActive('Worker', false);
        try { b.requireActiveAccount('Worker'); } catch (e) { refusal = e; throw e; }
      },
    })), (e: unknown) => {
      assert.equal(e, refusal);
      assert.ok(e instanceof StoreError);
      assert.equal(e.code, 212);
      return true;
    });
    assert.equal(evaluated, true);
    assert.equal(a.get('T', recordId).fieldData.Value, 'original');
    assert.equal(a.locks.holder('T', recordId), undefined);
  });

  test(`final commit refusal releases record locks, Error Capture ${capture}`, async (t) => {
    const { a, options } = setup(t);
    const { recordId } = a.create('T', { Value: 'original' });
    a.applyDesign([{ op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nExit Script [ Result: "done" ]` }]);
    let refusal: unknown, revoked = false;
    await assert.rejects(writer.run({ owner: 'caller', account: 'Worker' }, () => runScript(a, 'Caller', { ...options,
      profile: { run: () => {}, step: (_file, script, index) => {
        if (script === 'Caller' && index === 2) {
          assert.equal(a.locks.holder('T', recordId)?.owner, 'caller');
          a.setAccountActive('Worker', false);
          revoked = true;
        }
      } },
      beforeFile: (file) => {
        try { file.requireActiveAccount('Worker'); } catch (e) { refusal = e; throw e; }
      },
    })), (e: unknown) => {
      assert.equal(e, refusal);
      assert.ok(e instanceof StoreError);
      assert.equal(e.code, 212);
      return true;
    });
    assert.equal(revoked, true);
    assert.equal(a.get('T', recordId).fieldData.Value, 'original');
    assert.equal(a.locks.holder('T', recordId), undefined, 'a refused final commit releases its pending lock');
  });

  for (const formula of ['BE_FileMakerSQL ( "SELECT Value FROM R" )', 'ExecuteSQL ( "SELECT Value FROM R" ; "" ; "" )', 'Length ( FieldNames ( "" ; "R" ) )']) {
    test(`shared-summary ${formula.split(' ')[0]} refusal rolls back the final commit, Error Capture ${capture}`, async (t) => {
      const { a, b, options } = setup(t);
      b.create('T', { Value: '7' });
      const { recordId } = a.create('T', { Value: 'original' });
      a.applyDesign([
        { op: 'createDataSource', name: 'B', paths: ['file:B'] },
        { op: 'createOccurrence', name: 'R', file: 'B', externalTable: b.schema.tables[0].id },
        { op: 'createField', table: 'T', name: 'Amount', type: 'number', kind: 'calculation', calculation: formula, options: { unstored: true } },
        { op: 'createField', table: 'T', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
        { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nExit Script [ Result: "done" ]` },
      ]);
      a.shareResults();
      assert.ok(a.results, 'shared results are enabled');
      assert.equal(a.warmSummaries('T'), 1);
      const before = a.dataStamp();
      let refusal: unknown, revoked = false;
      await assert.rejects(writer.run({ owner: 'caller', account: 'Worker' }, () => runScript(a, 'Caller', { ...options,
        profile: { run: () => {}, step: (_file, script, index) => {
          if (script === 'Caller' && index === 2) {
            assert.equal(a.locks.holder('T', recordId)?.owner, 'caller');
            b.setAccountActive('Worker', false);
            revoked = true;
          }
        } },
        beforeFile: (file) => {
          try { file.requireActiveAccount('Worker'); } catch (e) { refusal = e; throw e; }
        },
      })), (e: unknown) => {
        assert.equal(e, refusal, 'summary recomputation propagates the original refusal');
        assert.ok(e instanceof StoreError);
        assert.equal(e.code, 212);
        return true;
      });
      assert.equal(revoked, true);
      assert.equal(a.sql.prepare('SELECT Value FROM T WHERE _fm_record_id = ?').get(recordId)?.Value, 'original');
      assert.equal(a.dataStamp(), before, 'the data version rolls back with the record');
      assert.equal(a.sql.isTransaction, false);
      assert.equal(a.locks.holder('T', recordId), undefined, 'a refused summary update releases the pending lock');
    });
  }

  test(`wrong-password Re-Login remains handleable, Error Capture ${capture}`, async (t) => {
    const { a, options } = setup(t);
    const { recordId } = a.create('T', { Value: 'original' });
    a.applyDesign([{ op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nRe-Login [ Account Name: "Other" ; Password: "wrong" ; With dialog: Off ]\nSet Variable [ $bad ; Get ( LastError ) ]\nIf [ $bad = 212 ]\nSet Field [ T::Value ; "handled" ]\nEnd If\nExit Script [ Result: $bad & "|" & Get ( AccountName ) ]` }]);
    const result = await runScript(a, 'Caller', options);
    assert.equal(result.halted, false);
    assert.equal(result.result, '212|Worker');
    assert.equal(a.get('T', recordId).fieldData.Value, 'handled');
  });

  test(`isolation diagnostics do not read child schema after invalidation, Error Capture ${capture}`, async (t) => {
    const { a, b, options } = setup(t);
    a.applyDesign([
      // Reach the child before isolating it, rather than failing on an undeclared source.
      { op: 'createDataSource', name: 'B', paths: ['file:B'] },
      { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nPerform Script [ Specified: By name ; "B::Child" ]` },
    ]);
    b.applyDesign([{ op: 'createScript', name: 'Child', text: 'Close Window [ Name: "B" ; Current file ]\nBeep' }]);
    const schema = b.schema;
    const descriptor = Object.getOwnPropertyDescriptor(b, 'schema')!;
    let isolated = false, reads = 0, readsAtIsolation = -1;
    Object.defineProperty(b, 'schema', { configurable: true, get: () => { reads++; return schema; } });
    t.after(() => Object.defineProperty(b, 'schema', descriptor));
    const result = await runScript(a, 'Caller', { ...options, trace: true,
      beforeFile: (file) => { if (file === b && isolated) throw new StoreError(3, 'B is isolated'); },
      profile: { run: () => {}, enter: () => {}, step: (_file, script, index) => {
        if (script === 'Child' && index === 0) {
          b.setAccountActive('Worker', false);
          isolated = true;
          readsAtIsolation = reads;
        }
      } },
    });
    assert.equal(isolated, true);
    assert.equal(result.error, 3, 'isolation takes precedence over account revocation');
    assert.equal(reads, readsAtIsolation, 'formatting, profiling and tracing must not inspect the isolated child schema');
  });
}
