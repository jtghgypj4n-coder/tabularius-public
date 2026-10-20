// A worker process of a cluster (see cluster.ts): hosts the folder on its
// Unix socket with the role the front process gives it.

import { PASSWORD_POLICY } from '../../store/src/index.ts';
import { ClusterLink } from './cluster.ts';
import { serve } from './index.ts';

// The front process gone (crashed or killed): nothing can reach this worker any more.
process.once('disconnect', () => process.exit(0));
// Ctrl-C in a terminal and a service manager's stop signal reach the whole process group: the front process
// stops the workers itself, in order (with encryption at rest the leader last, locking the files as it goes).
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

process.once('message', async (m: { t: string; role: ConstructorParameters<typeof ClusterLink>[0]; opts: Parameters<typeof serve>[0]; blankFromNetwork: boolean }) => {
  const send = (msg: unknown) => {
    if (process.connected) process.send!(msg, (e: Error | null) => e && console.error(e.message));
  };
  const link = new ClusterLink(m.role, send);
  if (m.blankFromNetwork) PASSWORD_POLICY.blankFromNetwork = true;
  // Listening from the start: a stop sent while it is still starting is kept, not lost.
  let server: Awaited<ReturnType<typeof serve>>['server'] | undefined;
  let stopping = false;
  const stop = () => server!.close(() => process.exit(0));
  process.on('message', (msg: Parameters<ClusterLink['receive']>[0]) => {
    if (msg.t === 'stop') {
      stopping = true;
      if (server) stop();
    } else if (server) link.receive(msg);
  });
  try {
    server = (await serve({ ...m.opts, log: (text) => link.log(text), cluster: link })).server;
    if (stopping) return stop();
    send({ t: 'ready' });
  } catch (e) {
    link.log(`could not start: ${(e as Error).message}`);
    process.exit(1);
  }
});
