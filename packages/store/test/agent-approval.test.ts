// Approval-gated AI agents: when an agent is set to need approval, its record
// create/update/delete are recorded as proposals (PendingApprovalError, nothing
// changes) for a human to approve — which replays them as the agent, with the
// agent's own privileges — or reject. Portal and container writes are refused
// outright while gated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrites, importFmp12, Store, PendingApprovalError } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function agentSet(store: Store): string {
  store.savePrivilegeSet({
    name: 'Bot',
    records: { view: true, edit: true, create: true, delete: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp', 'fmrest'],
  });
  return 'Bot';
}

function fresh(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-approval-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  return { store: new Store(path), dir };
}

const agentCreates = (store: Store) => store.auditLog({ agent: true, limit: 1000 }).filter((e) => e.kind === 'create').length;

test('a gated agent create is held as a proposal, then approved and applied as the agent', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setAgentAccount('bot', agentSet(store), { needsApproval: true });
    const p = store.privileges('bot');
    const before = agentCreates(store);

    assert.throws(() => store.create('Congress', { Name: 'by the bot' }, { privileges: p, account: 'bot' }),
      (e) => e instanceof PendingApprovalError && e.code === 952);
    assert.equal(agentCreates(store), before, 'nothing was created yet');

    const pending = store.pendingChanges();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].agent, 'bot');
    assert.equal(pending[0].kind, 'create');
    assert.equal(pending[0].table, 'Congress');
    assert.deepEqual(pending[0].data, { Name: 'by the bot' });
    assert.ok(store.auditLog({ kind: 'agent-change-proposed', security: true }).some((e) => e.target === 'Congress'));

    const { recordId } = store.approvePending(pending[0].id, 'Admin');
    assert.ok(recordId, 'a record was created on approval');
    assert.equal(store.get('Congress', recordId!, 'iso', undefined, p).fieldData.Name, 'by the bot');
    // The applied change is tagged to the agent, and the approval is logged against the approver.
    assert.ok(store.auditLog({ agent: true }).some((e) => e.kind === 'create' && e.account === 'bot' && e.recordId === recordId));
    assert.ok(store.auditLog({ kind: 'agent-change-approved', security: true }).some((e) => e.account === 'Admin' && e.target === 'bot'));
    assert.equal(store.pendingChanges().length, 0, 'the proposal is cleared');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a gated agent update and delete are held and can be rejected', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setAgentAccount('bot', agentSet(store), { needsApproval: true });
    const p = store.privileges('bot');
    // A record to act on, made directly by a person.
    const { recordId } = store.create('Congress', { Name: 'original' }, { account: 'Admin' });

    assert.throws(() => store.update('Congress', recordId, { Name: 'changed' }, undefined, { privileges: p, account: 'bot' }), PendingApprovalError);
    assert.throws(() => store.delete('Congress', recordId, { privileges: p, account: 'bot' }), PendingApprovalError);
    assert.equal(store.get('Congress', recordId, 'iso', undefined, p).fieldData.Name, 'original', 'the record is unchanged');

    const pending = store.pendingChanges();
    assert.equal(pending.length, 2);
    assert.deepEqual(pending.map((x) => x.kind).sort(), ['delete', 'update']);

    // Reject them both; nothing is applied and the queue empties.
    for (const x of pending) assert.equal(store.rejectPending(x.id, 'Admin'), true);
    assert.equal(store.rejectPending(999, 'Admin'), false, 'an unknown id rejects nothing');
    assert.equal(store.pendingChanges().length, 0);
    assert.equal(store.get('Congress', recordId, 'iso', undefined, p).fieldData.Name, 'original');
    assert.ok(store.auditLog({ kind: 'agent-change-rejected', security: true }).length >= 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('an agent not set to need approval writes directly', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setAgentAccount('bot', agentSet(store)); // no needsApproval
    const p = store.privileges('bot');
    const { recordId } = store.create('Congress', { Name: 'direct' }, { privileges: p, account: 'bot' });
    assert.equal(store.get('Congress', recordId, 'iso', undefined, p).fieldData.Name, 'direct');
    assert.equal(store.pendingChanges().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('portal and container writes are refused for a gated agent, not silently queued', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setAgentAccount('bot', agentSet(store), { needsApproval: true });
    const p = store.privileges('bot');
    const { recordId } = store.create('Congress', { Name: 'x' }, { account: 'Admin' });
    assert.throws(() => store.updatePortals('Congress', recordId, { Something: [{ 'X::Y': '1' }] }, [], { privileges: p, account: 'bot' }),
      (e) => e instanceof PendingApprovalError === false && /approval/i.test((e as Error).message));
    assert.throws(() => store.setContainer('Congress', recordId, 'Name', 1, null, { privileges: p, account: 'bot' }),
      (e) => e instanceof PendingApprovalError === false && /approval/i.test((e as Error).message));
    assert.equal(store.pendingChanges().length, 0, 'nothing was queued');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('an already-approved replay (approvedChange) is not re-gated', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setAgentAccount('bot', agentSet(store), { needsApproval: true });
    const p = store.privileges('bot');
    // The flag approvePending uses internally: a direct write carrying it must not re-queue.
    const { recordId } = store.create('Congress', { Name: 'approved path' }, { privileges: p, account: 'bot', approvedChange: true });
    assert.ok(recordId);
    assert.equal(store.pendingChanges().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a gated agent write inside an atomic section still leaves its proposal and event behind', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setAgentAccount('bot', agentSet(store), { needsApproval: true });
    const p = store.privileges('bot');
    assert.throws(() => atomicWrites(() => store.create('Congress', { Name: 'by the bot' }, { privileges: p, account: 'bot' })),
      (e) => e instanceof PendingApprovalError);
    assert.equal(store.pendingChanges().length, 1, 'the proposal was not rolled back with the refused write');
    assert.ok(store.auditLog({ kind: 'agent-change-proposed', security: true }).some((e) => e.target === 'Congress'));
    assert.equal(agentCreates(store), 0, 'and nothing was created');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
