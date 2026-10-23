import { parentPort, workerData } from 'node:worker_threads';
import { compactStore } from './compaction.ts';
import { freeBytes } from './disk.ts';

const { path, convert, checkpoint = true } = workerData as { path: string; convert: boolean; checkpoint?: boolean };
try { parentPort!.postMessage({ report: compactStore(path, freeBytes(path), 5000, convert, checkpoint) }); }
catch (e) { parentPort!.postMessage({ error: (e as Error).message }); }
