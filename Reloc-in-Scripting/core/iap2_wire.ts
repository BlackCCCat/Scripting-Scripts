import { concat, fromUtf8, readU16BE, u16be, utf8 } from "./bytes";

export const IAP2LinkFlags = {
  SYN: 0x80,
  ACK: 0x40,
  EAK: 0x20,
  RST: 0x10,
} as const;

export function additiveChecksum(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += bytes[i];
  return (256 - (sum & 0xff)) & 0xff;
}

export function verifyZeroSum(bytes: Uint8Array, start = 0, end = bytes.length): boolean {
  let sum = 0;
  for (let i = start; i < end; i++) sum += bytes[i];
  return (sum & 0xff) === 0;
}

export class IAP2Packet {
  readonly flags: number;
  readonly sequence: number;
  readonly acknowledgement: number;
  readonly session: number;
  readonly payload: Uint8Array;

  constructor(options: {
    flags: number;
    sequence: number;
    acknowledgement: number;
    session: number;
    payload?: Uint8Array | null;
  }) {
    this.flags = options.flags & 0xff;
    this.sequence = options.sequence & 0xff;
    this.acknowledgement = options.acknowledgement & 0xff;
    this.session = options.session & 0xff;
    this.payload = options.payload ? options.payload.slice() : new Uint8Array(0);
  }

  encode(): Uint8Array {
    const hasPayload = this.payload.length > 0;
    if (this.payload.length > 0xffff - 10) {
      throw new Error("iAP2 packet payload exceeds maximum length");
    }
    const totalSize = 9 + this.payload.length + (hasPayload ? 1 : 0);

    const header = new Uint8Array(9);
    header[0] = 0xff;
    header[1] = 0x5a;
    header[2] = (totalSize >>> 8) & 0xff;
    header[3] = totalSize & 0xff;
    header[4] = this.flags;
    header[5] = this.sequence;
    header[6] = this.acknowledgement;
    header[7] = this.session;
    header[8] = additiveChecksum(header, 0, 8);

    if (!hasPayload) return header;

    const checksumByte = new Uint8Array([additiveChecksum(this.payload)]);
    return concat(header, this.payload, checksumByte);
  }

  static validateHeaderData(header9: Uint8Array): number {
    if (header9.length !== 9) {
      throw new Error("Truncated link header");
    }
    const size = readU16BE(header9, 2);
    if (
      header9[0] !== 0xff ||
      header9[1] !== 0x5a ||
      !verifyZeroSum(header9, 0, 9) ||
      size < 9 ||
      size > 4096 ||
      size === 10
    ) {
      throw new Error("Malformed or oversized incoming iAP2 packet header");
    }
    return size;
  }

  static decode(raw: Uint8Array): IAP2Packet {
    if (raw.length < 9) {
      throw new Error("Bad link marker or truncated header");
    }
    if (raw[0] !== 0xff || raw[1] !== 0x5a) {
      throw new Error("Bad link marker");
    }
    const size = readU16BE(raw, 2);
    if (size !== raw.length || !verifyZeroSum(raw, 0, 9)) {
      throw new Error("Bad link length or header checksum");
    }
    if (raw.length === 10 || (raw.length > 9 && !verifyZeroSum(raw, 9, raw.length))) {
      throw new Error("Bad link payload or checksum");
    }

    const payload = raw.length > 9 ? raw.slice(9, raw.length - 1) : new Uint8Array(0);
    return new IAP2Packet({
      flags: raw[4],
      sequence: raw[5],
      acknowledgement: raw[6],
      session: raw[7],
      payload,
    });
  }
}

export class IAP2Parameter {
  constructor(
    readonly identifier: number,
    readonly data: Uint8Array,
  ) {}

  static encode(identifier: number, data?: Uint8Array | null): Uint8Array {
    const payload = data ?? new Uint8Array(0);
    if (payload.length > 0xffff - 4) {
      throw new Error("iAP2 parameter exceeds maximum length");
    }
    const totalSize = payload.length + 4;
    const header = new Uint8Array([
      (totalSize >>> 8) & 0xff,
      totalSize & 0xff,
      (identifier >>> 8) & 0xff,
      identifier & 0xff,
    ]);
    return payload.length > 0 ? concat(header, payload) : header;
  }

  static encodeText(identifier: number, value: string): Uint8Array {
    if (value.includes("\0")) {
      throw new Error("Embedded NUL in protocol string");
    }
    return IAP2Parameter.encode(identifier, concat(utf8(value), new Uint8Array([0])));
  }

  static parseParameters(raw: Uint8Array): IAP2Parameter[] {
    const result: IAP2Parameter[] = [];
    let offset = 0;
    const total = raw.length;

    while (offset < total) {
      if (total - offset < 4) {
        throw new Error("Truncated iAP2 parameter header");
      }
      const size = readU16BE(raw, offset);
      const identifier = readU16BE(raw, offset + 2);
      if (size < 4 || offset + size > total) {
        throw new Error("Invalid iAP2 parameter length");
      }
      result.push(new IAP2Parameter(identifier, raw.slice(offset + 4, offset + size)));
      offset += size;
    }

    return result;
  }

  asText(): string {
    const end = this.data.indexOf(0);
    return fromUtf8(end >= 0 ? this.data.subarray(0, end) : this.data);
  }
}

export class IAP2Message {
  readonly identifier: number;
  readonly body: Uint8Array;

  constructor(identifier: number, body?: Uint8Array | null) {
    this.identifier = identifier & 0xffff;
    this.body = body ? body.slice() : new Uint8Array(0);
  }

  encode(): Uint8Array {
    if (this.body.length > 0xffff - 6) {
      throw new Error("iAP2 message body exceeds maximum length");
    }
    const totalSize = this.body.length + 6;
    const header = new Uint8Array([
      0x40,
      0x40,
      (totalSize >>> 8) & 0xff,
      totalSize & 0xff,
      (this.identifier >>> 8) & 0xff,
      this.identifier & 0xff,
    ]);
    return this.body.length > 0 ? concat(header, this.body) : header;
  }
}

export class IAP2MessageBuffer {
  private buffer: Uint8Array = new Uint8Array(0);

  feed(data: Uint8Array): IAP2Message[] {
    if (data.length > 0) {
      this.buffer = concat(this.buffer, data);
    }

    const messages: IAP2Message[] = [];
    while (this.buffer.length >= 6) {
      const b = this.buffer;
      const size = readU16BE(b, 2);
      const identifier = readU16BE(b, 4);
      if (b[0] !== 0x40 || b[1] !== 0x40 || size < 6) {
        throw new Error("Invalid iAP2 control message header");
      }
      if (b.length < size) {
        break;
      }
      const body = b.slice(6, size);
      messages.push(new IAP2Message(identifier, body));
      this.buffer = b.subarray(size);
    }
    return messages;
  }
}

export { u16be };
