import { spawn } from 'node:child_process';

/** Run independent CLI checks concurrently while retaining each command's real exit and output. */
export function runCli(entry: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', entry, ...args], {
      env: options.env,
      timeout: options.timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let error: Error | undefined;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (cause: Error) => { error = cause; });
    child.on('close', (status) => resolve({ status, stdout, stderr, error }));
  });
}
