import { KEYCHAIN_KEYS } from "../constants";
import type { PairingStatus } from "../types";
import { decodeBplist, encodeBplist, isBplist, type PlistValue } from "./bplist";
import { bytesEqual, fromBase64, fromHex, toHex } from "./bytes";
import { deriveEd25519PublicKey } from "./crypto_utils";

export interface PairingRecord {
  identifier: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  altIrk: Uint8Array;
  hostAltIrk?: Uint8Array;
  deviceName: string;
  deviceUDID: string;
}

interface StoredRecord {
  identifier: string;
  privateKey: string;
  publicKey: string;
  altIrk: string;
  hostAltIrk?: string;
  deviceName: string;
  deviceUDID: string;
}

export function loadPairing(): PairingRecord | null {
  try {
    const raw = Keychain.get(KEYCHAIN_KEYS.pairingRecord);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredRecord;
    if (!stored.identifier || !stored.privateKey) return null;
    return {
      identifier: stored.identifier,
      privateKey: fromHex(stored.privateKey),
      publicKey: fromHex(stored.publicKey ?? ""),
      altIrk: fromHex(stored.altIrk ?? ""),
      hostAltIrk: stored.hostAltIrk ? fromHex(stored.hostAltIrk) : undefined,
      deviceName: stored.deviceName ?? "",
      deviceUDID: stored.deviceUDID ?? "",
    };
  } catch {
    return null;
  }
}

export function getPairingStatus(): PairingStatus {
  const record = loadPairing();
  if (!record) {
    return {
      isLoaded: false,
      kind: null,
      summaryID: null,
      deviceName: "",
      deviceUDID: "",
      errorMessage: null,
    };
  }
  return {
    isLoaded: true,
    kind: "Remote Pairing",
    summaryID: record.identifier,
    deviceName: record.deviceName,
    deviceUDID: record.deviceUDID,
    errorMessage: null,
  };
}

export function savePairing(record: PairingRecord): void {
  const stored: StoredRecord = {
    identifier: record.identifier,
    privateKey: toHex(record.privateKey),
    publicKey: toHex(record.publicKey),
    altIrk: toHex(record.altIrk),
    hostAltIrk: record.hostAltIrk ? toHex(record.hostAltIrk) : undefined,
    deviceName: record.deviceName,
    deviceUDID: record.deviceUDID,
  };
  if (!Keychain.set(KEYCHAIN_KEYS.pairingRecord, JSON.stringify(stored))) {
    throw new Error("无法保存配对记录，请检查钥匙串访问后重试");
  }
}

export function deletePairing(): void {
  Keychain.remove(KEYCHAIN_KEYS.pairingRecord);
}

function seed32(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 32) return bytes;
  if (bytes.length === 64) return bytes.subarray(0, 32);
  if (bytes.length > 32) return bytes.subarray(bytes.length - 32);
  throw new Error(`私钥只有 ${bytes.length} 字节，无法取出 32 字节种子`);
}

function asBytes(value: PlistValue | undefined): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) return fromHex(text);
  try {
    return fromBase64(text);
  } catch {
    return null;
  }
}

function asString(value: PlistValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseXmlPlistDict(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /<key>([\s\S]*?)<\/key>\s*<(string|data|integer|real)>([\s\S]*?)<\/\2>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const raw = match[3].trim();
    result[xmlUnescape(match[1].trim())] = match[2] === "data" ? raw : xmlUnescape(raw);
  }
  return result;
}

function pick(dict: Record<string, PlistValue>, keys: string[]): PlistValue | undefined {
  for (const key of keys) {
    if (dict[key] !== undefined) return dict[key];
  }
  return undefined;
}

const IDENTIFIER_KEYS = ["identifier", "HostID", "hostId", "host_id"];
const PRIVATE_KEYS = ["private_key", "hostPrivateSeed", "HostPrivateKey", "privateKey"];
const PUBLIC_KEYS = ["public_key", "hostPublicKey", "HostPublicKey", "publicKey"];
const ALT_IRK_KEYS = ["alt_irk", "altIrk", "AltIRK"];
const HOST_IRK_KEYS = ["reloc_host_irk", "host_alt_irk", "hostAltIrk"];
const NAME_KEYS = ["deviceName", "DeviceName", "device_name", "name"];
const UDID_KEYS = ["deviceUDID", "DeviceUDID", "device_udid", "UDID", "udid"];

async function validateRecordFromDict(dict: Record<string, PlistValue>): Promise<PairingRecord> {
  // 检测经典 Lockdown（HostCertificate + HostPrivateKey PEM）提示兼容性
  if (dict.HostCertificate !== undefined && dict.HostID !== undefined && dict.private_key === undefined) {
    throw new Error(
      "检测到经典 Lockdown 配对文件（含 HostCertificate）。Scripting 的本机 RSD 隧道仅支持 Remote Pairing 记录（含 identifier / private_key），请使用本机一键配对或导入 .rppairing / WLOC / Reloc 导出的配对文件。",
    );
  }

  const identifier = asString(pick(dict, IDENTIFIER_KEYS));
  if (!identifier) {
    throw new Error(`缺少 identifier 字段。文件里的字段：${Object.keys(dict).join("、") || "（空）"}`);
  }

  const rawPriv = asBytes(pick(dict, PRIVATE_KEYS));
  if (!rawPriv) {
    throw new Error("缺少 private_key 字段，这不是有效的配对文件");
  }
  const privateKey = seed32(rawPriv);
  const publicKey = asBytes(pick(dict, PUBLIC_KEYS)) ?? new Uint8Array(0);

  if (publicKey.length === 32) {
    const derived = await deriveEd25519PublicKey(privateKey);
    if (derived && !bytesEqual(derived, publicKey)) {
      throw new Error("Remote Pairing 配对文件中的 Ed25519 公私钥不匹配");
    }
  }

  const altIrk = asBytes(pick(dict, ALT_IRK_KEYS)) ?? new Uint8Array(0);
  const hostAltIrk = asBytes(pick(dict, HOST_IRK_KEYS)) ?? undefined;

  return {
    identifier,
    privateKey,
    publicKey,
    altIrk,
    hostAltIrk,
    deviceName: asString(pick(dict, NAME_KEYS)),
    deviceUDID: asString(pick(dict, UDID_KEYS)),
  };
}

export async function parsePairingFile(bytes: Uint8Array): Promise<PairingRecord> {
  if (bytes.length === 0 || bytes.length > 2_000_000) {
    throw new Error("配对文件为空或体积异常");
  }

  if (isBplist(bytes)) {
    const { root } = decodeBplist(bytes);
    if (typeof root !== "object" || root === null || Array.isArray(root)) {
      throw new Error("二进制 plist 的顶层不是字典");
    }
    return validateRecordFromDict(root as Record<string, PlistValue>);
  }

  const text = new TextDecoder().decode(bytes).trim();
  if (!text) throw new Error("文件内容为空");

  if (text.startsWith("{")) {
    const json = JSON.parse(text) as Record<string, PlistValue>;
    return validateRecordFromDict(json);
  }

  if (text.includes("<plist") || text.includes("<dict>")) {
    const dict = parseXmlPlistDict(text);
    if (Object.keys(dict).length === 0) throw new Error("XML plist 里没有解析到任何字段");
    return validateRecordFromDict(dict as Record<string, PlistValue>);
  }

  throw new Error(`无法识别的配对文件格式，开头：${text.slice(0, 60).replace(/\s+/g, " ")}`);
}

export type PairingExportFormat = "xml" | "binary" | "json";

export const PAIRING_EXPORT_FORMATS: {
  id: PairingExportFormat;
  label: string;
  detail: string;
  extension: string;
  text: boolean;
}[] = [
  {
    id: "xml",
    label: "XML plist (.mobiledevicepairing)",
    detail: "纯文本 XML plist，原版 Reloc 与 WLOC 均可直接导入。",
    extension: "mobiledevicepairing",
    text: true,
  },
  {
    id: "binary",
    label: "二进制 plist (.rppairing)",
    detail: "体积更小，兼容 Apple Remote Pairing 二进制格式。",
    extension: "rppairing",
    text: false,
  },
  {
    id: "json",
    label: "JSON",
    detail: "十六进制字段，便于排查与查看。",
    extension: "json",
    text: true,
  },
];

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function exportPairingAsXml(record: PairingRecord): string {
  const entries: string[] = [
    `  <key>identifier</key>\n  <string>${xmlEscape(record.identifier)}</string>`,
    `  <key>private_key</key>\n  <data>${base64Of(record.privateKey)}</data>`,
  ];
  if (record.publicKey.length > 0) {
    entries.push(`  <key>public_key</key>\n  <data>${base64Of(record.publicKey)}</data>`);
  }
  if (record.altIrk.length > 0) {
    entries.push(`  <key>alt_irk</key>\n  <data>${base64Of(record.altIrk)}</data>`);
  }
  if (record.hostAltIrk && record.hostAltIrk.length > 0) {
    entries.push(`  <key>reloc_host_irk</key>\n  <data>${base64Of(record.hostAltIrk)}</data>`);
  }
  if (record.deviceName) {
    entries.push(`  <key>device_name</key>\n  <string>${xmlEscape(record.deviceName)}</string>`);
  }
  if (record.deviceUDID) {
    entries.push(`  <key>device_udid</key>\n  <string>${xmlEscape(record.deviceUDID)}</string>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    entries.join("\n"),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export function exportPairingAsBinary(record: PairingRecord): Uint8Array {
  const dict: Record<string, PlistValue> = {
    identifier: record.identifier,
    private_key: record.privateKey,
  };
  if (record.publicKey.length > 0) dict.public_key = record.publicKey;
  if (record.altIrk.length > 0) dict.alt_irk = record.altIrk;
  if (record.hostAltIrk && record.hostAltIrk.length > 0) dict.reloc_host_irk = record.hostAltIrk;
  if (record.deviceName) dict.device_name = record.deviceName;
  if (record.deviceUDID) dict.device_udid = record.deviceUDID;
  return encodeBplist(dict);
}

export function exportPairingAsJson(record: PairingRecord): string {
  return JSON.stringify(
    {
      identifier: record.identifier,
      privateKey: toHex(record.privateKey),
      publicKey: toHex(record.publicKey),
      altIrk: toHex(record.altIrk),
      deviceName: record.deviceName,
      deviceUDID: record.deviceUDID,
    },
    null,
    2,
  );
}
