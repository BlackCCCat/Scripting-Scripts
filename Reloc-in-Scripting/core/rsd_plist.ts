import type { PlistValue } from "./bplist";
import { concat, readU32BE, u32be } from "./bytes";
import { decodePlist, encodeXmlPlist, isPlistDict, type PlistDict } from "./plist";
import { BufferedReader, writeAll, type ByteStream } from "./stream";

const MAX_PLIST_FRAME = 4 * 1024 * 1024;

export async function sendFramedPlist(stream: ByteStream, value: PlistValue): Promise<void> {
  const xml = encodeXmlPlist(value);
  await writeAll(stream, concat(u32be(xml.length), xml));
}

export async function recvFramedPlistDict(
  reader: BufferedReader,
  timeoutMs = 10_000,
): Promise<PlistDict> {
  const lenBuf = await reader.readExact(4, timeoutMs);
  const len = readU32BE(lenBuf, 0);
  if (len === 0 || len > MAX_PLIST_FRAME) {
    throw new Error(`RSDCheckin 响应长度异常：${len}`);
  }
  const body = await reader.readExact(len, timeoutMs);
  const parsed = decodePlist(body);
  if (!isPlistDict(parsed)) {
    throw new Error("RSD plist 响应不是字典");
  }
  return parsed;
}

/**
 * 在原始 ByteStream 上完成 RSDCheckin（用于 .shim.remote 服务，不经过 DeviceServices.adopt，
 * 以便同一条流随后直接切入 iAP2 二进制帧协议）。
 */
export async function performRsdCheckinOnStream(
  stream: ByteStream,
  label = "Reloc",
  timeoutMs = 10_000,
): Promise<void> {
  const reader = new BufferedReader(stream);
  if (reader.buffered > 0) {
    throw new Error("Unexpected buffered bytes before RSDCheckin");
  }
  await sendFramedPlist(stream, {
    Label: label,
    ProtocolVersion: "2",
    Request: "RSDCheckin",
  });
  const first = await recvFramedPlistDict(reader, timeoutMs);
  if (first.Request !== "RSDCheckin") {
    throw new Error(`RSDCheckin 握手回复异常：${String(first.Request)}`);
  }
  const second = await recvFramedPlistDict(reader, timeoutMs);
  if (second.Request !== "StartService") {
    throw new Error(`RSD StartService 握手回复异常：${String(second.Request)}`);
  }
}
