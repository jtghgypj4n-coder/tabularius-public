import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateText, checkFormula, num, text } from '../../calc/src/index.ts';
import { parseManifest, PluginRegistry, type PluginManifest } from '../src/index.ts';

const troi = (over: Record<string, unknown> = {}): PluginManifest => {
  const r = parseManifest({
    id: 'org.example.troi-file', name: 'Troi File compatibility', version: '1.0.0', api: '^1.0', publisher: 'Example',
    main: 'main.js', owners: ['TrFl'],
    functions: [
      { name: 'TrFile_Exists', owner: 'TrFl', index: 12, min: 1, max: 2, pure: true },
      { name: 'TrFile_Version', min: 0, max: 0 },
    ],
    ...over,
  });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.manifest;
};
const code = { TrFile_Exists: () => num(1), TrFile_Version: () => text('12.0') };

test('every external permission overrides purity for named and decoded functions', () => {
  for (const permissions of [{ files: ['documents:read'] }, { network: ['example.com'] }, { mail: true }, { secrets: ['KEY'] }]) {
    const reg = new PluginRegistry();
    const manifest = troi({ permissions });
    reg.install(manifest, code);
    reg.enable('Shop', manifest.id);
    for (const name of ['TrFile_Exists', '⟨TrFl:12⟩']) assert.equal(reg.lookup('Shop')(name)?.pure, false, JSON.stringify(permissions));
  }
});

test('identical callback source with different closures cannot share results without an explicit cache key', () => {
  const make = (value: number) => () => num(value);
  const a = make(1), b = make(2);
  assert.equal(a.toString(), b.toString());
  const install = (call: typeof a & { cacheKey?: string }) => {
    const reg = new PluginRegistry();
    reg.install(troi(), { ...code, TrFile_Exists: call });
    reg.enable('Shop', troi().id);
    return reg.lookup('Shop')('TrFile_Exists')!;
  };
  assert.notEqual(install(a).cacheKey, install(b).cacheKey);
  // All callbacks must identify their code/configuration for the installation key to be shared.
  const stable = () => {
    const reg = new PluginRegistry();
    reg.install(troi(), Object.fromEntries(Object.entries(code).map(([name, call]) => [name, Object.assign(call.bind(null), { cacheKey: name + ':v1' })])));
    reg.enable('Shop', troi().id);
    return reg.lookup('Shop')('TrFile_Exists')!.cacheKey;
  };
  assert.equal(stable(), stable());
});

test('a manifest is checked before anything is installed', () => {
  assert.equal(troi().permissions.timeoutMs, 250);
  const bad = parseManifest({ id: 'x', name: '', version: '1', api: '', publisher: 'p', main: '../a.js', functions: [] });
  assert.equal(bad.ok, false);
  const twice = parseManifest({ ...troi(), functions: [{ name: 'A', min: 0 }, { name: 'a', min: 0 }] });
  assert.ok(!twice.ok && twice.errors.some((e) => e.includes('provided twice')));
  const owner = parseManifest({ ...troi(), owners: [] });
  assert.ok(!owner.ok && owner.errors.some((e) => e.includes("isn't in owners")));
  assert.equal(parseManifest({ ...troi(), functions: [{ name: 'X', owner: 'TrFl', min: 0 }] }).ok, false);
});

test('a file sees only the plug-ins enabled for it, by name and by the reader\'s marker', () => {
  const reg = new PluginRegistry();
  reg.install(troi(), code);
  const off = { plugin: reg.lookup('Invoices') };
  assert.equal(evaluate('TrFile_Exists ( "a" )', off).value, '?');
  reg.enable('Invoices', 'org.example.troi-file');
  const on = { plugin: reg.lookup('invoices') };
  assert.equal(evaluateText('TrFile_Exists ( "a" )', on), '1');
  assert.equal(evaluateText('⟨TrFl:12⟩ ( "a" )', on), '1');
  assert.equal(evaluateText('TrFile_Version', on), '12.0');
  assert.equal(evaluate('TrFile_Exists ( "a" )', { plugin: reg.lookup('Other') }).value, '?');
  assert.equal(checkFormula('TrFile_Exists ( 1 ; 2 ; 3 )', { plugins: reg.signatures('Invoices') }).ok, false);
  const installed = { installedPlugins: () => reg.installedFor('Invoices') };
  assert.equal(evaluateText('Get ( InstalledFMPlugins )', installed), 'BaseElements;tabularius;Enabled\rTroi Text;tabularius;Enabled\rTroi Dialog;tabularius;Enabled\rTroi File compatibility;1.0.0;Enabled');
  assert.equal(evaluateText('Get ( InstalledFMPlugins )', { installedPlugins: () => reg.installedFor('Other') }), 'BaseElements;tabularius;Enabled\rTroi Text;tabularius;Enabled\rTroi Dialog;tabularius;Enabled\rTroi File compatibility;1.0.0;Disabled');
  const json = JSON.parse(evaluateText('Get ( InstalledFMPluginsAsJSON )', installed));
  assert.equal(json.APIVers, 2);
  assert.deepEqual(json.plugins.map((p: { id: string; state: string }) => [p.id, p.state]), [['GyBE', 'Enabled'], ['', 'Enabled'], ['', 'Enabled'], ['TrFl', 'Enabled']]);
  assert.equal(JSON.parse(evaluateText('Get ( InstalledFMPluginsAsJSON )')).plugins, null);
  assert.throws(() => reg.uninstall('org.example.troi-file'), /enabled for invoices/);
  reg.disable('Invoices', 'org.example.troi-file');
  assert.equal(evaluate('TrFile_Exists ( "a" )', { plugin: reg.lookup('Invoices') }).value, '?');
  reg.uninstall('org.example.troi-file');
});

test('installing and enabling refuse what would be ambiguous', () => {
  const reg = new PluginRegistry();
  assert.throws(() => reg.install(troi(), { TrFile_Exists: code.TrFile_Exists }), /no code for TrFile_Version/);
  assert.throws(() => reg.install(troi({ functions: [{ name: 'Left', min: 2 }] }), { Left: code.TrFile_Version }), /already a function/);
  reg.install(troi(), code);
  reg.install(troi({ id: 'org.other.troi', functions: [{ name: 'Other_Exists', owner: 'TrFl', index: 12, min: 1 }] }), { Other_Exists: code.TrFile_Exists });
  reg.enable('Invoices', 'org.example.troi-file');
  assert.throws(() => reg.enable('Invoices', 'org.other.troi'), /clashes.*⟨trfl:12⟩/);
  assert.throws(() => reg.enable('Invoices', 'org.none'), /isn't installed/);
});
