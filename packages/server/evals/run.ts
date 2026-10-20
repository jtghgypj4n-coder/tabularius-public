// npm run evals [-- --live] [-- --record] [-- --case <id>,...] [-- --model <id>] [-- --max-usd 2]
// npm run eval:ai [-- --models claude-haiku-5-5,claude-sonnet-5-5,routed] [-- --case <id>,...]
//
// Replays the recorded answers by default (free, offline). --live asks the real model with the key from
// ANTHROPIC_API_KEY or ~/.openhbam/anthropic-key; --record (with --live) saves its answers as the fixtures.
// eval:ai is the live run. --models runs every case once per model (each answering every call; "routed" is the
// server's own choice between its main and fast models) and prints accuracy, tokens, cost and time side by side.
// A live run stops asking once it has cost --max-usd dollars at list prices (default 2, per model with --models).

import { parseArgs } from 'node:util';
import { resolveAiKey } from '../../cli/src/ai-key.ts';
import { compare, report, runEvals, type ModelRun } from './harness.ts';

const { values } = parseArgs({
  options: { live: { type: 'boolean' }, record: { type: 'boolean' }, case: { type: 'string' }, model: { type: 'string' }, models: { type: 'string' }, 'ai-key-file': { type: 'string' }, 'max-usd': { type: 'string' } },
});
if (values.record && !values.live) {
  console.error('evals: --record needs --live (it saves what the real model answers)');
  process.exit(2);
}
const models = values.models?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
if (models.length && !values.live) {
  console.error('evals: --models needs --live (recorded answers are the same whichever model is named)');
  process.exit(2);
}
if (models.length && (values.model || values.record)) {
  console.error('evals: --models compares models; leave out --model and --record');
  process.exit(2);
}
let apiKey: string | undefined;
if (values.live) {
  try {
    apiKey = resolveAiKey(process.env, values['ai-key-file']).apiKey;
  } catch (e) {
    console.error((e as Error).message.replace(/^serve: --ai/, 'evals: --live'));
    process.exit(2);
  }
}
const maxUsd = Number(values['max-usd'] ?? 2);
if (!(maxUsd > 0)) {
  console.error('evals: --max-usd needs a number of dollars above 0');
  process.exit(2);
}
const only = values.case?.split(',').map((s) => s.trim()).filter(Boolean);
if (models.length) {
  const runs: ModelRun[] = [];
  for (const m of models) {
    console.log(`\n${m}`);
    const routed = m === 'routed';
    const results = await runEvals({ mode: 'live', apiKey, only, maxUsd, ...(routed ? {} : { model: m, assistant: { fastModel: 'off' } }), log: (l) => console.log(`  ${l}`) });
    runs.push({ label: m, results });
  }
  console.log('\n' + compare(runs));
  process.exit(0);
}
const results = await runEvals({
  mode: values.live ? 'live' : 'replay', record: values.record, apiKey, model: values.model,
  only, maxUsd,
  log: (l) => console.log(l),
});
console.log('\n' + report(results));
const handWritten = results.filter((r) => r.fixtureSource && r.fixtureSource !== 'recorded').length;
if (handWritten) console.log(`${handWritten} case(s) replay hand-written answers; run npm run evals -- --live --record to record real ones.`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
