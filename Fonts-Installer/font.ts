import { Path } from "scripting"

export type FontFormat = "TrueType" | "OpenType"

export type FontInfo = {
  path: string
  fileName: string
  fileSize: number
  format: FontFormat
  familyName: string
  styleName: string
  fullName: string
  postScriptName: string
}

export type InspectedFont = {
  info: FontInfo
  data: Data
}

const ACCEPTED_EXTENSIONS = new Set([".ttf", ".otf"])

function readUInt16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error("字体文件结构不完整。")
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error("字体文件结构不完整。")
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function readTag(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return ""
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function decodeUTF16BE(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(offset + length, bytes.length)
  let value = ""
  for (let index = offset; index + 1 < end; index += 2) {
    value += String.fromCharCode(bytes[index] * 0x100 + bytes[index + 1])
  }
  return value.replace(/\u0000/g, "").trim()
}

function decodeSingleByte(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(offset + length, bytes.length)
  let value = ""
  for (let index = offset; index < end; index += 1) {
    const byte = bytes[index]
    value += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ""
  }
  return value.trim()
}

function nameRecordScore(platformID: number, languageID: number): number {
  if (platformID === 3 && languageID === 0x0409) return 40
  if (platformID === 3) return 30
  if (platformID === 0) return 20
  if (platformID === 1) return 10
  return 0
}

function parseNames(bytes: Uint8Array): Partial<Record<1 | 2 | 4 | 6, string>> {
  const tableCount = readUInt16(bytes, 4)
  let nameTableOffset = -1
  let nameTableLength = 0

  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16
    if (recordOffset + 16 > bytes.length) throw new Error("字体表目录不完整。")
    if (readTag(bytes, recordOffset) !== "name") continue
    nameTableOffset = readUInt32(bytes, recordOffset + 8)
    nameTableLength = readUInt32(bytes, recordOffset + 12)
    break
  }

  if (
    nameTableOffset < 0 ||
    nameTableLength < 6 ||
    nameTableOffset + nameTableLength > bytes.length
  ) {
    return {}
  }

  const recordCount = readUInt16(bytes, nameTableOffset + 2)
  const stringStorageOffset = nameTableOffset + readUInt16(bytes, nameTableOffset + 4)
  const wantedIDs = new Set([1, 2, 4, 6])
  const names: Partial<Record<1 | 2 | 4 | 6, string>> = {}
  const scores: Partial<Record<1 | 2 | 4 | 6, number>> = {}

  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = nameTableOffset + 6 + index * 12
    if (recordOffset + 12 > nameTableOffset + nameTableLength) break

    const platformID = readUInt16(bytes, recordOffset)
    const languageID = readUInt16(bytes, recordOffset + 4)
    const nameID = readUInt16(bytes, recordOffset + 6)
    if (!wantedIDs.has(nameID)) continue

    const length = readUInt16(bytes, recordOffset + 8)
    const relativeOffset = readUInt16(bytes, recordOffset + 10)
    const valueOffset = stringStorageOffset + relativeOffset
    if (valueOffset < nameTableOffset || valueOffset + length > nameTableOffset + nameTableLength) continue

    const score = nameRecordScore(platformID, languageID)
    if (score <= (scores[nameID as 1 | 2 | 4 | 6] ?? -1)) continue

    const value = platformID === 0 || platformID === 3
      ? decodeUTF16BE(bytes, valueOffset, length)
      : decodeSingleByte(bytes, valueOffset, length)
    if (!value) continue

    const typedNameID = nameID as 1 | 2 | 4 | 6
    names[typedNameID] = value
    scores[typedNameID] = score
  }

  return names
}

function fileStem(fileName: string): string {
  const extension = Path.extname(fileName)
  return extension ? fileName.slice(0, -extension.length) : fileName
}

function sanitizePostScriptName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return sanitized || "ImportedFont"
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function inspectFontData(path: string, data: Data): FontInfo {
  const fileName = Path.basename(path)
  const extension = Path.extname(fileName).toLowerCase()
  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    throw new Error("只支持单个 TrueType (.ttf) 或 OpenType (.otf) 字体文件。")
  }

  const bytes = data.toUint8Array()
  if (!bytes || bytes.length < 12) throw new Error("字体文件为空或结构不完整。")

  const signature = readTag(bytes, 0)
  if (signature === "ttcf") {
    throw new Error("iOS 字体描述文件不支持 .ttc 或 .otc 字体集合。")
  }

  const isTrueType =
    (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
    signature === "true"
  const isOpenType = signature === "OTTO"
  if (!isTrueType && !isOpenType) {
    throw new Error("文件头不是有效的 TrueType 或 OpenType 字体。")
  }
  if (extension === ".otf" && !isOpenType) {
    throw new Error("文件扩展名是 .otf，但文件内容不是 OpenType/CFF 字体。")
  }
  if (extension === ".ttf" && !isTrueType) {
    throw new Error("文件扩展名是 .ttf，但文件内容不是 TrueType 字体。")
  }

  const names = parseNames(bytes)
  const fallback = fileStem(fileName)
  const familyName = names[1] || fallback
  const styleName = names[2] || "Regular"
  const fullName = names[4] || `${familyName} ${styleName}`.trim()
  const postScriptName = names[6] || sanitizePostScriptName(fullName)

  return {
    path,
    fileName,
    fileSize: data.size,
    format: isOpenType ? "OpenType" : "TrueType",
    familyName,
    styleName,
    fullName,
    postScriptName,
  }
}

export async function inspectFontFile(path: string): Promise<InspectedFont> {
  if (!path || !FileManager.existsSync(path) || !FileManager.isFileSync(path)) {
    throw new Error("找不到输入的字体文件。")
  }
  const data = await FileManager.readAsData(path)
  return { info: inspectFontData(path, data), data }
}
