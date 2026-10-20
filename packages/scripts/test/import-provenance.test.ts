import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript, setCaptureOnlyDefaults, type RunOptions } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

setCaptureOnlyDefaults(['Held']);
const marker = 'AR07_HELD_MARKER';
const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (id: number, name: string, steps: ScriptStep[]): Script => ({ id, name, steps });
const call = (s: Script) => step(164, 'Perform Script on Server', { script: { id: s.id, name: s.name }, wait: true });

for (const held of ['direct', 'source', 'owner', 'neither'] as const) {
  for (const flow of ['local', 'server-send', 'server-import', 'queued-send', 'queued-import'] as const) {
    for (const channel of ['ai', 'network', 'connection', 'mail'] as const) {
      test(`AR-script-engine-01: ${held}, ${flow}, ${channel}`, async (t) => {
        const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-provenance-'));
        const stores: Store[] = [];
        t.after(() => { for (const s of stores) s.close(); rmSync(dir, { recursive: true }); });
        const make = (name: string) => {
          const path = join(dir, `${name}.sqlite`);
          createStore(path);
          const s = new Store(path, name);
          stores.push(s);
          s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
          return s;
        };
        const destination = make('Destination');
        const source = make(held === 'source' || held === 'direct' ? 'Held_Source' : 'Source');
        const owner = held === 'direct' ? source : make(held === 'owner' ? 'Held_Owner' : 'Owner');
        owner.create('T', { Value: marker });
        if (source !== owner) {
          source.resolveFile = (name) => name === owner.name ? owner : undefined;
          source.applyDesign([
            { op: 'createDataSource', name: owner.name, paths: [`file:${owner.name}`] },
            { op: 'createOccurrence', name: 'External', file: owner.name, externalTable: owner.schema.tables[0].id },
          ]);
        }
        destination.resolveFile = (name) => name === source.name ? source : undefined;
        const imported = step(35, 'Import Records', {
          noDialog: true, importFormat: 'FMPR', filePaths: [`file:${source.name}.fmp12`],
          importSource: { tableOccurrenceId: source.schema.tableOccurrences.find((to) => to.name === (source === owner ? 'T' : 'External'))!.id, fieldIds: [owner.schema.tables[0].fields[0].id] },
        });
        const sent: unknown[] = [];
        const opts: RunOptions = {
          layout: 'T', trace: true, [TEST_ONLY_CUSTOM_FETCH]: true,
          ai: { refusal: () => undefined, generate: async (request) => { sent.push(request); return 'answer'; } },
          network: (async (_url, request) => { sent.push(request?.body); return new Response('answer'); }) as typeof fetch,
          connections: { host: () => 'api.example.com', request: async (_name, request) => { sent.push(new TextDecoder().decode(request.body)); return new Response('answer'); } },
          mail: async (request) => { sent.push(request); },
          ...(flow.startsWith('queued') ? { serverQueue: { run: async (go) => { await new Promise<void>((resolve) => setImmediate(resolve)); return go(); } } } : {}),
        };
        const send = channel === 'ai'
          ? step(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: 'T::Value' }, variable: '$answer' })
          : channel === 'mail'
            ? step(63, 'Send Mail', { mail: { smtp: true, to: '"recipient@example.com"', subject: '"Import"', message: 'T::Value' } })
            : step(160, 'Insert from URL', { variable: '$answer', calculation: channel === 'connection' ? '"connection://test/"' : '"https://api.example.com/"', slots: { 129: '"--data " & T::Value' } });
        const configure = step(212, 'Configure AI Account', { ai: { accountName: '"acct"' } });
        const sendSteps = channel === 'ai' ? [configure, send] : [send];
        const importingOnServer = flow.endsWith('import');
        const sub = script(9001, 'Sub', importingOnServer ? [imported] : sendSteps);
        destination.schema.scripts.push(sub);
        const steps = flow === 'local' ? [imported, ...sendSteps]
          : importingOnServer ? [call(sub), step(23, 'Show All Records'), ...sendSteps]
            : [imported, call(sub)];
        const result = await runScript(destination, script(9000, 'Main', steps), opts);
        assert.deepEqual(destination.query('SELECT Value FROM T').map((row) => row.Value), [marker]);
        if (held === 'neither') {
          assert.equal(result.error, 0, JSON.stringify(result.trace));
          assert.equal(sent.length, 1);
          assert.ok(JSON.stringify(sent).includes(marker));
        } else {
          assert.equal(result.error, 3, JSON.stringify(result.trace));
          assert.deepEqual(sent, []);
        }
      });
    }
  }
}

for (const direction of ['server-to-caller', 'caller-to-server'] as const) {
  test(`AR-script-engine-01: concurrent ${direction}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-concurrent-import-'));
    const stores = ['Destination', 'Held_Source'].map((name) => {
      const path = join(dir, `${name}.sqlite`);
      createStore(path);
      const s = new Store(path, name);
      s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
      return s;
    });
    t.after(() => { for (const s of stores) s.close(); rmSync(dir, { recursive: true }); });
    const [destination, source] = stores;
    source.create('T', { Value: marker });
    destination.resolveFile = (name) => name === source.name ? source : undefined;
    const imported = step(35, 'Import Records', {
      importFormat: 'FMPR', filePaths: [`file:${source.name}.fmp12`],
      importSource: { tableOccurrenceId: source.schema.tableOccurrences[0].id, fieldIds: [source.schema.tables[0].fields[0].id] },
    });
    const send = [
      step(212, 'Configure AI Account', { ai: { accountName: '"acct"' } }),
      step(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: 'T::Value' }, variable: '$answer' }),
    ];
    const fromServer = direction === 'server-to-caller';
    const sub = script(9001, 'Sub', fromServer ? [imported] : send);
    destination.schema.scripts.push(sub);
    const launched = step(164, 'Perform Script on Server', { script: { id: sub.id, name: sub.name }, wait: false });
    const main = script(9000, 'Main', fromServer ? [launched, step(23, 'Show All Records'), ...send]
      : [launched, imported, step(103, 'Exit Script')]);
    let release!: () => void, reached!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { reached = resolve; });
    let serverError: number | undefined;
    let running: Promise<unknown> | undefined;
    const sent: unknown[] = [];
    try {
      const result = await runScript(destination, main, {
        layout: 'T', ai: { refusal: () => undefined, generate: async (request) => { sent.push(request); return 'answer'; } },
        serverQueue: { run: (go) => {
          const work = (async () => {
            if (!fromServer) await barrier;
            try {
              const result = await go();
              serverError = (result as { error: number }).error;
              reached();
              if (fromServer) await barrier;
              return result;
            } finally { reached(); }
          })();
          running = work;
          return work;
        } },
        debug: async (point) => {
          if (point.index !== (fromServer ? 1 : 2)) return;
          if (!fromServer) release();
          await ready;
        },
      });
      assert.deepEqual(destination.query('SELECT Value FROM T').map((row) => row.Value), [marker]);
      assert.equal(fromServer ? result.error : serverError, 3);
      assert.deepEqual(sent, []);
    } finally {
      release();
      await running;
    }
  });
}
