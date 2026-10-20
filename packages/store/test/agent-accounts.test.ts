// AI agent accounts: a named identity an MCP/AI client acts as, bound to a
// privilege set (never [Full Access]), with no password, recording the human
// who created it; every action by an agent is tagged in the audit log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

/** A non-full privilege set that can read and write Congress and use the AI tools. */
function agentSet(store: Store): string {
  store.savePrivilegeSet({
    name: 'Bot',
    records: { view: true, edit: true, create: true, delete: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp', 'fmrest'],
  });
  return 'Bot';
}

function fresh(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  return { store: new Store(path), dir };
}

test('an agent account is password-less, bound to its set, and records its creator', { skip }, () => {
  const { store, dir } = fresh();
  try {
    const set = agentSet(store);
    store.setAgentAccount('reporting-bot', set, { createdBy: 'Jordan' });

    const a = store.accounts().find((x) => x.name === 'reporting-bot')!;
    assert.equal(a.agent, true);
    assert.equal(a.hasPassword, false);
    assert.equal(a.privilegeSet, 'Bot');
    assert.equal(a.createdBy, 'Jordan');
    assert.equal(a.external, undefined, 'an agent is not an external account');
    assert.equal(store.isAgent('reporting-bot'), true);
    assert.equal(store.isAgent('Admin'), false);

    // It logs an agent-added security event naming the creator.
    const added = store.auditLog({ kind: 'agent-added', security: true }).find((e) => e.target === 'reporting-bot');
    assert.ok(added, 'agent-added logged');
    assert.equal((added!.changes as { createdBy?: string } | undefined)?.createdBy, 'Jordan');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('an agent cannot be given [Full Access]', { skip }, () => {
  const { store, dir } = fresh();
  try {
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    assert.throws(() => store.setAgentAccount('too-powerful', full.name), /Full Access/);
    assert.equal(store.accounts().some((a) => a.name === 'too-powerful'), false, 'nothing was created');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a password account cannot be quietly turned into an agent', { skip }, () => {
  const { store, dir } = fresh();
  try {
    const set = agentSet(store);
    store.setPassword('Dana', 'pw', set);
    assert.throws(() => store.setAgentAccount('Dana', set), /already a sign-in account/);
    assert.equal(store.isAgent('Dana'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a record change made as an agent is tagged in the audit log', { skip }, () => {
  const { store, dir } = fresh();
  try {
    const set = agentSet(store);
    store.setAgentAccount('writer-bot', set);
    const p = store.privileges('writer-bot');

    // A write carrying the agent's privileges is tagged; a plain admin write is not.
    const { recordId } = store.create('Congress', { Name: 'By the bot' }, { privileges: p, account: 'writer-bot' });
    store.create('Congress', { Name: 'By a person' }, { account: 'Admin' });

    const agentEntries = store.auditLog({ agent: true });
    assert.ok(agentEntries.length >= 1, 'at least one agent-tagged entry');
    assert.ok(agentEntries.every((e) => e.agent === true));
    const mine = agentEntries.find((e) => e.kind === 'create' && e.recordId === recordId);
    assert.ok(mine, 'the agent create is tagged');
    assert.equal(mine!.account, 'writer-bot');

    // The person's write is present but not agent-tagged.
    const personEntry = store.auditLog({ account: 'Admin', kind: 'create' })[0];
    assert.ok(personEntry);
    assert.notEqual(personEntry.agent, true);

    // Filtering agent:false excludes agent entries.
    assert.equal(store.auditLog({ agent: false }).some((e) => e.account === 'writer-bot'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('deleting an agent logs agent-removed and clears its tokens', { skip }, () => {
  const { store, dir } = fresh();
  try {
    const set = agentSet(store);
    store.setAgentAccount('gone-bot', set);
    store.createApiToken('gone-bot', { surfaces: ['fmrest'] });
    assert.equal(store.deleteAccount('gone-bot'), true);
    assert.equal(store.accounts().some((a) => a.name === 'gone-bot'), false);
    assert.ok(store.auditLog({ kind: 'agent-removed', security: true }).some((e) => e.target === 'gone-bot'));
    assert.equal(store.apiTokens().some((t) => t.account === 'gone-bot'), false, 'its tokens are gone');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
