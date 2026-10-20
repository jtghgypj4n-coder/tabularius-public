import type { IncomingMessage, ServerResponse } from 'node:http';

/** Maximum envelope while credentials still need to be verified from the body. */
export const AUTH_BODY_LIMIT = 64 * 1024;
/** Discarding is time-bounded, never buffered: even a stalled sender is closed promptly. */
export const BODY_DRAIN_TIMEOUT_MS = 2000;

/** An ignored body is never parsed or retained. Drain small bodies for connection reuse;
 * leave larger ones to the bounded post-response discard without changing the route's result. */
export async function drainSmallBody(req: IncomingMessage): Promise<void> {
  const length = Number(req.headers['content-length']);
  if (req.readableEnded || req.destroyed || length > AUTH_BODY_LIMIT || (!length && !req.headers['transfer-encoding'])) return;
  await new Promise<void>(resolve => {
    let size = 0;
    const done = () => {
      req.off('data', data);
      req.off('end', done);
      req.off('error', done);
      req.off('close', done);
      resolve();
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > AUTH_BODY_LIMIT) {
        req.pause();
        done();
      }
    };
    req.on('data', data);
    req.once('end', done);
    req.once('error', done);
    req.once('close', done);
  });
}

/** Invoked only for checkContinue, instead of Node's automatic, pre-authentication 100. */
export function continueOnRead(req: IncomingMessage, res: ServerResponse): void {
  const reading = (event: string | symbol) => {
    if (event !== 'data' && event !== 'readable') return;
    req.off('newListener', reading);
    if (!res.headersSent && !res.writableEnded) res.writeContinue();
  };
  req.on('newListener', reading);
  res.once('finish', () => req.off('newListener', reading));
}

/** Preserve the refusal while bounding unread-body disposal, and keep small successful requests reusable. */
export function closeUnreadBody(req: IncomingMessage, res: ServerResponse): void {
  const writeHead = res.writeHead;
  res.writeHead = function (this: ServerResponse, ...args: Parameters<ServerResponse['writeHead']>) {
    const length = Number(req.headers['content-length']);
    const unread = !req.readableEnded && (length > 0 || req.headers['transfer-encoding']);
    if (!unread) return writeHead.apply(this, args);

    const socket = req.socket;
    const keepAlive = Number(args[0]) >= 200 && Number(args[0]) < 300 && length > 0 && length <= AUTH_BODY_LIMIT
      && req.headers.expect?.toLowerCase() !== '100-continue';
    if (!keepAlive) {
      res.setHeader('connection', 'close');
      res.shouldKeepAlive = false;
      // Node calls destroySoon at response finish for Connection: close. That destroys
      // the read side too, turning an otherwise deliverable refusal into TCP RST.
      // Half-close instead: the response/FIN goes out while the peer can finish writing.
      const destroySoon = socket.destroySoon;
      socket.destroySoon = function () {
        socket.destroySoon = destroySoon;
        socket.end();
        return socket;
      };
    }
    // Set headers before attaching the discard reader: checkContinue must not invite
    // a refused body. No chunks are retained. A time bound allows send-then-read clients
    // to finish a large write, while cutting off slow or never-ending senders after 2 s.
    const answer = writeHead.apply(this, args);
    const timer = setTimeout(() => socket.destroy(), BODY_DRAIN_TIMEOUT_MS);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('close', cleanup);
      req.off('end', drained);
    };
    const drained = () => { if (keepAlive) cleanup(); };
    socket.once('close', cleanup);
    req.once('end', drained);
    req.resume();
    return answer;
  } as ServerResponse['writeHead'];
}
