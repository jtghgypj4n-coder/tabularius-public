import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessReviewCsv, type AccessReview } from '../src/access-review.ts';

test('access-review CSV neutralizes legacy privilege-set names and headings', () => {
  const row: AccessReview['rows'][number] = {
    account: 'reader', privilegeSet: '\t=1+1', fullAccess: false, table: 'Records',
    view: 'yes', edit: 'no', create: 'no', delete: 'no', hiddenFields: 0, viewOnlyFields: 0,
    maskedFields: 0, extendedPrivileges: [], lastSignIn: undefined, daysSinceSignIn: undefined,
    stale: false, has2fa: false,
  };
  const csv = accessReviewCsv({ database: 'test', unusedDays: 90, rows: [row], summary: [] });
  assert.match(csv, /reader,'\t=1\+1,/);
  assert.ok(csv.startsWith('account,privilegeSet,'));
});
