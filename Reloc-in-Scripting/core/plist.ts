import { decodeBplist, isBplist, PReal, PUid, type PlistValue } from "./bplist";
import { fromUtf8, utf8 } from "./bytes";

export type PlistDict = { [key: string]: PlistValue };

export function isPlistDict(value: unknown): value is PlistDict {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof PUid) &&
    !(value instanceof PReal)
  );
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function encodeValue(value: PlistValue, out: string[]): void {
  if (value === null) throw new Error("plist 不能表示 null");
  if (typeof value === "boolean") out.push(value ? "<true/>" : "<false/>");
  else if (typeof value === "number") {
    if (Number.isInteger(value)) out.push(`<integer>${value}</integer>`);
    else out.push(`<real>${value}</real>`);
  } else if (value instanceof PReal) out.push(`<real>${value.value}</real>`);
  else if (value instanceof PUid) throw new Error("XML plist 不支持 UID");
  else if (typeof value === "string") out.push(`<string>${escapeXml(value)}</string>`);
  else if (value instanceof Uint8Array) out.push(`<data>${base64Of(value)}</data>`);
  else if (Array.isArray(value)) {
    out.push("<array>");
    for (const item of value) encodeValue(item, out);
    out.push("</array>");
  } else {
    out.push("<dict>");
    for (const [key, item] of Object.entries(value)) {
      out.push(`<key>${escapeXml(key)}</key>`);
      encodeValue(item, out);
    }
    out.push("</dict>");
  }
}

export function encodeXmlPlist(root: PlistValue): Uint8Array {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n',
    '<plist version="1.0">',
  ];
  encodeValue(root, out);
  out.push("</plist>\n");
  return utf8(out.join(""));
}

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseInteger(text: string): number | string {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) throw new Error(`plist 整数格式不对：${trimmed.slice(0, 40)}`);
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : trimmed;
}

const LIFTED = /^@(\d+)$/;

function decodeData(text: string, lifted: Uint8Array[]): Uint8Array {
  const mark = LIFTED.exec(text);
  if (mark) {
    const bytes = lifted[Number(mark[1])];
    if (!bytes) throw new Error("plist 的 <data> 占位对不上");
    return bytes;
  }
  return new Uint8Array(Buffer.from(text.replace(/\s+/g, ""), "base64"));
}

const LT = 0x3c;
const OPEN_DATA = utf8("<data>");
const CLOSE_DATA = utf8("</data>");
const PAD = 0x3d;
const SKIP = 254;
const BAD = 255;

const BASE64_TABLE = (() => {
  const table = new Uint8Array(256).fill(BAD);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  for (const space of [0x20, 0x09, 0x0a, 0x0d]) table[space] = SKIP;
  return table;
})();

function bytesAt(bytes: Uint8Array, at: number, pattern: Uint8Array): boolean {
  if (at + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) return false;
  return true;
}

function decodeBase64Bytes(bytes: Uint8Array, start: number, end: number): Uint8Array {
  const out = new Uint8Array(Math.floor(((end - start) * 3) / 4) + 3);
  let length = 0;
  let acc = 0;
  let bits = 0;
  let i = start;
  while (i < end) {
    if (bits === 0 && i + 4 <= end) {
      const a = BASE64_TABLE[bytes[i]];
      const b = BASE64_TABLE[bytes[i + 1]];
      const c = BASE64_TABLE[bytes[i + 2]];
      const d = BASE64_TABLE[bytes[i + 3]];
      if ((a | b | c | d) < 64) {
        out[length++] = (a << 2) | (b >> 4);
        out[length++] = ((b & 15) << 4) | (c >> 2);
        out[length++] = ((c & 3) << 6) | d;
        i += 4;
        continue;
      }
    }
    const code = bytes[i++];
    if (code === PAD) break;
    const value = BASE64_TABLE[code];
    if (value === SKIP) continue;
    if (value === BAD) throw new Error("plist 的 <data> 不是合法的 base64");
    acc = ((acc << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, length);
}

function liftDataBlocks(bytes: Uint8Array): { text: string; lifted: Uint8Array[] } {
  const lifted: Uint8Array[] = [];
  const parts: string[] = [];
  let cursor = 0;
  let at = bytes.indexOf(LT);
  while (at !== -1) {
    if (bytesAt(bytes, at, OPEN_DATA)) {
      const bodyStart = at + OPEN_DATA.length;
      const bodyEnd = bytes.indexOf(LT, bodyStart);
      if (bodyEnd === -1 || !bytesAt(bytes, bodyEnd, CLOSE_DATA)) throw new Error("plist 的 <data> 没有闭合");
      parts.push(fromUtf8(bytes.subarray(cursor, bodyStart)), `@${lifted.length}`);
      lifted.push(decodeBase64Bytes(bytes, bodyStart, bodyEnd));
      cursor = bodyEnd;
      at = bodyEnd;
    }
    at = bytes.indexOf(LT, at + 1);
  }
  parts.push(fromUtf8(bytes.subarray(cursor)));
  return { text: parts.join(""), lifted };
}

interface Token {
  tag: string | null;
  closing: boolean;
  selfClosing: boolean;
  text: string;
}

class XmlTokens {
  private readonly pattern = /<(\/?)([A-Za-z][\w-]*)[^>]*?(\/?)>|([^<]+)|<[?!][^>]*>/g;
  private peeked: Token | null = null;

  constructor(
    private readonly source: string,
    readonly lifted: Uint8Array[],
  ) {}

  next(): Token | null {
    if (this.peeked) {
      const token = this.peeked;
      this.peeked = null;
      return token;
    }
    for (;;) {
      const match = this.pattern.exec(this.source);
      if (!match) return null;
      if (match[2]) return { tag: match[2], closing: match[1] === "/", selfClosing: match[3] === "/", text: "" };
      if (match[4] !== undefined) {
        if (match[4].trim() === "") continue;
        return { tag: null, closing: false, selfClosing: false, text: match[4] };
      }
    }
  }
}

function readText(tokens: XmlTokens, tag: string): string {
  let text = "";
  for (;;) {
    const token = tokens.next();
    if (!token) throw new Error(`plist 在 <${tag}> 里提前结束`);
    if (token.tag === null) text += token.text;
    else if (token.closing && token.tag === tag) return unescapeXml(text);
    else throw new Error(`plist 的 <${tag}> 里不该有 <${token.tag}>`);
  }
}

function parseElement(tokens: XmlTokens, open: Token, depth: number): PlistValue {
  if (depth > 64) throw new Error("plist 嵌套过深");
  const tag = open.tag!;
  switch (tag) {
    case "true":
    case "false":
      if (!open.selfClosing) readText(tokens, tag);
      return tag === "true";
    case "string":
      return open.selfClosing ? "" : readText(tokens, tag);
    case "integer":
      return parseInteger(readText(tokens, tag));
    case "real": {
      const value = Number(readText(tokens, tag).trim());
      if (Number.isNaN(value)) throw new Error("plist 浮点数格式不对");
      return value;
    }
    case "date":
      return readText(tokens, tag).trim();
    case "data":
      return open.selfClosing ? new Uint8Array(0) : decodeData(readText(tokens, tag), tokens.lifted);
    case "array": {
      const items: PlistValue[] = [];
      if (open.selfClosing) return items;
      for (;;) {
        const token = tokens.next();
        if (!token) throw new Error("plist 的 <array> 没有闭合");
        if (token.closing && token.tag === "array") return items;
        if (token.tag === null || token.closing) throw new Error("plist 的 <array> 里有多余内容");
        items.push(parseElement(tokens, token, depth + 1));
      }
    }
    case "dict": {
      const dict: PlistDict = {};
      if (open.selfClosing) return dict;
      for (;;) {
        const token = tokens.next();
        if (!token) throw new Error("plist 的 <dict> 没有闭合");
        if (token.closing && token.tag === "dict") return dict;
        if (token.tag !== "key" || token.closing) throw new Error("plist 的 <dict> 里缺 <key>");
        const key = token.selfClosing ? "" : readText(tokens, "key");
        const valueToken = tokens.next();
        if (!valueToken || valueToken.tag === null || valueToken.closing) {
          throw new Error(`plist 的键 ${key} 没有值`);
        }
        dict[key] = parseElement(tokens, valueToken, depth + 1);
      }
    }
    default:
      throw new Error(`plist 里有不认识的类型 <${tag}>`);
  }
}

export function decodeXmlPlist(text: string, lifted: Uint8Array[] = []): PlistValue {
  const tokens = new XmlTokens(text, lifted);
  let token = tokens.next();
  if (token?.tag === "plist" && !token.closing) token = tokens.next();
  if (!token || token.tag === null || token.closing) throw new Error("plist 没有根元素");
  return parseElement(tokens, token, 0);
}

export function decodePlist(bytes: Uint8Array): PlistValue {
  if (isBplist(bytes)) return decodeBplist(bytes).root;
  const { text, lifted } = liftDataBlocks(bytes);
  return decodeXmlPlist(text, lifted);
}
