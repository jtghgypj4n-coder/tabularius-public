import { parentPort, workerData } from 'node:worker_threads';
import { compactStore } from './compaction.ts';
import { freeBytes } from './disk.ts';

const { path, convert } = workerData as { path: string; convert: boolean };
try { parentPort!.postMessage({ report: convert ? compactStore(path) : compactStore(path, freeBytes(path), 5000, false) }); }
catch (e) { parentPort!.postMessage({ error: (e as Error).message }); }
