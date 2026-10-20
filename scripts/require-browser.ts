// Fails when no Chromium can be found. The browser tests skip (never fail) on a
// machine without one, which is right for `npm test` but would let the browser
// workflow go green having run nothing. Run before them in CI.
import { findChromium } from './chromium.ts';

const found = findChromium();
if (!found) {
  console.error('No Chromium found. Install Chrome or Chromium, or set TABULARIUS_CHROMIUM to its executable.');
  process.exit(1);
}
console.log(`Chromium: ${found}`);
