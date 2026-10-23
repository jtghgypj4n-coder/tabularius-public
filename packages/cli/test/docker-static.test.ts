// The Dockerfile, the three Compose files, the Caddyfile and .dockerignore, read as text and checked against each other, the
// code and the pages that tell people to use them. No Docker is needed or run: building the image and starting containers is
// packages/server/test/docker.test.ts, which runs only when TABULARIUS_DOCKER_TEST=1 and a daemon answers. What this cannot see
// (a pulled base image, the uid of its "node" user, Compose's own merging, Caddy running) is listed at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml, type Yaml } from './yaml-subset.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const COMPOSE = ['compose.yaml', 'compose.hardened.yaml', 'compose.https.yaml'];

interface Step { op: string; args: string; no: number }

/** The Dockerfile's instructions: comments dropped, a line ending in \ joined to the next. */
function dockerfile(): Step[] {
  const steps: Step[] = [];
  const lines = read('Dockerfile').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.trim() || lines[i]!.trim().startsWith('#')) continue;
    const no = i + 1;
    let text = lines[i]!;
    while (text.trimEnd().endsWith('\\') && i + 1 < lines.length) text = text.trimEnd().slice(0, -1) + ' ' + lines[++i]!.trim();
    const m = /^\s*([A-Za-z]+)\s+([\s\S]*)$/.exec(text);
    assert.ok(m, `Dockerfile line ${no} is not an instruction: ${text}`);
    steps.push({ op: m[1]!.toUpperCase(), args: m[2]!.replace(/\s+/g, ' ').trim(), no });
  }
  return steps;
}
const ofKind = (op: string) => dockerfile().filter((s) => s.op === op);
const env = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const s of ofKind('ENV')) for (const m of s.args.matchAll(/([A-Z_]+)=(\S+)/g)) out[m[1]!] = m[2]!;
  return out;
};
const compose = (file: string) => parseYaml(read(file)) as { [k: string]: any };
const service = (file: string, name = 'tabularius') => compose(file).services?.[name] as { [k: string]: any };

/** ${NAME:-fallback} filled in with its fallback, the way Compose does when NAME is not set. */
const withDefaults = (v: string) => v.replace(/\$\{([A-Z_]+):-([^}]*)\}/g, '$2');

test('the YAML reader refuses what it does not understand, so a new Compose feature is noticed', () => {
  for (const [source, why] of [
    ['a: [1, 2]\n', /flow list/], ['a: &x 1\n', /start of a value/], ['a: |\n  text\n', /start of a value/], ['---\na: 1\n', /document marker/],
    ['a:\n\tb: 1\n', /tab/], ['a: 1\na: 2\n', /twice/], ['a: b: c\n', /colon/], ['a:\n  b: 1\n    c: 2\n', /carried over/],
  ] as const) assert.throws(() => parseYaml(source), why, source);
  assert.deepEqual(parseYaml('a:\n  - x\n  - y: "1"\n    z: \'2\' # kept\n# nothing\nb: true\n'), { a: ['x', { y: '1', z: '2' }], b: true });
  assert.deepEqual(parseYaml('a:\n- x\n'), { a: ['x'] }, 'a list level with its key');
});

test('Dockerfile: the base image names a version and matches the Node the project needs', () => {
  const from = ofKind('FROM');
  assert.equal(from.length, 1, 'one stage: nothing from a build stage is copied');
  const m = /^node:(\d+)(?:\.\d+)*-slim$/.exec(from[0]!.args);
  assert.ok(m, `FROM ${from[0]!.args}: use node:<version>-slim, never latest or an untagged name`);
  const engines = /(\d+)\.(\d+)/.exec(JSON.parse(read('package.json')).engines.node);
  assert.equal(m[1], engines![1], 'the image runs the same Node major as package.json engines');
  assert.equal(read('.nvmrc').trim().split('.')[0], m[1], 'and as .nvmrc, which CI installs');
});

test('Dockerfile: the server runs as an unprivileged user that owns /data, started so SIGTERM reaches it', () => {
  const steps = dockerfile();
  const users = steps.filter((s) => s.op === 'USER');
  assert.ok(users.length >= 1);
  const last = users.at(-1)!;
  assert.ok(last.args !== 'root' && last.args !== '0' && !/^0[:\s]/.test(last.args), 'the final USER is not root');
  assert.ok(steps.filter((s) => s.op === 'RUN').every((s) => s.no < last.no), 'every RUN (installs, chown) is done before dropping root');
  const chown = steps.find((s) => s.op === 'RUN' && /\bchown\b/.test(s.args) && /\/data\b/.test(s.args));
  assert.ok(chown && new RegExp(`chown ${last.args}:${last.args} /data`).test(chown.args), '/data is made and handed to that user');
  assert.ok(steps.some((s) => s.op === 'VOLUME' && s.args === '/data'));
  const cmd = steps.filter((s) => s.op === 'CMD');
  assert.equal(cmd.length, 1);
  assert.ok(cmd[0]!.no > last.no, 'CMD comes after USER');
  const argv = JSON.parse(cmd[0]!.args) as string[];
  assert.deepEqual(argv.slice(0, 1), ['node'], 'exec form, so node is process 1 and gets the stop signal itself');
  assert.deepEqual(argv.slice(-2), ['serve', '/data'], 'it serves the mounted folder');
  assert.ok(argv.includes('packages/cli/src/main.ts') && existsSync(join(root, 'packages/cli/src/main.ts')), 'it starts the command line program, which is in the repository');
  assert.ok(!steps.some((s) => s.op === 'STOPSIGNAL') || ofKind('STOPSIGNAL')[0]!.args === 'SIGTERM', 'the stop signal is the one the server handles');
  assert.match(read('packages/cli/src/main.ts'), /process\.once\('SIGTERM', stop\)/);
});

test('Dockerfile: the port, the host address and the health check agree with the server', () => {
  const e = env();
  assert.equal(e.TABULARIUS_HOST, '0.0.0.0', 'listens on every interface inside the container (the published port is the choice)');
  assert.equal(e.TABULARIUS_ALLOW_PLAIN_HTTP, '1', 'the refusal to listen beyond this computer over plain HTTP is for the port the container publishes to decide');
  assert.match(e.PORT!, /^\d+$/);
  assert.ok(ofKind('EXPOSE').some((s) => s.args === e.PORT), 'EXPOSE names the port the server is told to use');
  const check = ofKind('HEALTHCHECK')[0];
  assert.ok(check, 'there is a health check');
  assert.match(check.args, /--start-period=(?:[5-9]|\d\d+)m|--start-period=\d{3,}s/, 'a start period long enough to convert files before it counts failures');
  assert.match(check.args, /process\.env\.PORT/, 'it asks on the port the server was given');
  const route = /\/tabularius\/health/.exec(check.args)?.[0];
  assert.ok(route, 'it asks the health route');
  assert.match(read('packages/server/src/index.ts'), new RegExp(`url\\.pathname === '${route}'`), 'which the server answers');
  assert.match(read('packages/server/src/metrics.ts'), /no sign-in/, 'without signing in, as a health check must');
  assert.match(read('packages/cli/src/main.ts'), /process\.env\.PORT/, 'serve reads PORT');
  assert.equal(e.TMPDIR, '/tmp', 'temporary files go where the hardened file mounts a tmpfs');
});

test('Dockerfile: only named files are copied, none is excluded by .dockerignore, and the server needs nothing else', () => {
  const copies = ofKind('COPY');
  const ignored = read('.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const sources: string[] = [];
  for (const s of copies) {
    assert.ok(!/^--/.test(s.args), `COPY line ${s.no}: options are not used here, so none is checked`);
    const parts = s.args.split(' ');
    const to = parts.at(-1)!;
    // The code finds the guides and package.json by a path up from packages/, so the image keeps the repository's layout.
    for (const p of parts.slice(0, -1)) assert.ok(to === './' || to === `./${p}`, `COPY ${p} lands in ${to} (line ${s.no}), not where the code looks for it`);
    for (const p of parts.slice(0, -1)) {
      assert.notEqual(p, '.', 'no COPY . . that could take secrets, local files or a .env along');
      assert.ok(existsSync(join(root, p)), `COPY ${p} (line ${s.no}) names a file that is in the repository`);
      assert.ok(!ignored.includes(p) && !ignored.includes(p + '/'), `${p} is copied and also in .dockerignore`);
      sources.push(p);
    }
  }
  for (const p of ['package.json', 'package-lock.json', 'packages', 'docs', 'LICENSE', 'NOTICE']) assert.ok(sources.includes(p), `${p} is copied`);
  for (const p of ['node_modules', '.git', 'Databases', '**/*.sqlite']) assert.ok(ignored.includes(p), `.dockerignore leaves out ${p}`);
  // What the server reads from beside its own code: the guides, and package.json for its version. Anything else it finds by a path
  // up from packages/ must be among the copied files.
  const reads = new Set<string>();
  const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? (d.name === 'node_modules' ? [] : walk(`${dir}/${d.name}`)) : /\.ts$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  for (const pkg of readdirSync(join(root, 'packages'))) {
    if (!existsSync(join(root, 'packages', pkg, 'src'))) continue;
    for (const f of walk(`packages/${pkg}/src`)) {
      const text = read(f);
      for (const m of text.matchAll(/import\.meta\.dirname,((?:\s*'\.\.',){3})\s*'([\w.-]+)'/g)) reads.add(m[2]!);
      for (const m of text.matchAll(/new URL\('(?:\.\.\/){3}([\w.-]+)'/g)) reads.add(m[1]!);
    }
  }
  assert.ok(reads.has('docs') && reads.has('package.json'), 'the scan still finds the two known reads');
  for (const r of reads) assert.ok(sources.includes(r), `the server reads ${r} from the repository root, and the image does not copy it`);
});

test('Dockerfile: packages are installed from the lock file without development tools, and the PDF thumbnail tool is the one the code runs', () => {
  const runs = ofKind('RUN').map((s) => s.args);
  assert.ok(runs.some((r) => /^npm ci --omit=dev\b/.test(r)), 'npm ci --omit=dev, exact versions from package-lock.json');
  assert.ok(ofKind('COPY').some((s) => /^package\.json package-lock\.json /.test(s.args)));
  assert.equal(Object.keys(JSON.parse(read('package.json')).dependencies ?? {}).length, 0, 'the project has no runtime dependencies, so the image installs none');
  const apt = runs.find((r) => /apt-get install/.test(r));
  assert.ok(apt, 'one apt step');
  assert.match(apt, /^apt-get update && apt-get install -y --no-install-recommends [\w.+-]+( [\w.+-]+)* && rm -rf \/var\/lib\/apt\/lists\/\*$/, 'update, install without recommends and clear the lists in one layer');
  assert.match(apt, /poppler-utils/);
  assert.match(read('packages/server/src/containers.ts') + read('packages/server/src/thumbnails.ts'), /pdftoppm/, 'the code runs pdftoppm, which poppler-utils provides');
  assert.ok(runs.some((r) => /npm cache clean --force/.test(r)));
});

test('Dockerfile: the image has a Tabularius command on the PATH that runs the same program as CMD', () => {
  const run = ofKind('RUN').map((r) => r.args).find((r) => r.includes('/usr/local/bin/tabularius'));
  assert.ok(run, 'a RUN writes /usr/local/bin/tabularius, which the pages tell people to use through "docker compose exec"');
  assert.match(run, /chmod 755 \/usr\/local\/bin\/tabularius/, 'and makes it runnable by the unprivileged user');
  assert.match(run, /exec node --no-warnings \/opt\/tabularius\/packages\/cli\/src\/main\.ts "\$@"/, 'it passes every argument on to the program');
  assert.equal(ofKind('WORKDIR')[0]!.args, '/opt/tabularius', 'the path in the script is where the code is');
});

test('Dockerfile: no secret is set in the image', () => {
  for (const s of dockerfile()) {
    if (s.op !== 'ENV' && s.op !== 'ARG') continue;
    for (const m of s.args.matchAll(/([A-Za-z_]+)(?:=(\S*))?/g)) {
      if (/KEY|TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL/i.test(m[1]!)) assert.fail(`line ${s.no}: ${m[1]} would be kept in the image's layers; pass it when the container starts`);
    }
  }
});

test('Compose: every variable a file sets is one the server reads, and the one Compose reads itself is documented', () => {
  const sources = readdirSync(join(root, 'packages')).flatMap((p) => existsSync(join(root, 'packages', p, 'src')) ? readdirSync(join(root, 'packages', p, 'src')).filter((f) => f.endsWith('.ts')).map((f) => read(`packages/${p}/src/${f}`)) : []).join('\n');
  const composeOnly = new Set(['TABULARIUS_PROXY_SUBNET']);
  for (const file of COMPOSE) {
    for (const name of new Set(read(file).match(/\bTABULARIUS_[A-Z0-9_]*[A-Z0-9]\b/g) ?? [])) {
      if (composeOnly.has(name)) continue;
      assert.ok(sources.includes(name), `${file} names ${name}, which no code reads`);
    }
  }
  assert.match(read('ADMIN.md'), /TABULARIUS_PROXY_SUBNET/, 'the Compose-only variable is explained where people set up HTTPS');
  const defaults = [...read('compose.https.yaml').matchAll(/\$\{TABULARIUS_PROXY_SUBNET:-([^}]+)\}/g)].map((m) => m[1]);
  assert.equal(defaults.length, 2, 'used for the network and for the trusted proxies');
  assert.equal(new Set(defaults).size, 1, 'with the same default in both, so they agree');
  assert.match(read('ADMIN.md'), new RegExp(defaults[0]!.replace(/[./]/g, '\\$&')), 'and ADMIN.md names that default');
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(defaults[0]!);
  assert.ok(m && +m[5]! >= 16 && +m[5]! <= 28, 'a private network of a sensible size, not 0.0.0.0/0');
  assert.ok(+m![1]! === 10 || (+m![1]! === 172 && +m![2]! >= 16 && +m![2]! <= 31) || (+m![1]! === 192 && +m![2]! === 168), 'inside a private address range');
});

test('Compose: no file sets a secret, gives the container more power than the image has, or mounts the Docker socket', () => {
  for (const file of COMPOSE) {
    const doc = compose(file);
    for (const [name, svc] of Object.entries(doc.services as Record<string, any>)) {
      for (const [k, v] of Object.entries((svc.environment ?? {}) as Record<string, Yaml>)) {
        if (/KEY|TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL/i.test(k)) assert.fail(`${file}: ${name} sets ${k}; a secret belongs in the shell or an .env file, shown here only as a commented example`);
        assert.ok(typeof v === 'string' || typeof v === 'boolean', `${file}: ${k} has a plain value`);
      }
      for (const bad of ['privileged', 'cap_add', 'network_mode', 'pid', 'ipc', 'devices', 'user']) assert.ok(!(bad in svc), `${file}: ${name} sets ${bad}`);
      for (const v of (svc.volumes ?? []) as string[]) assert.ok(!/docker\.sock|^\/(?:$|:)|^\/(?:etc|var|usr|root|home):/.test(v), `${file}: ${name} mounts ${v}`);
    }
  }
  // The one commented-out example of a secret says to change it, so pasting it unchanged is not a working password.
  assert.match(read('compose.yaml'), /# TABULARIUS_MCP_TOKEN: change-me/);
});

test('Compose: the folder, the port, the restart policy and the stop time fit the image', () => {
  const e = env();
  const volume = (file: string) => (service(file).volumes as string[]).find((v) => v.endsWith(':/data'));
  for (const file of ['compose.yaml', 'compose.https.yaml']) {
    assert.equal(volume(file), './Databases:/data', `${file}: the folder people put files in, mounted where the image serves`);
    assert.equal(service(file).restart, 'unless-stopped');
    assert.equal(service(file).init, true, `${file}: a small init, so stopped children do not pile up and signals are passed on`);
    assert.equal(service(file).build, '.');
  }
  assert.ok(read('.dockerignore').split('\n').includes('Databases'), 'the folder the files live in never goes into a build');
  assert.deepEqual(service('compose.yaml').ports, [`127.0.0.1:${e.PORT}:${e.PORT}`], 'published on the port the pages say, 8080, to this computer only');
  assert.equal(e.PORT, '8080');
  assert.ok(!('ports' in service('compose.https.yaml')), 'behind Caddy the server itself publishes nothing');
  assert.deepEqual(service('compose.https.yaml').expose, [e.PORT]);
  assert.deepEqual(service('compose.https.yaml', 'caddy').ports, ['80:80', '443:443'], 'Caddy publishes 80 (certificates and redirects) and 443');
  // The stop time is longer than the longest the server's own service stop waits for the final save.
  const stopWait = Number(/TABULARIUS_STOP_GRACE_MS, (\d+)_000\)/.exec(read('packages/cli/src/service.ts'))?.[1]);
  assert.ok(stopWait >= 1);
  for (const file of COMPOSE) {
    const grace = /^(\d+)s$/.exec(String(service(file).stop_grace_period))?.[1];
    assert.ok(grace, `${file} gives a stop time in seconds`);
    assert.ok(+grace > stopWait, `${file}: ${grace} s is not longer than the ${stopWait} s the server may take to save`);
  }
});

test('Compose: the hardened file layers on the base file and drops what the server does not need', () => {
  const hardened = service('compose.hardened.yaml');
  assert.ok(service('compose.yaml'), 'it layers onto a service that exists in compose.yaml');
  assert.equal(Object.keys(compose('compose.hardened.yaml').services).join(), 'tabularius');
  assert.equal(hardened.read_only, true);
  assert.deepEqual(hardened.tmpfs, [env().TMPDIR], 'the one writable place besides /data is the image\'s temporary folder');
  assert.deepEqual(hardened.cap_drop, ['ALL']);
  assert.deepEqual(hardened.security_opt, ['no-new-privileges:true']);
  assert.ok(!('cap_add' in hardened) && !('privileged' in hardened));
  assert.ok(read('compose.hardened.yaml').includes('-f compose.yaml -f compose.hardened.yaml'), 'its header gives the command that layers it');
  assert.equal(compose('compose.hardened.yaml').version, undefined, 'no obsolete "version:" line');
});

test('HTTPS setup: the name, the proxy header, the trusted network and the Caddy upstream agree', () => {
  const https = compose('compose.https.yaml');
  const server = service('compose.https.yaml');
  const caddy = read('Caddyfile');
  const site = /^([A-Za-z0-9.-]+) \{$/m.exec(caddy)?.[1];
  assert.ok(site, 'the Caddyfile has one site');
  assert.equal(new URL(server.environment.TABULARIUS_PUBLIC_URL).host, site, 'the address the server announces is the name Caddy answers to');
  assert.equal(site, 'filemaker.example.com', 'an example.com name (reserved, never real), which both files and the comments say to replace');
  assert.match(read('compose.https.yaml') + caddy, /replace/i);
  assert.match(caddy, new RegExp(`reverse_proxy tabularius:${env().PORT}\\b`), 'Caddy forwards to the compose service by name and the image\'s port');
  assert.ok('tabularius' in https.services, 'the service Caddy names exists');
  assert.equal(server.environment.TABULARIUS_PROXY_HEADER, 'X-Forwarded-For', 'Caddy sets this header on every request and ignores the one a client sends (Caddy reverse_proxy documentation)');
  assert.equal(withDefaults(server.environment.TABULARIUS_TRUSTED_PROXIES), withDefaults(https.networks.default.ipam.config[0].subnet), 'only the Compose network, where Caddy is, is trusted');
  assert.deepEqual(https.services.caddy.depends_on, ['tabularius']);
  assert.ok('caddy-data' in https.volumes && (https.services.caddy.volumes as string[]).includes('caddy-data:/data'), 'certificates survive a restart');
  const mounted = (https.services.caddy.volumes as string[]).find((v) => v.endsWith(':/etc/caddy/Caddyfile:ro'))!;
  assert.ok(existsSync(join(root, mounted.split(':')[0]!)) && mounted.endsWith(':ro'), 'the Caddyfile that is mounted exists and is read-only to Caddy');
  assert.match(String(https.services.caddy.image), /^caddy:\d+$/, 'Caddy is pinned to a major version');
  assert.match(read('packages/cli/src/main.ts'), /--proxy-header/, 'the server has the option the variable stands for');
  assert.match(read('packages/cli/src/main.ts'), /--trusted-proxies/);
});

test('the pages tell people commands that name real files, the right port and the folder the image serves', () => {
  const pages = ['README.md', 'ADMIN.md', 'QUICKSTART.md', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`), 'Dockerfile', ...COMPOSE]
    .filter((f) => existsSync(join(root, f)));
  const e = env();
  let compose_ = 0;
  let execs = 0;
  for (const page of pages) {
    read(page).split('\n').forEach((line, i) => {
      const where = `${page}:${i + 1}`;
      for (const m of line.matchAll(/docker compose((?: -f \S+)*) (up|down|build|logs|ps|restart|pull|exec)\b/g)) {
        compose_++;
        const files = [...(m[1] ?? '').matchAll(/-f (\S+)/g)].map((x) => x[1]!);
        for (const f of files) assert.ok(COMPOSE.includes(f), `${where}: ${f} is not a Compose file in this repository`);
        if (files.includes('compose.hardened.yaml')) assert.equal(files[0], 'compose.yaml', `${where}: the hardened file only layers onto compose.yaml`);
        if (m[2] === 'up' && !files.length) assert.ok(/up -d\b/.test(line), `${where}: "up" runs in the background (-d) so the shell is free`);
      }
      for (const m of line.matchAll(/docker compose exec (?:-T )?tabularius tabularius ([a-z-]+)((?: \S+)*)/g)) {
        execs++;
        assert.match(read('packages/cli/src/main.ts'), new RegExp(`cmd === '${m[1]}'|case '${m[1]}'`), `${where}: Tabularius ${m[1]} is not a command`);
        assert.ok(m[2]!.trim().startsWith('/data'), `${where}: the folder inside the container is /data`);
      }
      if (/docker run\b/.test(line)) {
        assert.match(line, new RegExp(`-p ${e.PORT}:${e.PORT}\\b`), `${where}: publishes the port the image listens on`);
        assert.match(line, /:\/data\b/, `${where}: mounts the folder at /data`);
      }
      if (/docker (?:build|buildx build)\b/.test(line)) assert.match(line, / \.\s*$/, `${where}: builds from the repository folder`);
      for (const m of line.matchAll(/compose[\w.-]*\.ya?ml/g)) assert.ok(existsSync(join(root, m[0])), `${where} names ${m[0]}, which does not exist`);
    });
  }
  assert.ok(compose_ >= 5, `found ${compose_} compose commands in the pages`);
  assert.ok(execs >= 2, 'the README shows how to set the console and account passwords in the container');
  // The chown the pages ask for is for the uid the image's user has, and the same text is where the Dockerfile says it.
  assert.match(read('Dockerfile'), /chown 1000:1000 Databases/);
  assert.match(read('README.md'), /mkdir Databases && sudo chown 1000:1000 Databases/);
  assert.match(read('compose.yaml'), /sudo chown 1000:1000 Databases/);
});

// Not checked here, because there is no Docker in this test: that `node:22-slim` and `caddy:2` exist and are published for both
// amd64 and arm64 (checked once by hand against Docker Hub's tag list, not by this test); that the image's "node" user is uid
// 1000 (the Node image documents it, and the pages and Dockerfile depend on it); that Compose merges the three files the way
// the pages describe; and that Caddy obtains a certificate. packages/server/test/docker.test.ts builds and runs the image when
// TABULARIUS_DOCKER_TEST=1.

test('the image takes the commit as a build argument and writes it where --version reads it, since it holds no .git', () => {
  const arg = ofKind('ARG').find((s) => s.args.startsWith('TABULARIUS_COMMIT'));
  assert.ok(arg, 'a TABULARIUS_COMMIT build argument');
  const run = ofKind('RUN').find((s) => s.args.includes('build-info.json'));
  assert.ok(run, 'a step that writes build-info.json');
  assert.ok(run.no > arg.no, 'after the argument is declared');
  assert.match(run.args, /packages\/server\/build-info\.json/);
  assert.ok(ofKind('COPY').every((s) => !/build-info/.test(s.args)), 'it is not copied in from the checkout (it is git-ignored)');
  assert.match(read('packages/server/src/version.ts'), /BUILD_INFO = 'build-info\.json'/);
  assert.match(read('.gitignore'), /^packages\/server\/build-info\.json$/m);
});
