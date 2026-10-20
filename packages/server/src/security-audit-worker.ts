// Hash the full read-only snapshot away from the serving thread.
import { parentPort, workerData } from 'node:worker_threads';
import { verifySecurityAudit } from '../../store/src/security-chain.ts';
import { verifyRecordAudit } from '../../store/src/record-chain.ts';

parentPort!.postMessage(workerData.chain === 'records' ? verifyRecordAudit(workerData.path) : verifySecurityAudit(workerData.path));
