// The product was called openhbam before it was Tabularius. A setting made under the old name still counts: each
// OPENHBAM_* variable is copied to its TABULARIUS_* name unless that one is set too. Import this first, before
// anything reads the environment.

export function applyLegacyEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('OPENHBAM_')) continue;
    const next = 'TABULARIUS_' + name.slice('OPENHBAM_'.length);
    if (env[next] === undefined) env[next] = value;
  }
}

applyLegacyEnv();
