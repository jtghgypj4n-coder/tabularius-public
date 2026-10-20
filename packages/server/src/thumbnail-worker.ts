// Makes thumbnails off the main thread: decoding a big photo takes a moment.

import { parentPort } from 'node:worker_threads';
import { thumbnailOf } from './thumbnails.ts';

parentPort!.on('message', ({ id, data, size }: { id: number; data: Uint8Array; size: number }) => {
  let png: Uint8Array | undefined;
  try {
    png = thumbnailOf(data, size);
  } catch {
    png = undefined; // a damaged or unusual file: no thumbnail
  }
  parentPort!.postMessage({ id, png });
});
