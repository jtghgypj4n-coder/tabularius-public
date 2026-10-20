// Checks one hosted file's pages off the request path (host.ts, scanIntegrity): SQLite's quick check reads the whole
// file, which on a large one takes seconds, and must not hold up the requests of the others.

import { parentPort, workerData } from 'node:worker_threads';
import { pageCheck } from './backup-verify.ts';

parentPort!.postMessage(pageCheck((workerData as { path: string; quick?: boolean }).path, (workerData as { quick?: boolean }).quick !== false));
