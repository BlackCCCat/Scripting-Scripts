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
  supportsChinese: boolean
  variation?: { axes: Record<string, number> }
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

function parseNames(bytes: Uint8Array): Record<number, string> {
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
  const names: Record<number, string> = {}
  const scores: Record<number, number> = {}

  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = nameTableOffset + 6 + index * 12
    if (recordOffset + 12 > nameTableOffset + nameTableLength) break

    const platformID = readUInt16(bytes, recordOffset)
    const languageID = readUInt16(bytes, recordOffset + 4)
    const nameID = readUInt16(bytes, recordOffset + 6)
    const length = readUInt16(bytes, recordOffset + 8)
    const relativeOffset = readUInt16(bytes, recordOffset + 10)
    const valueOffset = stringStorageOffset + relativeOffset
    if (valueOffset < nameTableOffset || valueOffset + length > nameTableOffset + nameTableLength) continue

    const score = nameRecordScore(platformID, languageID)
    if (score <= (scores[nameID] ?? -1)) continue

    const value = platformID === 0 || platformID === 3
      ? decodeUTF16BE(bytes, valueOffset, length)
      : decodeSingleByte(bytes, valueOffset, length)
    if (!value) continue

    names[nameID] = value
    scores[nameID] = score
  }

  return names
}

type FontTable = {
  offset: number
  length: number
}

function readFixed(bytes: Uint8Array, offset: number): number {
  const raw = readUInt32(bytes, offset)
  return (raw >= 0x80000000 ? raw - 0x100000000 : raw) / 65536
}

function parseNamedVariations(bytes: Uint8Array, names: Record<number, string>): Array<{
  styleName: string
  postScriptName?: string
  axes: Record<string, number>
}> {
  const table = findTable(bytes, "fvar")
  if (!table || table.length < 16) return []
  const end = table.offset + table.length
  const axesOffset = readUInt16(bytes, table.offset + 4)
  const axisCount = readUInt16(bytes, table.offset + 8)
  const axisSize = readUInt16(bytes, table.offset + 10)
  const instanceCount = readUInt16(bytes, table.offset + 12)
  const instanceSize = readUInt16(bytes, table.offset + 14)
  if (!axisCount || axisSize < 20 || instanceSize < 4 + axisCount * 4) return []
  const axesStart = table.offset + axesOffset
  const instancesStart = axesStart + axisCount * axisSize
  if (axesStart < table.offset + 16 || instancesStart + instanceCount * instanceSize > end) return []
  const axisTags: string[] = []
  for (let axis = 0; axis < axisCount; axis += 1) {
    const offset = axesStart + axis * axisSize
    const tag = readTag(bytes, offset)
    if (!/^[\x20-\x7e]{4}$/.test(tag)) return []
    axisTags.push(tag)
  }
  const variations = []
  for (let instance = 0; instance < instanceCount; instance += 1) {
    const offset = instancesStart + instance * instanceSize
    const styleName = names[readUInt16(bytes, offset)]
    if (!styleName) continue
    const axes: Record<string, number> = {}
    for (let axis = 0; axis < axisCount; axis += 1) {
      axes[axisTags[axis]] = readFixed(bytes, offset + 4 + axis * 4)
    }
    const postScriptNameID = instanceSize >= 6 + axisCount * 4
      ? readUInt16(bytes, offset + 4 + axisCount * 4)
      : 0xffff
    variations.push({ styleName, postScriptName: names[postScriptNameID], axes })
  }
  return variations
}

function findTable(bytes: Uint8Array, tag: string): FontTable | null {
  const tableCount = readUInt16(bytes, 4)
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16
    if (recordOffset + 16 > bytes.length) return null
    if (readTag(bytes, recordOffset) !== tag) continue

    const offset = readUInt32(bytes, recordOffset + 8)
    const length = readUInt32(bytes, recordOffset + 12)
    if (offset < 0 || length <= 0 || offset + length > bytes.length) return null
    return { offset, length }
  }
  return null
}

function format4HasGlyph(bytes: Uint8Array, offset: number, tableEnd: number, codePoint: number): boolean {
  if (codePoint > 0xffff || offset + 16 > tableEnd) return false
  const length = readUInt16(bytes, offset + 2)
  const subtableEnd = Math.min(offset + length, tableEnd)
  const segCount = readUInt16(bytes, offset + 6) / 2
  if (!Number.isInteger(segCount) || segCount <= 0) return false

  const endCodesOffset = offset + 14
  const startCodesOffset = endCodesOffset + segCount * 2 + 2
  const deltasOffset = startCodesOffset + segCount * 2
  const rangeOffsetsOffset = deltasOffset + segCount * 2
  if (rangeOffsetsOffset + segCount * 2 > subtableEnd) return false

  for (let index = 0; index < segCount; index += 1) {
    const endCode = readUInt16(bytes, endCodesOffset + index * 2)
    if (codePoint > endCode) continue

    const startCode = readUInt16(bytes, startCodesOffset + index * 2)
    if (codePoint < startCode) return false

    const delta = readUInt16(bytes, deltasOffset + index * 2)
    const rangeOffsetLocation = rangeOffsetsOffset + index * 2
    const rangeOffset = readUInt16(bytes, rangeOffsetLocation)
    if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0

    const glyphOffset = rangeOffsetLocation + rangeOffset + (codePoint - startCode) * 2
    if (glyphOffset + 2 > subtableEnd) return false
    const glyph = readUInt16(bytes, glyphOffset)
    return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0
  }
  return false
}

function format6HasGlyph(bytes: Uint8Array, offset: number, tableEnd: number, codePoint: number): boolean {
  if (codePoint > 0xffff || offset + 10 > tableEnd) return false
  const length = readUInt16(bytes, offset + 2)
  const subtableEnd = Math.min(offset + length, tableEnd)
  const firstCode = readUInt16(bytes, offset + 6)
  const entryCount = readUInt16(bytes, offset + 8)
  if (codePoint < firstCode || codePoint >= firstCode + entryCount) return false
  const glyphOffset = offset + 10 + (codePoint - firstCode) * 2
  return glyphOffset + 2 <= subtableEnd && readUInt16(bytes, glyphOffset) !== 0
}

function format12HasGlyph(bytes: Uint8Array, offset: number, tableEnd: number, codePoint: number): boolean {
  if (offset + 16 > tableEnd) return false
  const length = readUInt32(bytes, offset + 4)
  const subtableEnd = Math.min(offset + length, tableEnd)
  const groupCount = readUInt32(bytes, offset + 12)
  if (offset + 16 + groupCount * 12 > subtableEnd) return false

  let low = 0
  let high = groupCount - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const groupOffset = offset + 16 + middle * 12
    const startCode = readUInt32(bytes, groupOffset)
    const endCode = readUInt32(bytes, groupOffset + 4)
    if (codePoint < startCode) {
      high = middle - 1
    } else if (codePoint > endCode) {
      low = middle + 1
    } else {
      const startGlyph = readUInt32(bytes, groupOffset + 8)
      return startGlyph + codePoint - startCode !== 0
    }
  }
  return false
}

function cmapSubtableHasGlyph(
  bytes: Uint8Array,
  offset: number,
  tableEnd: number,
  codePoint: number,
): boolean {
  if (offset + 2 > tableEnd) return false
  const format = readUInt16(bytes, offset)
  if (format === 4) return format4HasGlyph(bytes, offset, tableEnd, codePoint)
  if (format === 6) return format6HasGlyph(bytes, offset, tableEnd, codePoint)
  if (format === 12) return format12HasGlyph(bytes, offset, tableEnd, codePoint)
  return false
}

function fontSupportsCodePoint(bytes: Uint8Array, codePoint: number): boolean {
  const cmap = findTable(bytes, "cmap")
  if (!cmap || cmap.offset + 4 > bytes.length) return false
  const tableEnd = cmap.offset + cmap.length
  const recordCount = readUInt16(bytes, cmap.offset + 2)
  if (cmap.offset + 4 + recordCount * 8 > tableEnd) return false

  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = cmap.offset + 4 + index * 8
    const platformID = readUInt16(bytes, recordOffset)
    const encodingID = readUInt16(bytes, recordOffset + 2)
    const isUnicode = platformID === 0 || (platformID === 3 && (encodingID === 1 || encodingID === 10))
    if (!isUnicode) continue

    const subtableOffset = cmap.offset + readUInt32(bytes, recordOffset + 4)
    if (subtableOffset < cmap.offset || subtableOffset >= tableEnd) continue
    if (cmapSubtableHasGlyph(bytes, subtableOffset, tableEnd, codePoint)) return true
  }
  return false
}

function supportsChinesePreview(bytes: Uint8Array): boolean {
  const sample = "字体预览天地玄黄，宇宙洪荒。春风又绿江南岸"
  try {
    return Array.from(new Set(Array.from(sample))).every(character => {
      const codePoint = character.codePointAt(0)
      return codePoint != null && fontSupportsCodePoint(bytes, codePoint)
    })
  } catch {
    return false
  }
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
    supportsChinese: supportsChinesePreview(bytes),
  }
}

export async function inspectFontFileVariants(path: string): Promise<InspectedFont[]> {
  if (!path || !FileManager.existsSync(path) || !FileManager.isFileSync(path)) {
    throw new Error("找不到输入的字体文件。")
  }
  const data = await FileManager.readAsData(path)
  return inspectFontVariants(path, data)
}

export function inspectFontVariants(path: string, data: Data): InspectedFont[] {
  const base = inspectFontData(path, data)
  const bytes = data.toUint8Array()
  if (!bytes) throw new Error("无法读取字体内容。")
  const variations = parseNamedVariations(bytes, parseNames(bytes))
  if (!variations.length) return [{ info: base, data }]
  return variations.map(variation => {
    const fullName = `${base.familyName} ${variation.styleName}`.trim()
    return {
      data,
      info: {
        ...base,
        styleName: variation.styleName,
        fullName,
        postScriptName: variation.postScriptName
          || sanitizePostScriptName(`${base.familyName.replace(/\s+/g, "")}-${variation.styleName.replace(/\s+/g, "")}`),
        variation: { axes: variation.axes },
      },
    }
  })
}

