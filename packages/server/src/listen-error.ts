// Why the server couldn't open its port, in words an administrator can act on.

/** A clear error for a port that couldn't be opened. */
export function listenError(e: Error, port: number, hostname: string): Error {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    return new Error(`port ${port} is in use: another program is already listening on ${hostname}:${port}. Stop it, or start Tabularius on a free port with --port (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\` shows which program)`);
  }
  if (code === 'EACCES') return new Error(`port ${port} needs administrator rights on this system: use a port above 1024, or --system for a service`);
  return e;
}
