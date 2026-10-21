// --help (or -h) on any command prints that command's usage and does nothing
// else: `service install --help` used to check the port and fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const run = (...args: string[]) => runCli(main, args, { env: { ...process.env, PORT: '1' } });

test('--help and -h print a command\'s usage without running it', async () => {
  const cases = [
    [['service', 'install', '--help'], 'tabularius service install'],
    [['serve', '/nonexistent', '--help'], 'tabularius serve'],
    [['upgrade', '-h'], 'tabularius upgrade'],
    [['backup', '--help'], 'tabularius backup'],
    [['restore', '-h'], 'tabularius restore'],
  ] as [string[], string][];
  const results = await Promise.all([...cases.map(([args]) => run(...args)), run('restore', '--help')]);
  for (const [[args, names], r] of cases.map((entry, i) => [entry, results[i]] as const)) {
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stdout, /^Usage:\n/);
    assert.ok(r.stdout.includes(names), r.stdout);
    assert.equal(r.stderr, '');
  }
  // Two forms of restore, both shown.
  assert.equal(results[cases.length].stdout.match(/tabularius restore/g)?.length, 2);
});

test('service install ends with the address it serves at: https with --https local, and the network addresses', async () => {
  const { serviceSummary } = await import('../src/service.ts');
  const plain = serviceSummary({ folder: '/D', port: 8080, host: '127.0.0.1', extra: [] }, ['192.168.1.20']);
  assert.equal(plain.length, 1);
  assert.match(plain[0], /^Hosting \/D at http:\/\/localhost:8080\//);
  // Open to the network without HTTPS: the summary says so; the safe ways do not.
  const open = serviceSummary({ folder: '/D', port: 8080, host: '0.0.0.0', extra: [] }, ['192.168.1.20']);
  assert.ok(open.some((l) => /^\s+Warning: it listens on 0\.0\.0\.0 over plain HTTP/.test(l)), open.join('\n'));
  const proxied = serviceSummary({ folder: '/D', port: 8080, host: '0.0.0.0', extra: ['--public-url', 'https://files.example.com'] }, ['192.168.1.20']);
  assert.ok(!proxied.some((l) => /Warning/.test(l)), proxied.join('\n'));
  const tls = serviceSummary({ folder: '/D', port: 8090, host: '0.0.0.0', extra: ['--https', 'local', '--workers', 'auto'] }, ['192.168.1.20']);
  assert.match(tls[0], /at https:\/\/localhost:8090\//);
  assert.ok(tls.some((l) => l.includes('on the network: https://192.168.1.20:8090/')), tls.join('\n'));
  assert.ok(tls.some((l) => l.includes('https://192.168.1.20:8090/tabularius/tls/')), tls.join('\n'));
});

test('a mistake prints a short message, not the whole command list', async () => {
  const [r, info, bogusWithArg] = await Promise.all([run('bogus'), run('info'), run('bogus', 'x')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^unknown command bogus\n/);
  assert.match(r.stderr, /tabularius --help/);
  assert.ok(r.stderr.split('\n').length < 6, r.stderr);

  assert.equal(info.status, 1);
  assert.match(info.stderr, /^info: give a file or folder\n/);
  assert.ok(info.stderr.includes('tabularius info <file.fmp12>'), info.stderr);
  assert.ok(info.stderr.split('\n').length < 8, info.stderr);

  assert.equal(bogusWithArg.status, 1);
  assert.ok(bogusWithArg.stderr.split('\n').length < 6, bogusWithArg.stderr);
});

test('help [command] prints the usage, and a mistyped command is named before any file is opened', async () => {
  const [help, one, bad, typo] = await Promise.all([
    run('help'), run('help', 'plugins'), run('help', 'bogus'), run('inf', 'nothing.fmp12'),
  ]);
  assert.match(help.stdout, /^tabularius - read FileMaker/);
  assert.equal(one.status, 0);
  assert.match(one.stdout, /^Usage:\n {2}tabularius plugins <folder>/);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^unknown command bogus\n/);
  // A mistyped command with a file after it doesn't try to open the file.
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /^unknown command inf\n/);
  assert.ok(!/ENOENT/.test(typo.stderr), typo.stderr);
});

test('an option where the folder goes says the folder is missing, and plugins names a folder that is not there', async () => {
  const [r, gone] = await Promise.all([
    run('serve', '--port', '9000'),
    run('plugins', join(import.meta.dirname, 'no-such-folder'), 'list'),
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^serve: give a file or folder first, before the options \(found --port\)\n/);
  assert.ok(!/ENOENT/.test(r.stderr), r.stderr);
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /plugins: the folder .*no-such-folder isn't there/);
  assert.equal(gone.stdout, '');
});

test('the plain-HTTP warning treats every spelling of this computer as this computer, and nothing else', async () => {
  const { isLoopbackHost } = await import('../src/loopback.ts');
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::ffff:127.0.0.1']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '::', '192.168.1.20', '::ffff:192.168.1.20', '1270.0.0.1', 'example.com']) assert.equal(isLoopbackHost(h), false, h);
});

test('plainHttpRefusal: this computer, HTTPS and an explicit allowance pass; every other address does not', async () => {
  const { plainHttpRefusal } = await import('../src/loopback.ts');
  for (const host of ['127.0.0.1', 'localhost', '::1', '127.1.2.3']) assert.equal(plainHttpRefusal({ host, secure: false, allowed: false }), undefined, host);
  for (const host of ['0.0.0.0', '::', '192.168.1.20', 'files.example.com']) {
    assert.match(plainHttpRefusal({ host, secure: false, allowed: false }) ?? '', /over plain HTTP.*--https.*--allow-plain-http/s, host);
    assert.equal(plainHttpRefusal({ host, secure: true, allowed: false }), undefined, `${host} with HTTPS`);
    assert.equal(plainHttpRefusal({ host, secure: false, allowed: true }), undefined, `${host} allowed`);
  }
});
