import { test } from 'node:test';
import { op, runSequence } from './session-sequence-harness.ts';

test('an open session cannot acquire a newly assigned privilege set', async t => {
  await runSequence(t, [op('basic'), op('privilege'), op('basic')]);
});
test('revoking an API token releases its cached session', async t => {
  await runSequence(t, [op('token'), op('revoke')]);
});
test('password reset ends sessions, keeps independent service tokens, and permits fresh Basic login', async t => {
  await runSequence(t, [op('basic'), op('token'), op('password'), op('basic')]);
});
test('password reset ends OAuth access immediately and refuses refresh', async t => {
  await runSequence(t, [op('oauth'), op('password'), op('refresh'), op('oauth')]);
});
test('upgrading legacy OAuth grants keeps them connected as delegated access, so a password reset ends them, and leaves real service tokens alone', async t => {
  await runSequence(t, [op('oauth'), op('token'), op('legacyOAuth'), op('refresh'), op('oauth'), op('password'), op('refresh'), op('token')]);
});
test('a service token that changed its own password through the Data API keeps working after an administrator resets it', async t => {
  await runSequence(t, [op('token'), op('selfPasswordToken'), op('password'), op('token')]);
});

test('a failed security batch restores credentials, grants, privileges and audit head together', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('rollback'), op('refresh')]);
});
test('OAuth and service tokens cannot carry new privileges through refresh or reuse', async t => {
  await runSequence(t, [op('oauth'), op('token'), op('privilege'), op('refresh'), op('oauth'), op('token')]);
});
test('an unexchanged OAuth code cannot acquire privileges assigned after sign-in', async t => {
  await runSequence(t, [op('oauthCode'), op('privilege'), op('exchange'), op('oauthCode'), op('exchange'), op('exchange')]);
});
test('editing an assigned privilege set invalidates sessions and tokens', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('editSet'), op('refresh')]);
});
test('adding an extended privilege requires reauthentication', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('surface')]);
});
test('disabling then enabling an account never resurrects captured credentials', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('disable'), op('enable'), op('refresh'), op('basic')]);
});
test('own password repair keeps only the reauthenticated session', async t => {
  await runSequence(t, [op('basic'), op('basic', 0, 1), op('oauth'), op('selfPassword'), op('refresh'), op('basic')]);
});
test('expiry, wall-clock rollback and idle-policy edits cannot revive sessions', async t => {
  await runSequence(t, [op('basic'), op('token'), op('oauth'), op('expire'), op('clockBack'), op('basic'), op('idlePolicy'), op('idlePolicy')]);
});
test('lockout accounting is per address and logout races clean up exactly once', async t => {
  await runSequence(t, [op('basic'), op('lock'), op('basic'), op('basic', 0, 1), op('unlock'), op('basic'), op('raceLogout'), op('raceLogout')]);
});

test('a code from before marks held authority is refused once the account\'s authority changed', async t => {
  await runSequence(t, [op('oauthCode'), op('legacyCode'), op('privilege'), op('exchange')]);
});
test('authority that changes and is changed back still ends what was issued before, with nothing looking in between', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('oauthCode'), op('privilege'), op('privilege'), op('exchange'), op('refresh'), op('basic')], { checkEach: false });
});
test('editing a privilege set and editing it back still ends what was issued before, with nothing looking in between', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('editSet'), op('editSet'), op('refresh')], { checkEach: false });
});
test('disabling then enabling an account ends captured credentials even when nothing looked while it was off', async t => {
  await runSequence(t, [op('basic'), op('oauth'), op('token'), op('disable'), op('enable'), op('refresh'), op('basic')], { checkEach: false });
});
