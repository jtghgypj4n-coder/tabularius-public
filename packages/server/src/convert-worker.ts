// Converts one .fmp12 file off the main thread, so a large file dropped into
// the hosted folder doesn't stall the people already working.

import { parentPort, workerData } from 'node:worker_threads';
import { importFmp12 } from '../../store/src/index.ts';

const { src, dest, resume, passphrase } = workerData as { src: string; dest: string; resume?: boolean; passphrase?: string };
const stats = importFmp12(src, dest, (progress) => parentPort!.postMessage({ progress }), { resume, passphrase });
parentPort!.postMessage({ done: { tables: stats.length, records: stats.reduce((n, s) => n + s.records, 0) } });
