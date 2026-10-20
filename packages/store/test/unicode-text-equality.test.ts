// Text that looks the same can be stored differently: é as one character or as e with a combining accent, Å as the
// letter with a ring, the angstrom sign or A and a ring. A unique value, a value-list check and an account name must not
// tell such pairs apart (they are the same letters), while the table at the end records what the finds do with the pairs
// that differ only in compatibility form, which is unverified against FileMaker (docs/text-comparison.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, totpCode } from '../src/index.ts';
import { LOCKOUT } from '../src/index.ts';
import { lockoutName, SignInFailures } from '../src/sign-in-failures.ts';
import { planAccountImport } from '../src/account-provisioning.ts';
import { foldCase } from '../../calc/src/collation.ts';

const NFC = 'café';
const NFD = 'café';

function open(run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unicode-'));
  try {
    createStore(join(dir, 'U.sqlite'));
    const store = new Store(join(dir, 'U.sqlite'), 'U');
    run(store);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('foldCase: canonically equal text is one value; accents and compatibility forms are not folded', () => {
  assert.equal(foldCase(NFC), foldCase(NFD));
  assert.equal(foldCase('Å'), foldCase('Å'));
  assert.equal(foldCase('Å'), foldCase('Å'));
  assert.equal(foldCase('É'), foldCase('é'.replace('e', 'E')));
  assert.notEqual(foldCase('e'), foldCase('é'));
  assert.notEqual(foldCase('ﬁ'), foldCase('fi'), 'a ligature is a compatibility form, not the same letters');
  assert.equal(foldCase('ZEBRA'), 'zebra');
});

test('a unique field refuses a value that is another one written with combining marks', () => {
  open((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Tag', fields: [{ name: 'Label', options: { validation: { unique: true } } }] }] as never);
    store.create('Tag', { Label: NFC });
    const refused = (label: string) => assert.throws(() => store.create('Tag', { Label: label }), (e: StoreError) => e.code === 504, label);
    refused(NFD);
    refused(NFD.toUpperCase());
    store.create('Tag', { Label: 'Å' });
    refused('Å');
    refused('Å');
    store.create('Tag', { Label: 'cafe' });
    // An update to the other form of its own value is not another record's.
    const { recordId } = store.create('Tag', { Label: 'zoë' });
    store.update('Tag', recordId, { Label: 'zoë' });
  });
});

test('a value-list check accepts a listed value written with combining marks', () => {
  open((store) => {
    store.applyDesign([
      { op: 'createValueList', name: 'Cafes', values: [NFC, 'plain'] },
      { op: 'createTable', name: 'V', fields: [{ name: 'Pick', options: { validation: { valueList: 'Cafes', always: true } } }] },
    ] as never);
    store.create('V', { Pick: NFC });
    store.create('V', { Pick: NFD });
    store.create('V', { Pick: 'PLAIN' });
    assert.throws(() => store.create('V', { Pick: 'cafe' }), (e: StoreError) => e.code === 506);
  });
});

test('a new account whose name is another account\'s written another way is refused, whichever way it is added', () => {
  open((store) => {
    store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
    store.createAccount('José', 'a-long-enough-password', 'Viewer');
    const looks = (e: unknown) => e instanceof StoreError && e.code === 960 && /looks the same/.test(e.message);
    assert.throws(() => store.createAccount('José', 'a-long-enough-password', 'Viewer'), looks);
    assert.throws(() => store.setPassword('José', 'a-long-enough-password', 'Viewer'), looks);
    assert.throws(() => store.setExternalAccount('José', 'Viewer'), looks);
    assert.throws(() => store.setAgentAccount('José', 'Viewer'), looks);
    // The same name in other ASCII case is the account that exists, as before.
    assert.throws(() => store.createAccount('JOSé', 'a-long-enough-password', 'Viewer'), (e: StoreError) => e.code === 960 && /already exists/.test(e.message));
    // Another capital that the database does not fold is a lookalike too.
    store.createAccount('Émile', 'a-long-enough-password', 'Viewer');
    assert.throws(() => store.createAccount('émile', 'a-long-enough-password', 'Viewer'), looks);
    // A different name is fine, and changing an existing account's password is not a new account.
    store.createAccount('Jose', 'a-long-enough-password', 'Viewer');
    store.setPassword('José', 'another-long-password', 'Viewer');
    assert.ok(store.verify('José', 'another-long-password'));
    assert.ok(!store.verify('José', 'another-long-password'), 'the other form is no account');
  });
});

test('deleting an account that came from the file frees its name for another written the same way', () => {
  open((store) => {
    store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
    // The file's own list keeps naming an account after it is deleted here; only accounts that exist count.
    (store as unknown as { schema: { accounts: { name: string }[] } }).schema.accounts.push({ name: 'jos\u00e9' });
    store.createAccount('jose\u0301', 'a-long-enough-password', 'Viewer');
    assert.ok(store.verify('jose\u0301', 'a-long-enough-password'));
    assert.throws(() => store.createAccount('jos\u00e9', 'a-long-enough-password', 'Viewer'), (e: StoreError) => e.code === 960 && /looks the same/.test(e.message), 'an account that exists still counts');
  });
});

test('an account a provider provisions is refused when its name looks like an existing account', () => {
  open((store) => {
    store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
    store.createAccount('jos\u00e9@x.com', 'a-long-enough-password', 'Viewer');
    assert.throws(() => store.addProvisionedAccount('jose\u0301@x.com', 'Admin'), (e: StoreError) => e.code === 960 && /looks the same/.test(e.message));
    store.addProvisionedAccount('jose@x.com', 'Admin');
  });
});

test('the sign-in counter keeps one bucket for the spellings a directory takes as one name', () => {
  const key = (name: string) => new SignInFailures().accountKey(name, '203.0.113.7');
  const same = (a: string, b: string, why: string) => assert.equal(key(a), key(b), why);
  same('jos\u00e9', 'jose\u0301', 'accent as one character or two');
  same('JOS\u00c9', 'jos\u00e9', 'case');
  same('\uff4a\uff4f\uff53\uff45', 'jose', 'full-width letters');
  same('jo\u00adse', 'jose', 'soft hyphen');
  same('jo\u200bse', 'jose', 'zero-width space');
  same('  jane   doe ', 'jane doe', 'outer and repeated spaces');
  same('Stra\u00dfe', 'STRASSE', 'sharp s');
  assert.notEqual(key('jose'), key('josa'), 'different names stay apart');
  assert.notEqual(new SignInFailures().accountKey('jose', '203.0.113.7'), new SignInFailures().accountKey('jose', '203.0.113.8'), 'the place is still part of the bucket');
  assert.ok(key('a'.repeat(100_000)).length < 200, 'a very long name is cut short');
});

test('a name of padding, or of nothing a directory reads, folds to one bucket of its own and clears nothing else', () => {
  assert.equal(lockoutName(' '.repeat(5000) + 'jose'), 'jose', 'padding in front cannot push the name out');
  assert.equal(lockoutName('\u200e\u202a\u2063jose\u200f'), 'jose', 'direction and invisible marks are read as nothing');
  assert.equal(lockoutName('\u00ad\u200b'), '\ufffd', 'nothing at all is still a name');
  assert.notEqual(lockoutName(' '.repeat(300)), '');
  open((store) => {
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure('203.0.113.50');
    assert.ok(store.addressLockedOut('203.0.113.50'), 'the address is blocked');
    for (const name of [' '.repeat(300), '\u00ad'.repeat(300), '\u200b', ' '.repeat(256) + 'jose']) store.unlock(name);
    assert.ok(store.addressLockedOut('203.0.113.50'), 'signing in as a name that folds to nothing does not lift an address block');
  });
});

test('unlocking an account also clears its two-factor lockout, whatever the spelling folds', () => {
  open((store) => {
    store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
    for (const name of ['We\u00dfel', 'jos\u00e9', '\uff4a\uff4f\uff45', '\ufb01ona']) {
      store.createAccount(name, 'a-long-enough-password', 'Viewer');
      const { secret } = store.enrollTotp(name);
      assert.ok(store.confirmTotp(name, totpCode(secret)));
      for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verifyTotp(name, '000000', '203.0.113.60'), false);
      assert.equal(store.verifyTotp(name, totpCode(secret), '203.0.113.60'), false, `${name} is locked out of two-factor`);
      assert.equal(store.unlock(name), true, `${name} is unlocked`);
      assert.equal(store.verifyTotp(name, totpCode(secret, Math.floor(Date.now() / 30_000) + 1), '203.0.113.60'), true, `${name} can use its code again`);
    }
  });
});

test('accounts that would share a lockout bucket are refused as lookalikes, so one cannot reset the other\'s count', () => {
  open((store) => {
    store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
    for (const [first, second] of [['Strasse', 'Stra\u00dfe'], ['fiona', '\ufb01ona'], ['jane doe', 'jane  doe'], ['joe', '\uff4a\uff4f\uff45']]) {
      store.createAccount(first, 'a-long-enough-password', 'Viewer');
      assert.throws(() => store.createAccount(second, 'a-long-enough-password', 'Viewer'), (e: StoreError) => e.code === 960 && /looks the same/.test(e.message), `${second} against ${first}`);
    }
  });
  const rows = (...names: string[]) => names.map((account, i) => ({ row: i + 2, account, privilegeSet: 'Viewer', active: true }));
  const plan = planAccountImport(rows('Strasse', 'Stra\u00dfe'), [], [], 'admin');
  assert.ok(plan.errors.some((e) => e.code === 'ambiguous-unicode-account'), 'an import naming both is refused');
});

test('guesses written in different forms of one name are counted together and lock the account', () => {
  open((store) => {
    store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
    store.createAccount('jos\u00e9', 'a-long-enough-password', 'Viewer');
    const forms = ['jos\u00e9', 'jose\u0301', 'JOS\u00c9', '\uff4a\uff4f\uff53\u00e9', 'jo\u00adsé'];
    forms.forEach((form) => store.verify(form, 'wrong-password-guess', '203.0.113.9'));
    assert.ok(store.lockedOut('jos\u00e9', '203.0.113.9'), 'five wrong guesses in five forms lock the account');
    assert.ok(store.lockedOut('jose\u0301', '203.0.113.9'), 'whichever form is asked about');
    assert.equal(store.lockedOut('jos\u00e9', '203.0.113.10'), undefined, 'another address is not locked');
  });
});

test('the sign-in counter keeps one bucket for names the database stores as one', () => {
  const key = (name: string) => new SignInFailures().accountKey(name, '203.0.113.7');
  // A lone surrogate is stored as U+FFFD, so all three find the same account row.
  assert.equal(key('x\uD800'), key('x\uFFFD'));
  assert.equal(key('x\uDC00'), key('x\uFFFD'));
});

test('a find is not width sensitive: full-width and half-width forms are the normal-width character', () => {
  open((store) => {
    store.applyDesign([{ op: 'createTable', name: 'W', fields: [{ name: 'Name' }] }] as never);
    for (const n of ['\uff23\uff2f\uff24\uff25 \uff11\uff12\uff13', '\uff76\uff77\uff78', 'ABC 456', '\u30ab\u30ad\u30af']) store.create('W', { Name: n });
    const count = (q: string) => store.find('W', { query: [{ Name: q }] }).records.length;
    assert.equal(count('code 123'), 1, 'full-width letters and digits are found by plain ones');
    assert.equal(count('\uff23\uff2f\uff24\uff25'), 1, 'and plain by full-width');
    assert.equal(count('\uff41\uff42\uff43 \uff14\uff15\uff16'), 1, 'a full-width find finds plain text');
    assert.equal(count('\u30ab\u30ad\u30af'), 2, 'half-width katakana and the full-width letters are the same');
    assert.equal(count('\uff76\uff77\uff78'), 2);
    assert.equal(count('==\uff41\uff42\uff43 456'), 1);
    assert.equal(count('\uff41\uff42*'), 1, 'a wildcard too');
  });
});

test('known: what finds do with text that differs in form (unverified against FileMaker)', () => {
  // [stored, typed, plain, ==, wildcard]. Canonical pairs and the compatibility forms the folding knows (the ligatures ﬀ ﬁ ﬂ and
  // the width forms: full-width letters and digits, half-width katakana) match in every kind of find, the word index included.
  const KNOWN: [string, string, boolean, boolean, boolean][] = [
    [NFC, NFD, true, true, true],
    ['Å', 'Å', true, true, true],
    ['ﬁlm', 'film', true, true, true],
    ['ＡＢ', 'AB', true, true, true],
    ['１２３', '123', true, true, true],
    ['ｶｷ', 'カキ', true, true, true],
  ];
  open((store) => {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }] }] as never);
    for (const [stored, typed, plain, whole, wild] of KNOWN) {
      const { recordId } = store.create('T', { Name: stored });
      const found = (q: string) => store.find('T', { query: [{ Name: q }] }).records.length === 1;
      assert.equal(found(typed), plain, `${JSON.stringify(stored)} found by ${JSON.stringify(typed)}`);
      assert.equal(found('==' + typed), whole, `==${JSON.stringify(typed)}`);
      assert.equal(found(typed.slice(0, 2) + '*'), wild, `${JSON.stringify(typed.slice(0, 2))}*`);
      store.delete('T', recordId);
    }
  });
});
