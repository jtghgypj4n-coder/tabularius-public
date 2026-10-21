import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as requirePath from 'node:path';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { serviceFile, type Platform, type ServiceOptions } from '../src/service.ts';
import { parseUnit, parseXml, readPlist, systemdWords } from './service-validators.ts';

const options = (platform: Platform): ServiceOptions => ({
  platform, folder: platform === 'win32' ? 'C:\\Data' : '/srv/data', port: 8080, host: '127.0.0.1',
  system: false, extra: [], node: platform === 'win32' ? 'C:\\tabularius.exe' : '/usr/bin/tabularius',
  main: platform === 'win32' ? 'C:\\runtime\\packages\\cli\\src\\main.ts' : '/runtime/packages/cli/src/main.ts',
  user: 'test', home: platform === 'win32' ? 'C:\\home' : '/srv/test/.openhbam', singleFile: true,
});

test('AR-cli-plugins-tooling-05', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const o = options(platform);
    const generated = serviceFile(o).text;
    let args: string[];
    if (platform === 'darwin') args = readPlist(generated).ProgramArguments as string[];
    else if (platform === 'linux') {
      const line = parseUnit(generated, []).find(([, name]) => name === 'ExecStart')![2];
      args = systemdWords(line);
    } else {
      const action = parseXml(generated, [])!.children.find((node) => node.name === 'Actions')!.children[0];
      const command = action.children.find((node) => node.name === 'Command')!.text;
      const argumentText = action.children.find((node) => node.name === 'Arguments')!.text;
      args = [command, ...argumentText.split(' ')];
    }
    assert.equal(args[0], o.node, platform);
    assert.ok(!args.includes('--eval'), platform);
    assert.ok(!args.includes(o.main), platform);
    assert.deepEqual(args.slice(-6), ['serve', o.folder, '--port', '8080', '--host', '127.0.0.1'], platform);
    const launcher = readFileSync(join(import.meta.dirname, '..', '..', '..', 'scripts', 'release', 'launcher.cjs'), 'utf8');
    const argv = [o.node, o.node, ...args.slice(1)];
    let selected: string[] | undefined;
    const root = '/srv/test/.openhbam/runtime/1.0.0';
    const fakeProcess = { argv, execPath: o.node, env: { TABULARIUS_HOME: '/srv/test/.openhbam' }, emitWarning: () => {} };
    const moduleRequire = (name: string) => {
      if (name === 'node:sea') return { getAsset: () => '1.0.0' };
      if (name === 'node:module') return { createRequire: () => (entry: string) => { selected = [entry, ...fakeProcess.argv.slice(2)]; } };
      if (name === 'node:fs') return { existsSync: (path: string) => path === join(root, '.complete') };
      if (name === 'node:os') return { homedir: () => '/srv/test' };
      if (name === 'node:path') return requirePath;
      if (name === 'node:zlib') return { gunzipSync: () => { throw new Error('unexpected unpack'); } };
      throw new Error(`unexpected module ${name}`);
    };
    runInNewContext(launcher, { require: moduleRequire, process: fakeProcess });
    assert.deepEqual(selected, [join(root, 'packages', 'cli', 'src', 'main.ts'), ...args.slice(2)]);
    assert.equal(selected?.[1], 'serve');
  }
});
