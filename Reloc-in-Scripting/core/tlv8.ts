import { concat } from "./bytes";

export const TLV8Type = {
  Method: 0x00,
  Identifier: 0x01,
  Salt: 0x02,
  PublicKey: 0x03,
  Proof: 0x04,
  EncryptedData: 0x05,
  State: 0x06,
  ErrorResponse: 0x07,
  RetryDelay: 0x08,
  Certificate: 0x09,
  Signature: 0x0a,
  Permissions: 0x0b,
  FragmentData: 0x0c,
  FragmentLast: 0x0d,
  SessionId: 0x0e,
  Ttl: 0x0f,
  ExtraData: 0x10,
  Info: 0x11,
  Acl: 0x12,
  Flags: 0x13,
  ValidationData: 0x14,
  Signature2: 0x15,
  Name: 0x16,
} as const;

export interface TLV8Entry {
  type: number;
  data: Uint8Array;
}

export function encodeTLV8(entries: TLV8Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    let offset = 0;
    do {
      const size = Math.min(255, entry.data.length - offset);
      const chunk = new Uint8Array(2 + size);
      chunk[0] = entry.type;
      chunk[1] = size;
      chunk.set(entry.data.subarray(offset, offset + size), 2);
      parts.push(chunk);
      offset += size;
    } while (offset < entry.data.length);
  }
  return concat(...parts);
}

export function decodeTLV8(bytes: Uint8Array): Map<number, Uint8Array> {
  const chunks = new Map<number, Uint8Array[]>();
  let offset = 0;
  while (offset + 2 <= bytes.length) {
    const type = bytes[offset];
    const size = bytes[offset + 1];
    const end = offset + 2 + size;
    if (end > bytes.length) throw new Error("TLV8 数据截断");
    const list = chunks.get(type) ?? [];
    list.push(bytes.subarray(offset + 2, end));
    chunks.set(type, list);
    offset = end;
  }
  if (offset !== bytes.length) throw new Error("TLV8 尾部截断");

  const result = new Map<number, Uint8Array>();
  for (const [type, list] of chunks) result.set(type, concat(...list));
  return result;
}

export function hasError(tlv: Map<number, Uint8Array>): boolean {
  const error = tlv.get(TLV8Type.ErrorResponse);
  return !!error && error.length > 0;
}

export function errorCode(tlv: Map<number, Uint8Array>): number | null {
  const error = tlv.get(TLV8Type.ErrorResponse);
  return error && error.length > 0 ? error[0] : null;
}
