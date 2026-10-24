// What a newcomer reads when a command is given something wrong: a port that isn't one, an address that isn't there, a
// certificate file that doesn't exist, a number of backups that isn't a number. Each says what is wrong and what to give,
// not Node's own words ("options.port should be >= 0 and < 65536", "getaddrinfo ENOTFOUND").
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';
import { problems } from '../../../scripts/error-strings-lib.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(main, args, { env: { ...process.env, PORT: undefined, TABULARIUS_BACKUP_KEEP: undefined, TABULARIUS_HOST: undefined, ...env }, timeout: 60_000 });

describe('command line: wrong values are answered in sentences', { concurrency: 4 }, () => {
  const made = mkdtempSync(join(tmpdir(), 'tabularius-newcomer-'));
  before(async () => {
    const r = await cli(['new', made, 'Shop']);
    assert.equal(r.status, 0, r.stderr);
  });
  after(() => { rmSync(made, { recursive: true, force: true }); });

  const cases: { name: string; args: string[]; env?: NodeJS.ProcessEnv; says: RegExp }[] = [
    { name: 'a port that is not a number', args: ['serve', '@', '--port', 'abc'], says: /^error: serve: --port takes a port number from 1 to 65535, not "abc"$/ },
    { name: 'a port above 65535', args: ['serve', '@', '--port', '99999'], says: /^error: serve: --port takes a port number from 1 to 65535, not "99999"$/ },
    { name: 'a PORT variable that is not a number', args: ['serve', '@'], env: { PORT: 'zzz' }, says: /^error: serve: the PORT variable takes a port number/ },
    { name: 'an address that is not there', args: ['serve', '@', '--host', '999.1.1.1', '--allow-plain-http'], says: /^error: the address "999\.1\.1\.1" was not found\. Use an IP address of this computer/ },
    { name: 'a certificate file that is not there', args: ['serve', '@', '--tls-cert', 'nofile.pem', '--tls-key', 'nokey.pem'], says: /^error: no such file or folder: nofile\.pem$/ },
    { name: 'a number of backups to keep that is not a number', args: ['serve', '@', '--keep', 'none'], says: /^error: serve: --keep is the number of backups to keep, a whole number of 1 or more, not "none"$/ },
    { name: 'the same in a variable', args: ['serve', '@'], env: { TABULARIUS_BACKUP_KEEP: '0' }, says: /^error: serve: TABULARIUS_BACKUP_KEEP is the number of backups to keep/ },
    { name: 'script network accepts a valid host list', args: ['serve', '@', '--allow-script-network-to', 'intranet.example,api.example', '--port', 'abc'], says: /^error: serve: --port takes a port number from 1 to 65535, not "abc"$/ },
    { name: 'script network accepts an empty list', args: ['serve', '@', '--allow-script-network-to', '', '--port', 'abc'], says: /^error: serve: --port takes a port number from 1 to 65535, not "abc"$/ },
    { name: 'script network reports an invalid entry', args: ['serve', '@', '--allow-script-network-to', '10.1'], says: /^error: serve: --allow-script-network-to: "10\.1" is not a host name, address or range$/ },
    { name: 'script network accepts a range', args: ['serve', '@', '--allow-script-network-to', '10.0.0.0/8', '--port', 'abc'], says: /^error: serve: --port takes a port number from 1 to 65535, not "abc"$/ },
    { name: 'script network accepts a wildcard host', args: ['serve', '@', '--allow-script-network-to', '*.corp.example', '--port', 'abc'], says: /^error: serve: --port takes a port number from 1 to 65535, not "abc"$/ },
    { name: 'the table of a file that has none', args: ['records', '@', 'Shop'], says: /^error: records: which table\? This file has no tables yet \(tabularius design-apply adds them/ },
    { name: 'a table that is not there, in a file that has none', args: ['records', '@', 'Shop', 'Nope'], says: /^error: records: no table named "Nope"\. This file has no tables yet/ },
    { name: 'a service action that is not one', args: ['service', 'status', '@'], says: /^service: "status" is not something service does \(install, uninstall or print\)\./ },
    { name: 'a service with no action', args: ['service'], says: /^service: say what to do \(install, uninstall or print\)\./ },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const r = await cli(c.args.map((a) => (a === '@' ? made : a)), c.env);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      const first = r.stderr.split('\n')[0].replaceAll(made, '<folder>');
      assert.match(first, c.says);
      assert.deepEqual(problems(first), [], first);
      assert.doesNotMatch(r.stderr, /\n\s+at .*:\d+:\d+/, 'no stack trace');
    });
  }

});
