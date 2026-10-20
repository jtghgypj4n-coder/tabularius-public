/** A streaming quota check, independent of the form's interpretation. No part payload is retained. */
export const MAX_MULTIPART_PARTS = 100;
export const MAX_PART_HEADERS = 16 * 1024;
export const MAX_BOUNDARY_BYTES = 200;

export class MultipartLimitError extends Error {
  readonly status: number;
  constructor(message: string, status = 413) { super(message); this.status = status; }
}

export class MultipartLimits {
  private readonly delimiter: Buffer;
  private pending = Buffer.alloc(0);
  private state: 'start' | 'headers' | 'body' | 'done' = 'start';
  parts = 0;
  constructor(contentType: string) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    // Use the exact same bytes as the form parser, including quoted spaces.
    const boundary = match?.[1] ?? match?.[2] ?? '';
    if (!boundary || Buffer.byteLength(boundary) > MAX_BOUNDARY_BYTES || /[\r\n]/.test(boundary)) {
      throw new MultipartLimitError('Invalid multipart boundary', 400);
    }
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
  }
  push(chunk: Buffer): void {
    if (this.state === 'done') return;
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      if (this.state === 'headers') {
        const end = this.pending.indexOf('\r\n\r\n');
        if (end < 0 ? this.pending.length > MAX_PART_HEADERS + 3 : end > MAX_PART_HEADERS) throw new MultipartLimitError('Multipart part headers too large');
        if (end < 0) return;
        this.pending = this.pending.subarray(end + 4);
        this.state = 'body';
      }
      const marker = this.state === 'start' ? this.delimiter.subarray(2) : this.delimiter;
      const at = this.pending.indexOf(marker);
      if (at < 0) {
        // Copy a tiny tail: a subarray would retain an entire network chunk.
        this.pending = Buffer.from(this.pending.subarray(Math.max(0, this.pending.length - marker.length - 2)));
        return;
      }
      const after = at + marker.length;
      if (this.pending.length < after + 2) { this.pending = Buffer.from(this.pending.subarray(at)); return; }
      const suffix = this.pending.toString('latin1', after, after + 2);
      if (suffix === '--') { this.pending = Buffer.alloc(0); this.state = 'done'; return; }
      if (suffix !== '\r\n') { this.pending = this.pending.subarray(at + 1); continue; }
      if (++this.parts > MAX_MULTIPART_PARTS) throw new MultipartLimitError('Too many multipart parts');
      this.pending = this.pending.subarray(after + 2);
      this.state = 'headers';
    }
  }
}
