import type { PickupInfo } from "./types"

const BRACKET_RE = /【([^】\d]{2,10})】/
const LOCATION_RE = /(?:到达|至|放|在|取件地[:：]|地址[:：])\s*([^，,。!！\n\r\]】]{2,30}?(?:店|驿站|超市|服务部|前台|门卫|代收点|便利店|服务站|仓|柜|厅|室|中心|报亭|花园|小区|楼|园|广场))/i
const GENERIC_RE = /(菜鸟|蜂巢|丰巢|兔喜|兔喜生活|极兔|顺丰|京东|韵达|中通|圆通|申通|邮政|EMS|妈妈驿站|驿站|日日顺|德邦)/i
const CODE_RE = /(?:取件码|取货码|验证码|提货码|取件|取货|凭)[^\d]{0,8}((\s*(?:\d+-){0,2}\d{3,8}[\s,，\.]*)+)/gi
const EXTRA_INFO_PATTERNS = [
  /([A-Za-z0-9一二三四五六七八九十百]+号柜)/i,
  /([A-Za-z0-9]+柜)/i,
  /(货架[A-Za-z0-9一二三四五六七八九十百-]+)/i,
  /([A-Za-z0-9一二三四五六七八九十百]+号货架)/i,
  /([A-Za-z0-9一二三四五六七八九十百]+号架)/i,
  /([A-Za-z0-9一二三四五六七八九十百]+层)/i,
]

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeSnippetCandidate(text: string, locationName: string | null, code: string, courierName?: string | null) {
  let normalized = String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[a-z]\.[^\s]+/gi, " ")
    .replace(/【[^】]+】/g, " ")

  if (locationName) {
    normalized = normalized.replace(new RegExp(escapeRegExp(locationName), "g"), " ")
  }

  if (courierName && courierName !== locationName) {
    normalized = normalized.replace(new RegExp(escapeRegExp(courierName), "g"), " ")
  }

  normalized = normalized
    .replace(new RegExp(escapeRegExp(code), "g"), " ")
    .replace(/(?:凭|取件码|取货码|验证码|提货码|快递柜|快递员及?|快递员|至|到|前往|领取|取件|取货|提货|即可|规则|存放|放入|点击|详情)/g, " ")
    .replace(/(?:畅存规则|查看详情|详情请见|更多信息).*$/g, " ")
    .replace(/[，,。!！?？:：;；（）()\[\]【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return normalized
}

export function buildPickupSnippetText(
  sourceText: string,
  locationName: string | null,
  code: string,
  courierName?: string | null,
) {
  const normalized = normalizeSnippetCandidate(sourceText, locationName, code, courierName)

  for (const pattern of EXTRA_INFO_PATTERNS) {
    const match = normalized.match(pattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  if (normalized) {
    return normalized.slice(0, 24)
  }

  return "查看包裹详情"
}

function parseMessageDate(text: string): string | null {
  const patterns = [
    /(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(今天\s*\d{1,2}:\d{2})/,
    /(昨天\s*\d{1,2}:\d{2})/,
  ]

  for (const re of patterns) {
    const m = text.match(re)
    if (!m || !m[1]) continue
    const raw = m[1].trim()
    const now = new Date()

    if (raw.startsWith("今天")) {
      const hm = raw.replace("今天", "").trim()
      const [h, min] = hm.split(":").map(Number)
      const d = new Date(now)
      d.setHours(h || 0, min || 0, 0, 0)
      return d.toISOString()
    }

    if (raw.startsWith("昨天")) {
      const hm = raw.replace("昨天", "").trim()
      const [h, min] = hm.split(":").map(Number)
      const d = new Date(now.getTime() - 24 * 3600 * 1000)
      d.setHours(h || 0, min || 0, 0, 0)
      return d.toISOString()
    }

    let normalized = raw
      .replace(/年/g, "-")
      .replace(/月/g, "-")
      .replace(/日/g, "")
      .replace(/\//g, "-")
      .replace(/\./g, "-")
      .trim()

    if (!/^20\d{2}-/.test(normalized)) {
      normalized = `${now.getFullYear()}-${normalized}`
    }

    const d = new Date(normalized)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}

export function extractPickupFromText(text: string): PickupInfo[] {
  if (!text) return []

  const results: PickupInfo[] = []
  const matcher = new RegExp(CODE_RE, "gi")
  let match: RegExpExecArray | null
  const detectedDate = parseMessageDate(text)

  while ((match = matcher.exec(text)) !== null) {
    const codeListString = match[1]
    if (!codeListString || !codeListString.trim()) continue

    let start = Math.max(0, match.index - 100)
    const lastBracket = text.lastIndexOf("【", match.index)
    const lastNewLine = text.lastIndexOf("\n", match.index)
    if (lastBracket > start) start = lastBracket
    if (lastNewLine > start) start = lastNewLine

    let end = Math.min(text.length, match.index + match[0].length + 100)
    const nextBracket = text.indexOf("【", match.index + match[0].length)
    const nextNewLine = text.indexOf("\n", match.index + match[0].length)
    if (nextBracket !== -1 && nextBracket < end) end = nextBracket
    if (nextNewLine !== -1 && nextNewLine < end) end = nextNewLine

    const context = text.slice(start, end)
    const bracketMatch = context.match(BRACKET_RE)
    const bracketName = bracketMatch ? bracketMatch[1] : null

    const locMatch = context.match(LOCATION_RE)
    let locationName = locMatch ? locMatch[1] : null
    if (locationName) locationName = locationName.replace(/^(在|位于|地址|:|：)/, "")

    const genericName = (context.match(GENERIC_RE) || [null])[0]
    const finalCourier = locationName || bracketName || genericName || null

    const snippetStart = lastBracket !== -1 ? lastBracket : Math.max(0, match.index - 40)
    let snippetEnd = text.length
    const nextCourierBracket = text.indexOf("【", match.index + match[0].length)
    if (nextCourierBracket !== -1) snippetEnd = Math.min(snippetEnd, nextCourierBracket)
    const isolatedSnippet = text.slice(snippetStart, snippetEnd).trim()

    const singleCodeRegex = /(\d+-){0,2}\d{3,8}/g
    let singleCodeMatch: RegExpExecArray | null

    while ((singleCodeMatch = singleCodeRegex.exec(codeListString)) !== null) {
      const code = singleCodeMatch[0]
      if (!code) continue
      results.push({
        courier: finalCourier,
        code,
        snippet: buildPickupSnippetText(isolatedSnippet, finalCourier, code, bracketName || genericName),
        date: detectedDate,
      })
    }
  }

  return results
}

export function splitMessages(data: string): string[] {
  const normalized = data.replace(/(\r\n|\n|\r)/g, "\n").trim()
  if (!normalized) return []

  if (normalized.includes("---SMS-DIVIDER---")) {
    return normalized.split(/---SMS-DIVIDER---/g).map((s) => s.trim()).filter(Boolean)
  }

  const byBracket = normalized.split(/(?=\n?【[^】]{2,20}】)/g).map((s) => s.trim()).filter(Boolean)
  if (byBracket.length > 1) return byBracket

  const byParagraph = normalized.split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean)
  if (byParagraph.length > 1) return byParagraph

  return [normalized]
}
