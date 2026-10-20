// Kept in JavaScript so the launcher can check Node before loading TypeScript.
const { engines } = require('../../../package.json');

/** The project's engines.node format is a single inclusive minimum. */
function minimumParts(range) {
  if (range === undefined) throw new Error('missing engines.node: expected >=major.minor[.patch]');
  if (typeof range !== 'string') throw new Error(`invalid engines.node ${JSON.stringify(range)}: expected a string >=major.minor[.patch]`);
  const match = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/.exec(range);
  if (!match) throw new Error(`unsupported engines.node ${JSON.stringify(range)}: expected >=major.minor[.patch]`);
  return match.slice(1).map((part) => Number(part ?? 0));
}

minimumParts(engines?.node);
const minimumNode = engines.node.slice(2);

/** Compare a stable Node version with a validated minimum. Prereleases never qualify. */
function nodeSupports(version, range) {
  const minimum = minimumParts(arguments.length > 1 ? range : engines?.node);
  if (typeof version !== 'string') return false;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match || match[4]) return false;
  const actual = match.slice(1, 4).map((part) => Number(part ?? 0));
  for (let i = 0; i < minimum.length; i++) {
    if (!Number.isInteger(actual[i])) return false;
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

module.exports = { minimumNode, nodeSupports };
