import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Docker image runs as an unprivileged user and works with a read-only root filesystem. The files are checked
// always; building and running the image is slow, so it runs only with TABULARIUS_DOCKER_TEST=1 and a working Docker.

const root = join(import.meta.dirname, '..', '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

test('docker: the image drops root, and the compose files layer the hardening and HTTPS options', () => {
  const docker = read('Dockerfile');
  const user = docker.lastIndexOf('\nUSER node');
  assert.ok(user > 0, 'the Dockerfile switches to the node user');
  assert.ok(docker.indexOf('chown node:node /data') > 0 && docker.indexOf('chown node:node /data') < user, '/data belongs to that user before the switch');
  assert.ok(docker.indexOf('\nCMD') > user, 'the server starts as that user');
  assert.match(docker, /^COPY docs \.\/docs$/m, 'the image includes the guides and REST reference');
  assert.match(docker, /^COPY LICENSE NOTICE \.\/$/m, 'the image includes the project licence and notices');
  const stopWait = Number(/TABULARIUS_STOP_GRACE_MS\) \|\| (\d+)_000/.exec(read('packages/cli/src/service.ts'))?.[1]);
  assert.ok(stopWait > 0, 'the shutdown save wait is defined in service.ts');
  for (const file of ['compose.yaml', 'compose.hardened.yaml', 'compose.https.yaml']) {
    const compose = read(file);
    assert.match(compose, new RegExp(`stop_grace_period:\\s*(\\d+)s`), `${file} gives shutdown time`);
    const grace = Number(new RegExp(`stop_grace_period:\\s*(\\d+)s`).exec(compose)?.[1]);
    assert.ok(grace * 1000 > stopWait, `${file} waits longer than the ${stopWait} ms save period`);
  }
  assert.match(read('compose.hardened.yaml'), /read_only: true[\s\S]*tmpfs:[\s\S]*- \/tmp[\s\S]*cap_drop:[\s\S]*- ALL[\s\S]*no-new-privileges:true/);
  const https = read('compose.https.yaml');
  assert.match(https, /caddy:/);
  assert.ok(!/ports:\s*\n\s*- "8080/.test(https), 'the server itself is not published in the HTTPS setup');
  assert.match(read('Caddyfile'), /reverse_proxy tabularius:8080/);
  assert.match(https, /TABULARIUS_PROXY_HEADER/);
  const proxySubnet = /TABULARIUS_TRUSTED_PROXIES:\s*(\S+)/.exec(https)?.[1];
  assert.ok(proxySubnet, 'the separate Caddy container has an explicit trusted subnet');
  assert.equal(/- subnet:\s*(\S+)/.exec(https)?.[1], proxySubnet, 'Compose networking and proxy trust use the same configurable subnet');
});

function dockerWorks(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}
const skip = process.env.TABULARIUS_DOCKER_TEST !== '1' ? 'set TABULARIUS_DOCKER_TEST=1 to build and run the image' : dockerWorks() ? false : 'no working Docker';

test('docker: the built image serves as an unprivileged user on a read-only root filesystem', { skip, timeout: 600_000 }, async () => {
  const tag = `tabularius-test:${process.pid}`;
  const data = mkdtempSync(join(tmpdir(), 'tabularius-docker-'));
  chmodSync(data, 0o777);
  let id = '';
  try {
    execFileSync('docker', ['build', '-t', tag, root], { stdio: 'inherit' });
    id = execFileSync('docker', ['run', '-d', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '-p', '127.0.0.1::8080', '-v', `${data}:/data`, tag]).toString().trim();
    assert.equal(execFileSync('docker', ['exec', id, 'id', '-u']).toString().trim(), '1000');
    const port = execFileSync('docker', ['port', id, '8080/tcp']).toString().trim().split(':').pop();
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      ok = await fetch(`http://127.0.0.1:${port}/tabularius/health`).then((r) => r.ok, () => false);
      if (!ok) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(ok, `the server answers /tabularius/health\n${spawnSync('docker', ['logs', id]).stdout}`);
    assert.ok(existsSync(data));
  } finally {
    if (id) spawnSync('docker', ['rm', '-f', id]);
    spawnSync('docker', ['rmi', '-f', tag]);
    rmSync(data, { recursive: true, force: true });
  }
});
