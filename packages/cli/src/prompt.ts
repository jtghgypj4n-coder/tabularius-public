// Reading a password for a command: asked for in a terminal, hidden and
// twice to catch a typo, or read from a pipe (echo ... | tabularius passwd).
//
// Reading a terminal with readFileSync(0) fails on macOS ("EAGAIN: resource
// temporarily unavailable"), so a terminal is read a key at a time in raw mode.

import type { Readable, Writable } from 'node:stream';

export interface SecretInput extends Readable {
  isTTY?: boolean;
  setRawMode?: (raw: boolean) => unknown;
}

/** One line typed without echo; Ctrl-C or Ctrl-D before anything is typed cancels. */
function askHidden(question: string, input: SecretInput, output: Writable): Promise<string> {
  output.write(question);
  return new Promise((done, fail) => {
    let text = '';
    input.setRawMode?.(true);
    input.resume();
    const finish = (err?: Error) => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
      if (err) fail(err);
      else done(text);
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003' || (ch === '\u0004' && !text)) return finish(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
        else if (ch === '\u0015') text = ''; // Ctrl-U
        else if (ch >= ' ') text += ch;
      }
    };
    input.on('data', onData);
  });
}

async function readAll(input: Readable): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of input) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(parts).toString('utf8');
}

/**
 * A password: from a terminal, asked for hidden and (with `confirm`) twice;
 * otherwise what the input holds, less a final line break.
 */
export async function readSecret(what: string, opts: { confirm?: boolean; input?: SecretInput; output?: Writable } = {}): Promise<string> {
  const input = opts.input ?? (process.stdin as SecretInput);
  const output = opts.output ?? process.stderr;
  if (!input.isTTY) return (await readAll(input)).replace(/\r?\n$/, '');
  for (let tries = 0; tries < 3; tries++) {
    const first = await askHidden(`${what}: `, input, output);
    if (!first) throw new Error('empty password');
    if (!opts.confirm) return first;
    if (await askHidden(`${what} again: `, input, output) === first) return first;
    output.write("They don't match. Try again.\n");
  }
  throw new Error("the passwords didn't match");
}
