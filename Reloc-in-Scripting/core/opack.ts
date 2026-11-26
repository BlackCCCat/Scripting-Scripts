import { concat, fromUtf8, utf8 } from "./bytes";

export type OpackValue = boolean | number | string | Uint8Array | OpackValue[] | { [key: string]: OpackValue };
const LIMIT = 65535;

export function encode(value: OpackValue): Uint8Array {
  let nodes = 0;
  let size = 0;
  const parts: Uint8Array[] = [];
  function add(bytes: Uint8Array) {
    size += bytes.length;
    if (size > LIMIT) throw new Error("OPACK too large");
    parts.push(bytes);
  }
  function byte(...bytes: number[]) {
    add(new Uint8Array(bytes));
  }
  function data(bytes: Uint8Array, base: number, extended: number) {
    if (bytes.length <= 32) byte(base + bytes.length);
    else if (bytes.length <= 255) byte(extended, bytes.length);
    else if (bytes.length <= LIMIT) byte(extended + 1, bytes.length & 255, bytes.length >>> 8);
    else throw new Error("OPACK item too large");
    add(bytes);
  }
  function write(item: OpackValue, depth: number) {
    if (++nodes > 512 || depth > 16) throw new Error("OPACK structure too large");
    if (typeof item === "boolean") byte(item ? 1 : 2);
    else if (typeof item === "string") data(utf8(item), 0x40, 0x61);
    else if (item instanceof Uint8Array) data(item, 0x70, 0x91);
    else if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || item < 0) throw new Error("Unsupported OPACK integer");
      if (item < 40) byte(item + 8);
      else if (item <= 255) byte(0x30, item);
      else {
        const count = item <= 0xffffffff ? 4 : 8;
        byte(count === 4 ? 0x32 : 0x33);
        const bytes = new Uint8Array(count);
        for (let i = 0, n = item; i < count; i++, n = Math.floor(n / 256)) bytes[i] = n % 256;
        add(bytes);
      }
    } else if (Array.isArray(item)) {
      byte(item.length < 15 ? 0xd0 + item.length : 0xdf);
      for (const child of item) write(child, depth + 1);
      if (item.length >= 15) byte(3);
    } else if (item && typeof item === "object") {
      const keys = Object.keys(item);
      byte(keys.length < 15 ? 0xe0 + keys.length : 0xef);
      for (const key of keys) {
        write(key, depth + 1);
        write(item[key], depth + 1);
      }
      if (keys.length >= 15) byte(3);
    } else {
      throw new Error("Unsupported OPACK value");
    }
  }
  write(value, 0);
  return concat(...parts);
}

export function decode(bytes: Uint8Array): OpackValue {
  if (bytes.length > LIMIT) throw new Error("OPACK too large");
  let offset = 0;
  let nodes = 0;
  function take(count: number) {
    if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - offset) throw new Error("Truncated OPACK");
    const value = bytes.slice(offset, offset + count);
    offset += count;
    return value;
  }
  function integer(count: number) {
    const data = take(count);
    let n = 0;
    for (let i = count - 1; i >= 0; i--) n = n * 256 + data[i];
    if (!Number.isSafeInteger(n)) throw new Error("OPACK integer exceeds precision");
    return n;
  }
  function read(depth: number): OpackValue {
    if (++nodes > 512 || depth > 16) throw new Error("OPACK structure too large");
    const tag = integer(1);
    if (tag === 1 || tag === 2) return tag === 1;
    if (tag >= 8 && tag <= 0x2f) return tag - 8;
    if (tag === 0x30 || tag === 0x32 || tag === 0x33) return integer(tag === 0x30 ? 1 : tag === 0x32 ? 4 : 8);
    if (tag >= 0x40 && tag <= 0x64) {
      const count = tag <= 0x60 ? tag - 0x40 : integer(2 ** (tag - 0x61));
      return fromUtf8(take(count));
    }
    if (tag >= 0x70 && tag <= 0x94) {
      const count = tag <= 0x90 ? tag - 0x70 : integer(2 ** (tag - 0x91));
      return take(count);
    }
    if (tag >= 0xd0 && tag <= 0xef) {
      const dictionary = tag >= 0xe0;
      const indefinite = (tag & 15) === 15;
      const count = indefinite ? 512 : tag & 15;
      const array: OpackValue[] = [];
      const object: { [key: string]: OpackValue } = Object.create(null);
      for (let i = 0; i < count; i++) {
        if (indefinite && bytes[offset] === 3) {
          offset++;
          return dictionary ? object : array;
        }
        const key = read(depth + 1);
        if (dictionary) {
          if (typeof key !== "string" || Object.prototype.hasOwnProperty.call(object, key)) {
            throw new Error("Invalid OPACK dictionary key");
          }
          object[key] = read(depth + 1);
        } else {
          array.push(key);
        }
      }
      if (indefinite) throw new Error("Unterminated OPACK container");
      return dictionary ? object : array;
    }
    throw new Error(`Unsupported OPACK tag ${tag}`);
  }
  const result = read(0);
  if (offset !== bytes.length) throw new Error("Trailing OPACK bytes");
  return result;
}
