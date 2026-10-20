// Minimal protocol-buffers wire-format reader. FileMaker 12+ stores layout
// objects, parts and themes as protobuf messages; we have no .proto files,
// so fields are read by number.

export interface PbField {
  /** Field number. */
  n: number;
  /** Wire type: 0 varint, 1 fixed64 (double), 2 bytes, 5 fixed32 (float). */
  wire: number;
  /** Number for wire types 0, 1, 5; bytes for 2. */
  value: number | Uint8Array;
}

/** Parses one message. Returns undefined when the bytes are not a well-formed message. */
export function pbParse(b: Uint8Array): PbField[] | undefined {
  const out: PbField[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const varint = (): number => {
    let v = 0;
    let m = 1;
    for (;;) {
      if (p >= b.length) throw new RangeError('truncated varint');
      const x = b[p++];
      v += (x & 0x7f) * m;
      m *= 128;
      if (!(x & 0x80)) return v;
    }
  };
  try {
    while (p < b.length) {
      const tag = varint();
      const n = Math.floor(tag / 8);
      const wire = tag & 7;
      if (n === 0) return undefined;
      if (wire === 0) out.push({ n, wire, value: varint() });
      else if (wire === 1) {
        if (p + 8 > b.length) return undefined;
        out.push({ n, wire, value: view.getFloat64(p, true) });
        p += 8;
      } else if (wire === 5) {
        if (p + 4 > b.length) return undefined;
        out.push({ n, wire, value: view.getFloat32(p, true) });
        p += 4;
      } else if (wire === 2) {
        const len = varint();
        if (p + len > b.length) return undefined;
        out.push({ n, wire, value: b.subarray(p, p + len) });
        p += len;
      } else return undefined;
    }
  } catch {
    return undefined;
  }
  return out;
}

/** A parsed message with lookup helpers. */
export class Pb {
  readonly fields: PbField[];

  constructor(fields: PbField[]) {
    this.fields = fields;
  }

  static parse(b: Uint8Array | undefined): Pb | undefined {
    const f = b && pbParse(b);
    return f ? new Pb(f) : undefined;
  }

  num(n: number): number | undefined {
    const f = this.fields.find((x) => x.n === n && x.wire !== 2);
    return f?.value as number | undefined;
  }

  nums(n: number): number[] {
    return this.fields.filter((x) => x.n === n && x.wire !== 2).map((x) => x.value as number);
  }

  bytes(n: number): Uint8Array | undefined {
    const f = this.fields.find((x) => x.n === n && x.wire === 2);
    return f?.value as Uint8Array | undefined;
  }

  str(n: number): string | undefined {
    const b = this.bytes(n);
    return b && new TextDecoder().decode(b);
  }

  msg(n: number): Pb | undefined {
    return Pb.parse(this.bytes(n));
  }

  msgs(n: number): Pb[] {
    const out: Pb[] = [];
    for (const f of this.fields) {
      if (f.n !== n || f.wire !== 2) continue;
      const m = Pb.parse(f.value as Uint8Array);
      if (m) out.push(m);
    }
    return out;
  }
}
