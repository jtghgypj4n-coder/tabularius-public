import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindRequests, findName } from '../src/finds.ts';

test('Find mode builds requests from nonblank fields, keeps wildcard operators, and marks omit requests', () => {
  assert.deepEqual(buildFindRequests([
    { criteria: { Name: 'A*', Blank: '  ', '17|Orders::Status': '==Open' }, omit: false },
    { criteria: { 'Orders::Status': '!Closed' }, omit: true },
  ]), [
    { Name: 'A*', 'Orders::Status': '==Open' },
    { 'Orders::Status': '!Closed', omit: 'true' },
  ]);
});

test('an omit-only find starts with an empty request so it can omit from every record', () => {
  assert.deepEqual(buildFindRequests([
    { criteria: { Name: 'A*' }, omit: true },
    { criteria: { City: 'York' }, omit: true },
  ]), [
    {},
    { Name: 'A*', omit: 'true' },
    { City: 'York', omit: 'true' },
  ]);
  assert.deepEqual(buildFindRequests([{ criteria: { Name: '  ' }, omit: false }]), []);
});

test('recent finds are named after their criteria', () => {
  assert.equal(findName([{ criteria: { Publisher: 'Marvel', Title: '' }, omit: false }]), 'Publisher: Marvel');
  assert.equal(findName([
    { criteria: { Publisher: 'Marvel', 'Comics::Year': '1962' }, omit: false },
    { criteria: { '7|Orders::Status': 'Inactive' }, omit: true },
  ]), 'Publisher: Marvel, Year: 1962; Omit Status: Inactive');
  assert.equal(findName([{ criteria: {}, omit: false }]), 'Find');
  assert.equal(findName([{ criteria: { Notes: 'x'.repeat(80) }, omit: false }]).length, 60);
});

test('Find Matching Records matches the whole field; Insert Operator lists FileMaker\'s operators', async () => {
  const { matchingCriterion, FIND_OPERATORS } = await import('../src/finds.ts');
  assert.equal(matchingCriterion('R'), '==R');
  assert.equal(matchingCriterion(''), '=');
  assert.equal(matchingCriterion('a*b'), '==a*b');
  assert.deepEqual(FIND_OPERATORS.map(([op]) => op), ['<', '≤', '>', '≥', '=', '==', '...', '!', '//', '?', '@', '#', '*', '""', '~']);
});
