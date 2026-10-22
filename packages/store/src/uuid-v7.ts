import { randomBytes } from 'node:crypto';

/** UUIDv7 with injectable inputs. The random tail increments for calls in the same millisecond. */
export class UuidV7 {
  private lastMs = -1;
  private tail = 0n;
  private readonly clock: () => number;
  private readonly random: (size: number) => Uint8Array;

  constructor(clock: () => number = Date.now, random: (size: number) => Uint8Array = randomBytes) {
    this.clock = clock;
    this.random = random;
  }

  next(): string {
    const ms = Math.max(this.lastMs, Math.floor(this.clock()));
    if (!Number.isSafeInteger(ms) || ms < 0 || ms >= 2 ** 48) throw new RangeError('UUIDv7 clock is outside its 48-bit range');
    const mask = (1n << 74n) - 1n;
    if (ms === this.lastMs) {
      this.tail = (this.tail + 1n) & mask;
      if (this.tail === 0n) throw new RangeError('UUIDv7 sequence exhausted for one millisecond');
    } else {
      const bytes = this.random(10);
      if (bytes.length !== 10) throw new RangeError('UUIDv7 random source must return 10 bytes');
      this.tail = BigInt(`0x${Buffer.from(bytes).toString('hex')}`) & mask;
      this.lastMs = ms;
    }
    const bytes = Buffer.alloc(16);
    bytes.writeUIntBE(ms, 0, 6);
    bytes[6] = 0x70 | Number((this.tail >> 70n) & 0xfn);
    bytes[7] = Number((this.tail >> 62n) & 0xffn);
    bytes[8] = 0x80 | Number((this.tail >> 56n) & 0x3fn);
    for (let i = 9; i < 16; i++) bytes[i] = Number((this.tail >> BigInt((15 - i) * 8)) & 0xffn);
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
