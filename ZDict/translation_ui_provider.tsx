import {
  Button,
  Device,
  DragGesture,
  GeometryReader,
  HStack,
  Image,
  Link,
  ProgressView,
  ScrollView,
  SVG,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"

declare const TranslationUIProvider: {
  readonly inputText: string | null
  readonly allowsReplacement: boolean
  present(node: any): void
  finish(translation?: string | null): void
  expandSheet?(): void
}

declare function fetch(input: string, init?: any): Promise<any>

type DictToken = {
  id: string
  text: string
  index: number
}

type TokenHitTarget = {
  token: DictToken
  x: number
  y: number
  width: number
  height: number
}

type TokenRow = {
  y: number
  tokens: Array<{ token: DictToken; width: number }>
  targets: TokenHitTarget[]
}

type ZdicResult = {
  query: string
  url: string
  title: string
  sections: ZdicSection[]
}

type ZdicSection = {
  title: string
  lines: string[]
}

type ImageFilter = {
  onlyAlt?: string
  allowedAlts?: string[]
  labelPrefix?: string
}

type LineTone = "meta" | "example" | "translation" | "quote" | "definition"

type InlineLinkToken = {
  url: string
  label: string
}

const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/
const PURE_HAN_RE = /^[\u3400-\u9fff\uf900-\ufaff]+$/

function hapticLight() {
  try {
    HapticFeedback.lightImpact()
  } catch {}
}

function hapticSuccess() {
  try {
    HapticFeedback.notificationSuccess()
  } catch {}
}

function languageHint(text: string): NaturalLanguage.Language | undefined {
  if (HAN_RE.test(text)) {
    return /[繫臺後萬與專業開關]/.test(text) ? "zh-Hant" : "zh-Hans"
  }
  try {
    const detected = NaturalLanguage.dominantLanguage(text)
    if (detected) return detected
  } catch {}
  return undefined
}

function splitGraphemes(text: string): string[] {
  const Segmenter = (globalThis as any).Intl?.Segmenter
  if (Segmenter) {
    try {
      const segmenter = new Segmenter(undefined, { granularity: "grapheme" })
      return Array.from(segmenter.segment(text) as Iterable<any>)
        .map((item: any) => String(item?.segment ?? ""))
        .filter(Boolean)
    } catch {}
  }
  return Array.from(text)
}

function pushRawToken(result: DictToken[], text: string) {
  if (!text) return
  result.push({
    id: `${result.length}-${text.length}-${text}`,
    text,
    index: result.length,
  })
}

function pushCjkChunks(result: DictToken[], text: string) {
  let buffer = ""
  for (const char of Array.from(text)) {
    buffer += char
    if (Array.from(buffer).length >= 2) {
      pushRawToken(result, buffer)
      buffer = ""
    }
  }
  pushRawToken(result, buffer)
}

function pushMixedRun(result: DictToken[], text: string) {
  let buffer = ""
  let bufferKind: "cjk" | "alnum" | null = null
  const flush = () => {
    if (!buffer || !bufferKind) return
    if (bufferKind === "cjk" && Array.from(buffer).length > 4) {
      pushCjkChunks(result, buffer)
    } else {
      pushRawToken(result, buffer)
    }
    buffer = ""
    bufferKind = null
  }
  for (const part of splitGraphemes(text)) {
    if (/^\s+$/.test(part)) {
      flush()
      continue
    }
    const kind = /^[\u3400-\u9fff\uf900-\ufaff]+$/.test(part)
      ? "cjk"
      : /^[A-Za-z0-9]+$/.test(part)
        ? "alnum"
        : null
    if (!kind) {
      flush()
      pushRawToken(result, part)
    } else if (bufferKind === kind) {
      buffer += part
    } else {
      flush()
      buffer = part
      bufferKind = kind
    }
  }
  flush()
}

function pushTextParts(result: DictToken[], text: string) {
  const matcher = /\S+/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text))) {
    const part = match[0]
    if (!HAN_RE.test(part) || Array.from(part).length <= 4) {
      pushMixedRun(result, part)
      continue
    }
    const Segmenter = (globalThis as any).Intl?.Segmenter
    if (Segmenter) {
      try {
        const segmenter = new Segmenter("zh-Hans", { granularity: "word" })
        const pieces = Array.from(segmenter.segment(part) as Iterable<any>)
          .map((item: any) => String(item?.segment ?? ""))
          .filter(Boolean)
        if (pieces.length > 1) {
          pieces.forEach((piece) => pushMixedRun(result, piece))
          continue
        }
      } catch {}
    }
    pushMixedRun(result, part)
  }
}

function tokenizeWords(text: string): DictToken[] {
  const source = String(text ?? "")
  if (!source.trim()) return []
  try {
    const language = languageHint(source)
    const tokens = NaturalLanguage.tokenize(source, {
      unit: "word",
      ...(language ? { language } : {}),
    })
    const result: DictToken[] = []
    for (const token of tokens) {
      pushTextParts(result, token.text)
    }
    return result
  } catch {
    const result: DictToken[] = []
    pushTextParts(result, source)
    return result
  }
}

function selectedTokenText(tokens: DictToken[], selectedIds: string[]): string {
  const byId = new Map(tokens.map((token) => [token.id, token.text]))
  return selectedIds.map((id) => byId.get(id) ?? "").join("")
}

function estimatedTokenWidth(text: string, compact: boolean): number {
  let width = compact ? 28 : 34
  for (const char of Array.from(text)) {
    if (HAN_RE.test(char)) width += compact ? 16 : 19
    else if (/[A-Z0-9]/.test(char)) width += compact ? 10 : 12
    else if (/[a-z]/.test(char)) width += compact ? 9 : 11
    else width += compact ? 12 : 14
  }
  return Math.max(compact ? 32 : 40, width)
}

function layoutTokens(tokens: DictToken[], width: number, compact: boolean) {
  const spacing = 8
  const rowHeight = compact ? 32 : 40
  const maxWidth = Math.max(120, width)
  const maxTokenWidth = Math.max(80, Math.min(maxWidth, compact ? 180 : 240))
  const rows: TokenRow[] = []
  let current: TokenRow = { y: 0, tokens: [], targets: [] }
  let x = 0

  for (const token of tokens) {
    const tokenWidth = Math.min(maxTokenWidth, estimatedTokenWidth(token.text, compact))
    if (current.tokens.length && x + tokenWidth > maxWidth) {
      rows.push(current)
      current = { y: rows.length * (rowHeight + spacing), tokens: [], targets: [] }
      x = 0
    }
    current.tokens.push({ token, width: tokenWidth })
    current.targets.push({ token, x, y: current.y, width: tokenWidth, height: rowHeight })
    x += tokenWidth + spacing
  }
  if (current.tokens.length) rows.push(current)
  return { rows, rowHeight, spacing }
}

function hitToken(targets: TokenHitTarget[], x: number, y: number): DictToken | null {
  for (const target of targets) {
    if (x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height) {
      return target.token
    }
  }
  return null
}

function pointNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : -1
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    middot: "·",
  }
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_all, body) => {
    if (body[0] === "#") {
      const hex = body[1]?.toLowerCase() === "x"
      const value = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : ""
    }
    return named[body] ?? ""
  })
}

function stripHtmlToLines(html: string): string[] {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<ins[\s\S]*?<\/ins>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
  const text = withoutNoise
    .replace(/<span\b[^>]*class="[^"]*(meta-badge|xxjs-block-label|jbjs-item__eg-label)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "\n$2 ")
    .replace(/<span\b[^>]*class="[^"]*(meta-pinyin|meta-zhuyin|word-pronun-text|jbjs-reading__py|jbjs-reading__zy|xxjs-reading__py|xxjs-reading__zy|gy-reading__py|gy-reading__zy|xxjs-english__text)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$2")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(h[1-6]|p|div|section|article|tr|br|dd|dt|blockquote|header|ol|ul)\b[^>]*>/gi, "\n")
    .replace(/<\/(h[1-6]|p|div|section|article|li|tr|dd|dt|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  const rawLines = decodeHtmlEntities(text)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2)
    .filter((line) => {
      if (/^(登录|注册|汉典|首页|搜索|反馈|客户端|二维码|Copyright|©)/i.test(line)) return false
      if (/^(加载中|取消|提交|纠错反馈|反馈类型|昵称或联系方式)$/.test(line)) return false
      if (!shouldKeepZdicLine(line)) return false
      return true
    })
  const seen = new Set<string>()
  return postProcessZdicLines(rawLines).filter((line) => {
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
}

function stripHtmlToAnyLines(html: string, dedupe = true): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<ins[\s\S]*?<\/ins>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_all, href, text) => {
      const label = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      return `[[LINK|${absoluteZdicUrl(String(href))}|${label}]]`
    })
    .replace(/\s*]]\s*」/g, "]]」")
    .replace(/<span\b[^>]*class="[^"]*(xxjs-pos|gy-pos|gy-sense__pos)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "\n$2\n")
    .replace(/<span\b[^>]*class="[^"]*(xxjs-block-label|jbjs-item__eg-label)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "\n$2\n")
    .replace(/<(h[1-6]|p|div|section|article|tr|br|dd|dt|blockquote|header|ol|ul|li)\b[^>]*>/gi, "\n")
    .replace(/<\/(h[1-6]|p|div|section|article|li|tr|dd|dt|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  const seen = new Set<string>()
  return decodeHtmlEntities(text)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2)
    .filter((line) => !/^(反馈|加载中|取消|提交|纠错反馈|反馈类型|昵称或联系方式)$/.test(line))
    .filter((line) => {
      if (!dedupe) return true
      if (seen.has(line)) return false
      seen.add(line)
      return true
    })
}

function shouldKeepZdicLine(line: string): boolean {
  if (HAN_RE.test(line)) return true
  if (/^\d+\.$/.test(line)) return true
  if (/^-\s*\d+\.$/.test(line)) return true
  if (/^[-\d.、\s]*[a-zA-Z][a-zA-Z\s;,.()[\]'-]+$/.test(line)) return true
  if (/^[ㄅ-ㄩˊˇˋ˙\s]+$/.test(line)) return true
  if (/^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿ\s]+$/i.test(line)) return true
  return false
}

function postProcessZdicLines(lines: string[]): string[] {
  const result: string[] = []
  const mergeLabels = /^(拼音|注音|英文|英语|德语|法语|日语|韩语|书证|近义词|反义词|例如|部首|部外|总笔画|统一码|笔顺|字形结构|字形分析)$/
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/^-\s*(\d+\.)$/, "$1")
    const next = lines[index + 1]
    if (/^\d+\.$/.test(line) && next) {
      result.push(`${line} ${next}`)
      index += 1
      continue
    }
    if (mergeLabels.test(line) && next && !mergeLabels.test(next)) {
      result.push(`${line} ${next}`)
      index += 1
      continue
    }
    if (result.length && /^（.+）$/.test(line)) {
      result[result.length - 1] = `${result[result.length - 1]} ${line}`
      continue
    }
    if (result.length && (isPinyinLine(line) || isZhuyinLine(line))) {
      result[result.length - 1] = `${result[result.length - 1]} ${line}`
      continue
    }
    result.push(line)
  }
  return result.filter((line) => !/^(书证|英文|英语|德语|法语|日语|韩语|近义词|反义词|例如)$/.test(line))
}

function isPinyinLine(line: string): boolean {
  return /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿ\s]+$/i.test(line)
}

function isZhuyinLine(line: string): boolean {
  return /^[ㄅ-ㄩˊˇˋ˙\s]+$/.test(line)
}

function lineTone(line: string): LineTone {
  if (/^词性\s+/.test(line)) return "meta"
  if (/^(拼音|注音|部首|部外|总笔画|统一码|笔顺|字形结构|字形分析|繁体|异体)/.test(line)) return "meta"
  if (/^(英文|英语|德语|法语|日语|韩语)/.test(line)) return "translation"
  if (/^(例如|如:|如：)/.test(line)) return "example"
  if (/^(书证)/.test(line)) return "quote"
  if (/^(近义词|反义词)/.test(line)) return "example"
  return "definition"
}

function displayUrl(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

function parseInlineLinks(line: string): { text: string; links: InlineLinkToken[] } | null {
  if (!line.includes("[[LINK|")) return null
  const links: InlineLinkToken[] = []
  const text = normalizeZdicTextSpacing(line.replace(/\[\[LINK\|(https?:\/\/[^|\]]+)\|([^\]]+)]]/g, (_all, url, label) => {
    links.push({ url: String(url), label: String(label) })
    return String(label)
  }))
  return links.length ? { text, links } : null
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<ins[\s\S]*?<\/ins>/gi, "")
}

function firstMatch(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[1] ?? ""
}

function normalizeZdicTextSpacing(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：？！）》」』】、])/g, "$1")
    .replace(/\s+([（《「『【])/g, "$1")
    .replace(/([（《「『【])\s+/g, "$1")
    .replace(/([）》」』】])\s+/g, "$1")
    .trim()
}

function htmlInlineText(html: string): string {
  const text = decodeHtmlEntities(String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_all, href, text) => {
      const label = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      return `[[LINK|${absoluteZdicUrl(String(href))}|${label}]]`
    })
    .replace(/\s*]]\s*」/g, "]]」")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ")
    .trim()
    .replace(/\[\[LINK\|/g, " [[LINK|")
    .replace(/]]/g, "]] ")
    .replace(/\s+/g, " ")
  return normalizeZdicTextSpacing(text)
}

function absoluteZdicUrl(url: string): string {
  if (!url) return ""
  if (url.startsWith("//")) return `https:${url}`
  if (url.startsWith("/")) return `https://zdic.net${url}`
  return url
}

function extractImages(html: string, options?: ImageFilter): string[] {
  const rows: string[] = []
  const imagePattern = /<img\b[^>]*>/gi
  let imageMatch: RegExpExecArray | null
  while ((imageMatch = imagePattern.exec(html))) {
    const tag = imageMatch[0]
    const src = absoluteZdicUrl(firstMatch(tag, /\bsrc="([^"]+)"/i))
    const alt = htmlInlineText(firstMatch(tag, /\balt="([^"]*)"/i)) || "字形"
    if (options?.onlyAlt && alt !== options.onlyAlt) continue
    if (options?.allowedAlts?.length && !options.allowedAlts.includes(alt)) continue
    if (src && /\.svg(?:$|\?)/i.test(src)) rows.push(`SVG ${options?.labelPrefix ?? alt} ${src}`)
  }
  return rows
}

function extractImageAlts(html: string): string[] {
  const alts: string[] = []
  const imagePattern = /<img\b[^>]*>/gi
  let imageMatch: RegExpExecArray | null
  while ((imageMatch = imagePattern.exec(html))) {
    const alt = htmlInlineText(firstMatch(imageMatch[0], /\balt="([^"]*)"/i))
    if (alt) alts.push(alt)
  }
  return Array.from(new Set(alts))
}

function extractZdicLinkLabels(html: string): string[] {
  const labels: string[] = []
  const linkPattern = /<a\b[^>]*href="\/hans\/[^"]+"[^>]*>([\s\S]*?)<\/a>/gi
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkPattern.exec(html))) {
    const label = htmlInlineText(linkMatch[1])
    if (label && PURE_HAN_RE.test(label) && Array.from(label).length <= 4) labels.push(label)
  }
  return Array.from(new Set(labels))
}

function extractTagTexts(html: string, pattern: RegExp): string[] {
  const result: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const text = decodeHtmlEntities(String(match[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    if (text) result.push(text)
  }
  return result
}

function parseCharInfoSection(articleHtml: string, query: string): string[] {
  const rows: string[] = []
  rows.push(...extractImages(articleHtml, { onlyAlt: query, labelPrefix: query }).slice(0, 1))
  const headword = htmlInlineText(firstMatch(articleHtml, /<div\b[^>]*class="[^"]*word-headword-row[^"]*"[^>]*>([\s\S]*?)<\/div>/i))
  if (headword) rows.push(headword)
  const metaRows = extractTagTexts(articleHtml, /<div\b[^>]*class="[^"]*meta-row[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)
  rows.push(...metaRows)
  const pronunRows = extractTagTexts(articleHtml, /<div\b[^>]*class="[^"]*word-pronun-row[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)
  rows.push(...pronunRows)
  if (!rows.length) rows.push(...stripHtmlToLines(articleHtml).slice(0, 20))
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (!row || seen.has(row)) return false
    seen.add(row)
    return true
  })
}

function extractReadingLine(sectionHtml: string, className: string): string {
  const html = firstMatch(sectionHtml, new RegExp(`<(?:div|header)\\b[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:div|header)>`, "i"))
  return htmlInlineText(html)
}

function classTokenPattern(className: string): string {
  return `(?:[^"]*\\s)?${className}(?:\\s[^"]*)?`
}

function extractClassBlockHtml(html: string, className: string): string {
  const startPattern = new RegExp(`<([a-zA-Z][\\w:-]*)\\b[^>]*class="${classTokenPattern(className)}"[^>]*>`, "i")
  const match = startPattern.exec(html)
  if (!match) return ""
  const tagName = match[1]
  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi")
  tagPattern.lastIndex = match.index + match[0].length
  let depth = 1
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = tagPattern.exec(html))) {
    if (tagMatch[0].startsWith("</")) depth -= 1
    else depth += 1
    if (depth === 0) return html.slice(match.index, tagPattern.lastIndex)
  }
  return html.slice(match.index)
}

function extractBlockText(html: string, className: string): string {
  return htmlInlineText(extractClassBlockHtml(html, className))
}

function extractBalancedBlocks(html: string, tagName: string, className: string): string[] {
  const blocks: string[] = []
  const startPattern = className
    ? new RegExp(`<${tagName}\\b[^>]*class="[^"]*${className}[^"]*"[^>]*>`, "gi")
    : new RegExp(`<${tagName}\\b[^>]*>`, "gi")
  let match: RegExpExecArray | null
  while ((match = startPattern.exec(html))) {
    let cursor = startPattern.lastIndex
    let depth = 1
    const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi")
    tagPattern.lastIndex = cursor
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = tagPattern.exec(html))) {
      if (tagMatch[0].startsWith("</")) depth -= 1
      else depth += 1
      if (depth === 0) {
        blocks.push(html.slice(match.index, tagPattern.lastIndex))
        startPattern.lastIndex = tagPattern.lastIndex
        break
      }
    }
  }
  return blocks
}

function extractCitationLines(html: string): string[] {
  const citations: string[] = []
  const itemPattern = /<li\b[^>]*class="[^"]*(?:xxjs-citation__item|gy-sense__cit-item)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  let itemMatch: RegExpExecArray | null
  while ((itemMatch = itemPattern.exec(html))) {
    const text = htmlInlineText(itemMatch[1])
    if (text) citations.push(`书证 ${text}`)
  }
  return citations
}

function extractAlsoLines(html: string): string[] {
  const lines: string[] = []
  const alsoPattern = /<div\b[^>]*class="[^"]*xxjs-also[^"]*"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="[^"]*xxjs-also|<\/div>\s*<\/div>|<\/li>|<\/section>)/gi
  let alsoMatch: RegExpExecArray | null
  while ((alsoMatch = alsoPattern.exec(html))) {
    const block = alsoMatch[1]
    const label = htmlInlineText(firstMatch(block, /<span\b[^>]*class="[^"]*xxjs-block-label[^"]*"[^>]*>([\s\S]*?)<\/span>/i))
    const textBlock = firstMatch(block, /<span\b[^>]*class="[^"]*xxjs-also__text[^"]*"[^>]*>([\s\S]*)/i)
      .replace(/<\/span>[\s\S]*$/i, (suffix) => suffix.replace(/<\/span>/i, ""))
    const text = htmlInlineText(textBlock)
    if (label && text) lines.push(`${label} ${text}`)
  }
  return lines
}

function parseWordExplanationSection(sectionHtml: string): string[] {
  const lines: string[] = []
  const reading = extractReadingLine(sectionHtml, "xxjs-reading-head")
  if (reading) lines.push(reading)

  const itemPattern = /<li\b[^>]*class="[^"]*xxjs-item[^"]*"[^>]*>([\s\S]*?)(?=<li\b[^>]*class="[^"]*xxjs-item|<\/ol>)/gi
  let itemMatch: RegExpExecArray | null
  let itemIndex = 0
  while ((itemMatch = itemPattern.exec(sectionHtml))) {
    itemIndex += 1
    const itemHtml = itemMatch[1]
    const isNoNum = /xxjs-item--nonum/.test(itemMatch[0])
    const def = extractBlockText(itemHtml, "xxjs-item__def")
    if (def) lines.push(isNoNum ? def : `${itemIndex}. ${def}`)

    lines.push(...extractCitationLines(itemHtml))

    lines.push(...extractAlsoLines(itemHtml))

    const english = extractBlockText(itemHtml, "xxjs-english__text")
    if (english) lines.push(`英文 ${english}`)
  }
  return lines
}

function parseGuoyuSection(sectionHtml: string): string[] {
  const structured = parseGySenseSection(sectionHtml)
  if (structured.length) return structured

  if (sectionHtml.includes("gy-reading__head") && sectionHtml.includes("gy-sense-list")) {
    const fullLines = stripHtmlToAnyLines(sectionHtml, false)
      .filter((line) => !/^(国语辞典|书证|反馈)$/.test(line))
    if (fullLines.some((line) => isPartOfSpeechLine(line))) return formatDictionaryDetailLines(fullLines)
  }

  const lines: string[] = []
  const reading = extractReadingLine(sectionHtml, "gy-reading__head")
  if (reading) lines.push(reading)

  const sensePattern = /<div\b[^>]*class="[^"]*\bgy-sense\b[^"]*"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="[^"]*\bgy-sense\b[^"]*"|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/gi
  let senseMatch: RegExpExecArray | null
  let senseIndex = 0
  while ((senseMatch = sensePattern.exec(sectionHtml))) {
    const senseHtml = senseMatch[1]
    if (/gy-sense__body/.test(senseHtml) === false) continue
    senseIndex += 1
    const num = extractBlockText(senseHtml, "gy-sense__num") || (senseIndex > 1 ? `${senseIndex}.` : "")
    const def = extractBlockText(senseHtml, "gy-sense__def")
    if (def) lines.push(num ? `${num} ${def}` : def)

    lines.push(...extractCitationLines(senseHtml))

    lines.push(...extractAlsoLines(senseHtml))
  }
  return lines
}

function parseGySenseSection(sectionHtml: string): string[] {
  const lines: string[] = []
  const reading = extractReadingLine(sectionHtml, "gy-reading__head")
  if (reading) lines.push(reading)
  const senseGuoyu = firstMatch(sectionHtml, /<div\b[^>]*id="sense-guoyu"[^>]*>([\s\S]*)/i) || sectionHtml
  const posSections = extractBalancedBlocks(senseGuoyu, "section", "")
  if (posSections.length) {
    for (const section of posSections) {
      const pos = extractBlockText(section, "gy-pos-badge") || htmlInlineText(firstMatch(section, /<span\b[^>]*>([\s\S]*?)<\/span>/i))
      if (pos) lines.push(`词性 ${pos}`)
      const body = firstMatch(section, /<div\b[^>]*>([\s\S]*)<\/div>/i) || section
      const senses = extractBalancedBlocks(body, "div", "gy-sense").filter((block) => /gy-sense__body|gy-sense__def/.test(block))
      senses.forEach((sense, index) => {
        const num = extractBlockText(sense, "gy-sense__num") || (senses.length > 1 ? `${index + 1}.` : "")
        const def = extractBlockText(sense, "gy-sense__def")
        if (def) lines.push(num ? `${num} ${def}` : def)
        lines.push(...extractCitationLines(sense))
        lines.push(...extractAlsoLines(sense))
      })
    }
    return lines.length > (reading ? 1 : 0) ? lines : []
  }

  const senses = extractBalancedBlocks(sectionHtml, "div", "gy-sense").filter((block) => /gy-sense__body/.test(block))
  senses.forEach((sense, index) => {
    const pos = extractBlockText(sense, "gy-sense__pos") || extractBlockText(sense, "gy-pos-badge")
    if (pos) lines.push(`词性 ${pos}`)
    const num = extractBlockText(sense, "gy-sense__num") || (senses.length > 1 ? `${index + 1}.` : "")
    const def = extractBlockText(sense, "gy-sense__def")
    if (def) lines.push(num ? `${num} ${def}` : def)
    lines.push(...extractCitationLines(sense))
    lines.push(...extractAlsoLines(sense))
  })
  return lines.length > (reading ? 1 : 0) ? lines : []
}

function parseBasicCharSection(sectionHtml: string): string[] {
  const lines: string[] = []
  const reading = extractReadingLine(sectionHtml, "jbjs-reading__head")
  if (reading) lines.push(reading)

  const itemPattern = /<li\b[^>]*class="[^"]*jbjs-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  let itemMatch: RegExpExecArray | null
  let index = 0
  while ((itemMatch = itemPattern.exec(sectionHtml))) {
    index += 1
    const itemHtml = itemMatch[1]
    const def = extractBlockText(itemHtml, "jbjs-item__def")
    if (def) lines.push(`${index}. ${def}`)
    const example = extractBlockText(itemHtml, "jbjs-item__eg")
    if (example) lines.push(`例如 ${example}`)
  }
  return lines
}

function parseDetailedCharSection(sectionHtml: string): string[] {
  const structured = parseXxjsPosBadgeSections(sectionHtml)
  if (structured.length) return structured
  return formatDictionaryDetailLines(stripHtmlToAnyLines(sectionHtml, false)
    .filter((line) => !/^(详细解释|书证|反馈)$/.test(line))
  )
}

function parseXxjsPosBadgeSections(sectionHtml: string): string[] {
  const lines: string[] = []
  const reading = extractReadingLine(sectionHtml, "xxjs-reading__head")
  if (reading) lines.push(reading)
  const body = extractBalancedBlocks(sectionHtml, "div", "xxjs-body")[0] || sectionHtml
  const sections = extractBalancedBlocks(body, "section", "xxjs-pos-section")
  for (const section of sections) {
    const pos = extractBlockText(section, "xxjs-pos-badge")
    if (pos) lines.push(`词性 ${pos}`)
    const items = extractBalancedBlocks(section, "li", "xxjs-item")
    items.forEach((item, index) => {
      const def = extractBlockText(item, "xxjs-item__def") || htmlInlineText(item)
      if (def) lines.push(`${index + 1}. ${def}`)
      lines.push(...extractCitationLines(item))
      lines.push(...extractAlsoLines(item))
      const english = extractBlockText(item, "xxjs-english__text")
      if (english) lines.push(`英文 ${english}`)
    })
  }
  return lines.length > (reading ? 1 : 0) ? lines : []
}

function isPartOfSpeechLine(line: string): boolean {
  return /^(名|动|形|副|代|介|连|助|叹|量|数|拟声|区别)$/.test(line)
}

function splitInlineReadingPartOfSpeech(line: string): { reading: string; partOfSpeech: string; rest: string } | null {
  const match = line.match(/^(.+?)\s+(名|动|形|副|代|介|连|助|叹|量|数|拟声|区别)(?:\s+(.*))?$/)
  if (!match) return null
  if (!isSectionInlineReading(match[1]) && Array.from(match[1]).length > 4) return null
  return { reading: match[1].trim(), partOfSpeech: match[2], rest: String(match[3] ?? "").trim() }
}

function isSectionInlineReading(line: string): boolean {
  return HAN_RE.test(line) && /[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(line) && /[ㄅ-ㄩ]/.test(line)
}

function formatDictionaryDetailLines(lines: string[]): string[] {
  const result: string[] = []
  const skipLabels = new Set(["书证", "例如", "英文"])
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || skipLabels.has(line)) {
      const next = lines[index + 1]
      if (line === "书证" && next) {
        result.push(`书证 ${next.replace(/^[-*]\s*/, "")}`)
        index += 1
      } else if ((line === "例如" || line === "英文") && next) {
        result.push(`${line} ${next}`)
        index += 1
      }
      continue
    }
    const inline = splitInlineReadingPartOfSpeech(line)
    if (inline) {
      result.push(inline.reading)
      result.push(`词性 ${inline.partOfSpeech}`)
      if (inline.rest) result.push(inline.rest)
      continue
    }
    const posWithRest = line.match(/^(名|动|形|副|代|介|连|助|叹|量|数|拟声|区别)\s+(.+)$/)
    if (posWithRest) {
      result.push(`词性 ${posWithRest[1]}`)
      result.push(posWithRest[2])
      continue
    }
    if (isPartOfSpeechLine(line)) {
      result.push(`词性 ${line}`)
      continue
    }
    if (/^\d+\.$/.test(line)) {
      const next = lines[index + 1]
      if (next) {
        result.push(`${line} ${next}`)
        index += 1
      }
      continue
    }
    if (/^[-*]\s*/.test(line)) {
      result.push(`书证 ${line.replace(/^[-*]\s*/, "")}`)
      continue
    }
    if (/^英文\s*/.test(line) || /^例如\s*/.test(line)) {
      result.push(line)
      continue
    }
    if (isSectionInlineReading(line)) {
      result.push(line)
      continue
    }
    result.push(line)
  }
  return result
}

function parseAncientSection(sectionHtml: string, query: string, allowedAlts: string[]): string[] {
  const sectionId = firstMatch(sectionHtml, /\bid="([^"]+)"/i)
  const imageLimit = sectionId === "zyzx" ? 12 : 2
  const ancientAlts = Array.from(new Set([query, ...allowedAlts, ...extractZdicLinkLabels(sectionHtml)]))
  const images = extractImages(sectionHtml, sectionId === "zyzx" ? undefined : { allowedAlts: ancientAlts, labelPrefix: query }).slice(0, imageLimit)
  if (sectionId === "zyzx") return images
  const lines = stripHtmlToLines(sectionHtml)
    .filter((line) => !/^(康熙字典|说文解字|音韵方言|字源字形)$/.test(line))
    .map((line) => line.replace(/^-\s*/, ""))
  return [...images, ...lines]
}

function parsePhonologySection(sectionHtml: string): string[] {
  const rows: string[] = []
  const rowPattern = /<div\b[^>]*class="[^"]*phon-defs__row[^"]*"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="[^"]*phon-defs__row|<\/div>\s*<\/div>)/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(sectionHtml))) {
    const rowHtml = rowMatch[1]
    const label = htmlInlineText(firstMatch(rowHtml, /<[^>]+class="[^"]*phon-defs__label[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i))
    const value = htmlInlineText(firstMatch(rowHtml, /<[^>]+class="[^"]*phon-defs__value[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i))
    if (label && value) rows.push(`${label} ${value}`)
  }
  if (rows.length) return rows

  const lines = stripHtmlToAnyLines(sectionHtml)
    .filter((line) => !/^(音韵方言|概览|韵书|方言|上古音系|中古音|上古音|音标 & 周边语言|方言读音（旧版简文）|音系简文|反馈)$/.test(line))
  const result: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index]
    const value = lines[index + 1]
    if (value && !/[：:；;]/.test(label) && label.length <= 12) {
      result.push(`${label} ${value}`)
      index += 1
    }
  }
  return result.length ? result : lines
}

function parseSynonymSection(sectionHtml: string): string[] {
  const rows: string[] = []
  const rowPattern = /<div\b[^>]*class="[^"]*synonym-row[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(sectionHtml))) {
    const rowHtml = rowMatch[1]
    const label = decodeHtmlEntities(firstMatch(rowHtml, /<span\b[^>]*class="[^"]*synonym-label[^"]*"[^>]*>([\s\S]*?)<\/span>/i).replace(/<[^>]+>/g, " ").trim())
    const words = extractTagTexts(rowHtml, /<a\b[^>]*class="[^"]*synonym-tag[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)
    if (label && words.length) rows.push(`${label} ${words.join(" ")}`)
  }
  return rows
}

function parseTranslationSection(sectionHtml: string): string[] {
  const rows: string[] = []
  const rowPattern = /<div\b[^>]*class="[^"]*word-trans__row[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(sectionHtml))) {
    const rowHtml = rowMatch[1]
    const lang = decodeHtmlEntities(firstMatch(rowHtml, /<dt\b[^>]*class="[^"]*word-trans__lang[^"]*"[^>]*>([\s\S]*?)<\/dt>/i).replace(/<[^>]+>/g, " ").trim())
    const text = decodeHtmlEntities(firstMatch(rowHtml, /<dd\b[^>]*class="[^"]*word-trans__text[^"]*"[^>]*>([\s\S]*?)<\/dd>/i).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    if (lang && text) rows.push(`${lang} ${text}`)
  }
  return rows
}

function parseZdicSections(html: string, fallbackTitle: string, query: string): ZdicSection[] {
  const source = stripNoise(html)
  const sections: ZdicSection[] = []
  const head = firstMatch(source, /<article\b[^>]*class="[^"]*char-card[^"]*"[^>]*>([\s\S]*?)<\/article>/i)
  const allowedImageAlts = Array.from(new Set([query, ...extractImageAlts(head)]))
  if (head) {
    const lines = parseCharInfoSection(head, query)
    if (lines.length) {
      sections.push({ title: "字词信息", lines })
    }
  }

  for (const sectionHtml of extractDictSections(source)) {
    const dataTitle = decodeHtmlEntities(firstMatch(sectionHtml, /\bdata-section="([^"]+)"/i)).trim()
    const h2Title = decodeHtmlEntities(firstMatch(sectionHtml, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    const title = dataTitle || h2Title || "解释"
    const sectionId = firstMatch(sectionHtml, /\bid="([^"]+)"/i)
    const specializedLines =
      sectionId === "jbjs" ? parseBasicCharSection(sectionHtml)
      : sectionId === "xxjs" ? (sectionHtml.includes("xxjs-reading__head") ? parseDetailedCharSection(sectionHtml) : parseWordExplanationSection(sectionHtml))
      : sectionId === "gyjs" ? parseGuoyuSection(sectionHtml)
      : sectionId === "syn" ? parseSynonymSection(sectionHtml)
      : sectionId === "trans" ? parseTranslationSection(sectionHtml)
      : sectionId === "yyfy" ? parsePhonologySection(sectionHtml)
      : sectionId === "kxzd" || sectionId === "swjz" || sectionId === "zyzx" ? parseAncientSection(sectionHtml, query, allowedImageAlts)
      : []
    const lines = (specializedLines.length ? specializedLines : stripHtmlToLines(sectionHtml))
      .filter((line) => line !== title && line !== h2Title)
    if (lines.length) sections.push({ title, lines })
  }

  if (!sections.length) {
    const lines = stripHtmlToLines(source)
    if (lines.length) sections.push({ title: fallbackTitle, lines })
  }
  return sections
}

function extractDictSections(source: string): string[] {
  const starts: number[] = []
  const startPattern = /<section\b[^>]*class="[^"]*dict-section[^"]*"[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = startPattern.exec(source))) {
    starts.push(match.index)
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? source.indexOf("</main>", start)
    return source.slice(start, end > start ? end : undefined)
  })
}

function extractTitle(html: string, fallback: string): string {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const title = h1 ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const cleaned = title
    ? decodeHtmlEntities(title.replace(/<[^>]+>/g, "").replace(/_汉典.*$/i, "").trim())
    : ""
  return cleaned || fallback
}

function isChineseQuery(text: string): boolean {
  const normalized = text.replace(/\s+/g, "")
  return normalized.length > 0 && PURE_HAN_RE.test(normalized)
}

function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, "")
}

async function lookupZdic(rawQuery: string): Promise<ZdicResult> {
  const query = normalizeQuery(rawQuery)
  if (!isChineseQuery(query)) {
    throw new Error("仅支持查询中文汉字或词语")
  }
  const encodedQuery = encodeURIComponent(query)
  const requestUrl = `https://zdic.net/hans/${encodedQuery}`
  const response = await fetch(requestUrl)
  const url = String((response as any).url || requestUrl)
  if (!response.ok) {
    throw new Error(`汉典返回 ${response.status}`)
  }
  const html = await response.text()
  const title = extractTitle(html, query)
  const sections = parseZdicSections(html, title, query)
  return {
    query,
    url,
    title,
    sections: sections.length ? sections : [{ title: "查询结果", lines: ["未从页面中解析到可展示内容。"] }],
  }
}

function GlassPanel(props: {
  children: any
  padding?: any
  frame?: any
  cornerRadius?: number
  spacing?: number
}) {
  const radius = props.cornerRadius ?? 12
  return (
    <ZStack
      alignment="topLeading"
      frame={props.frame ?? { maxWidth: "infinity", alignment: "topLeading" as any }}
      background={"clear" as any}
      glassEffect={{ type: "rect", cornerRadius: radius } as any}
      clipShape={{ type: "rect", cornerRadius: radius } as any}
    >
      <VStack
        spacing={props.spacing ?? 10}
        padding={props.padding ?? 12}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      >
        {props.children}
      </VStack>
    </ZStack>
  )
}

async function copyText(text: string) {
  if (!text) return
  await Pasteboard.setString(text)
  hapticSuccess()
}

async function openUrl(url: string) {
  if (!url) return
  try {
    await Safari.openURL(url)
  } catch {
    await copyText(url)
  }
}

function ResultLine(props: {
  line: string
  onQuery?: (text: string) => void
}) {
  const inlineLinks = parseInlineLinks(props.line)
  if (inlineLinks) {
    const labeledLinks = inlineLinks.text.match(/^(近义词|反义词)\s+(.+)$/)
    if (labeledLinks) {
      const tone = labeledLinks[1] === "反义词" ? "systemRed" : "systemGreen"
      return (
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <ZStack
            frame={{ width: 64, height: 22 }}
            background={"clear" as any}
            glassEffect={{ type: "rect", cornerRadius: 6 } as any}
            clipShape={{ type: "rect", cornerRadius: 6 } as any}
          >
            <Text font="caption2" foregroundStyle={tone as any}>{labeledLinks[1]}</Text>
          </ZStack>
          <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {inlineLinks.links.map((link, index) => (
              <Text
                key={`${index}-${link.label}`}
                font="subheadline"
                foregroundStyle={tone as any}
                onTapGesture={() => props.onQuery?.(link.label)}
              >
                {link.label}
              </Text>
            ))}
          </HStack>
        </HStack>
      )
    }
    return (
      <Text
        font="body"
        foregroundStyle="label"
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        multilineTextAlignment="leading"
        selectionDisabled={false}
        onTapGesture={() => props.onQuery?.(inlineLinks.links[0]?.label ?? "")}
      >
        {inlineLinks.text}
      </Text>
    )
  }

  const linkLine = props.line.match(/^(.*)链接\s+(https?:\/\/\S+)(.*)$/)
  if (linkLine) {
    const before = linkLine[1].replace(/\s+/g, " ").trim()
    const after = linkLine[3].replace(/\s+/g, " ").trim()
    const linkText = before.match(/「([^」]+)」\s*$/)?.[1] ?? before.split(/\s+/).filter(Boolean).pop() ?? "参见"
    const prefix = before.endsWith(linkText) ? before.slice(0, -linkText.length).trim() : before
    return (
      <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text
          font="body"
          foregroundStyle="label"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
          selectionDisabled={false}
        >
          {`${prefix} ${after}`.trim()}
        </Text>
        <Link url={linkLine[2]}>
          <Text font="subheadline" foregroundStyle="systemBlue">{linkText}</Text>
        </Link>
      </HStack>
    )
  }
  const svgLine = props.line.match(/^SVG\s+(.+?)\s+(https?:\/\/\S+)$/)
  if (svgLine) {
    return (
      <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <ZStack
          frame={{ width: 92, height: 92 }}
          background={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 8 } } as any}
          clipShape={{ type: "rect", cornerRadius: 8 } as any}
        >
          <SVG
            url={svgLine[2]}
            resizable
            scaleToFit
            frame={{ width: 76, height: 76 }}
          />
        </ZStack>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
        >
          {svgLine[1]}
        </Text>
      </HStack>
    )
  }
  const imageLine = props.line.match(/^图片\s+(.+?)\s+(https?:\/\/\S+)$/)
  if (imageLine) {
    return (
      <Text font="caption" foregroundStyle="secondaryLabel">
        {imageLine[1]}
      </Text>
    )
  }
  const numbered = props.line.match(/^(\d+\.)\s*(.+)$/)
  const labeled = props.line.match(/^(词性|拼音|注音|部首|部外|总笔画|统一码|笔顺|字形结构|字形分析|繁体|异体|英文|英语|德语|法语|日语|韩语|书证|近义词|反义词|例如)\s+(.+)$/)
  const tone = lineTone(props.line)
  const foregroundStyle =
    /^反义词/.test(props.line) ? "systemRed"
    : /^近义词/.test(props.line) ? "systemGreen"
    : /^词性/.test(props.line) ? "systemRed"
    : tone === "meta" ? "label"
    : tone === "translation" ? "systemBlue"
    : tone === "example" ? "systemGreen"
    : tone === "quote" ? "label"
    : "label"
  const marker =
    labeled ? labeled[1]
    : numbered ? numbered[1]
    : props.line.startsWith("- ") ? "•"
    : ""
  const text =
    labeled ? labeled[2]
    : numbered ? numbered[2]
    : props.line.startsWith("- ") ? props.line.slice(2).trim()
    : props.line
  const markerWidth = marker.length <= 1 ? 22 : Math.min(72, marker.length * 18 + 10)

  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
      {numbered ? (
        <Text
          font="body"
          foregroundStyle="secondaryLabel"
          frame={{ width: 28, alignment: "trailing" as any }}
        >
          {numbered[1]}
        </Text>
      ) : marker ? (
        <ZStack
          frame={{ width: markerWidth, height: 22 }}
          background={"clear" as any}
          glassEffect={{ type: "rect", cornerRadius: 6 } as any}
          clipShape={{ type: "rect", cornerRadius: 6 } as any}
        >
          <Text font="caption2" foregroundStyle={foregroundStyle as any}>{marker}</Text>
        </ZStack>
      ) : null}
      <Text
        font={tone === "definition" ? "body" : "subheadline"}
        foregroundStyle={foregroundStyle as any}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        multilineTextAlignment="leading"
        selectionDisabled={false}
      >
        {text}
      </Text>
    </HStack>
  )
}

function SvgThumb(props: {
  line: string
  compact?: boolean
}) {
  const svgLine = props.line.match(/^SVG\s+(.+?)\s+(https?:\/\/\S+)$/)
  if (!svgLine) return null as any
  const size = props.compact ? 72 : 92
  const inner = props.compact ? 58 : 76
  return (
    <VStack spacing={4} frame={{ width: size, alignment: "center" as any }}>
      <ZStack
        frame={{ width: size, height: size }}
        background={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 8 } } as any}
        clipShape={{ type: "rect", cornerRadius: 8 } as any}
      >
        <SVG
          url={svgLine[2]}
          resizable
          scaleToFit
          frame={{ width: inner, height: inner }}
        />
      </ZStack>
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{svgLine[1]}</Text>
    </VStack>
  )
}

function SectionLines(props: {
  title: string
  lines: string[]
  onQuery?: (text: string) => void
}) {
  const svgLines = props.lines.filter((line) => /^SVG\s+/.test(line))
  const textLines = props.lines.filter((line) => !/^SVG\s+/.test(line))
  const isGlyphSection = /字源字形/.test(props.title)
  const isPhonology = /音韵方言/.test(props.title)
  const isDictionaryDetail = /详细解释|詳細解釋|国语辞典|國語辭典/.test(props.title)
  if (isDictionaryDetail) {
    return <DictionaryDetailView lines={props.lines} onQuery={props.onQuery} />
  }
  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      {svgLines.length ? (
        isGlyphSection ? (
          <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text font="subheadline" foregroundStyle="secondaryLabel">字源演变</Text>
            <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={8}>
                {svgLines.slice(0, Math.ceil(svgLines.length / 2)).map((line, index) => <SvgThumb key={`${index}-${line}`} line={line} compact />)}
              </HStack>
            </ScrollView>
            <Text font="subheadline" foregroundStyle="secondaryLabel">字形对比</Text>
            <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={8}>
                {svgLines.slice(Math.ceil(svgLines.length / 2)).map((line, index) => <SvgThumb key={`${index}-${line}`} line={line} compact />)}
              </HStack>
            </ScrollView>
          </VStack>
        ) : (
          <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
            {svgLines.slice(0, 1).map((line, index) => <SvgThumb key={`${index}-${line}`} line={line} />)}
            <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              {textLines.map((line, index) => <ResultLine key={`${index}-${line.slice(0, 12)}`} line={line} onQuery={props.onQuery} />)}
            </VStack>
          </HStack>
        )
      ) : null}
      {(!svgLines.length || isGlyphSection) ? (
        <VStack spacing={isPhonology ? 6 : 8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {textLines.map((line, index) => isPhonology ? (
            <PhonologyLine key={`${index}-${line.slice(0, 12)}`} line={line} />
          ) : (
            <ResultLine key={`${index}-${line.slice(0, 12)}`} line={line} onQuery={props.onQuery} />
          ))}
        </VStack>
      ) : null}
    </VStack>
  )
}

function DictionaryDetailView(props: {
  lines: string[]
  onQuery?: (text: string) => void
}) {
  return (
    <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      {props.lines.map((line, index) => {
        const pos = line.match(/^词性\s+(.+)$/)
        if (pos) {
          return (
            <HStack
              key={`${index}-${line}`}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            >
              <ZStack
                frame={{ width: 34, height: 28 }}
                background={{ style: "systemRed", shape: { type: "rect", cornerRadius: 7 } } as any}
              >
                <Text font="headline" foregroundStyle="white">{pos[1]}</Text>
              </ZStack>
            </HStack>
          )
        }
        const numbered = line.match(/^(\d+\.)\s*(.+)$/)
        if (numbered) {
          return (
            <HStack key={`${index}-${line}`} spacing={10} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
              <ZStack
                frame={{ width: 28, height: 28 }}
                background={{ style: "tertiarySystemFill", shape: { type: "circle" } } as any}
              >
                <Text font="caption" foregroundStyle="label">{numbered[1].replace(".", "")}</Text>
              </ZStack>
              <Text
                font="body"
                foregroundStyle="label"
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                multilineTextAlignment="leading"
                selectionDisabled={false}
              >
                {numbered[2]}
              </Text>
            </HStack>
          )
        }
        return <ResultLine key={`${index}-${line.slice(0, 12)}`} line={line} onQuery={props.onQuery} />
      })}
    </VStack>
  )
}

function PhonologyLine(props: {
  line: string
}) {
  const parts = props.line.split(/\s+/)
  const label = parts.length > 1 ? parts[0] : ""
  const value = parts.length > 1 ? parts.slice(1).join(" ") : props.line
  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
      {label ? (
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ width: 72, alignment: "leading" as any }}
          lineLimit={2}
        >
          {label}
        </Text>
      ) : null}
      <Text
        font="subheadline"
        foregroundStyle="label"
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        multilineTextAlignment="leading"
        selectionDisabled={false}
      >
        {value}
      </Text>
    </HStack>
  )
}

function TokenSelectionPanel(props: {
  tokens: DictToken[]
  selectedIds: string[]
  selectedText: string
  onToggle: (token: DictToken) => void
}) {
  const suppressTapAfterDragRef = useRef(false)
  const draggedTokenIdsRef = useRef<Set<string>>(new Set())
  const estimatedPanelWidth = Math.max(120, Device.screen.width - 56)
  const estimatedLayout = layoutTokens(props.tokens, estimatedPanelWidth, false)
  const tokenAreaHeight = estimatedLayout.rows.length
    ? estimatedLayout.rows.length * estimatedLayout.rowHeight + Math.max(0, estimatedLayout.rows.length - 1) * estimatedLayout.spacing
    : 32
  const panelHeight = Math.min(300, Math.max(104, 74 + tokenAreaHeight))
  return (
    <ZStack
      alignment="topLeading"
      frame={{ maxWidth: "infinity", height: panelHeight, alignment: "topLeading" as any }}
      background={"clear" as any}
      glassEffect={{ type: "rect", cornerRadius: 14 } as any}
      clipShape={{ type: "rect", cornerRadius: 12 } as any}
    >
      <VStack spacing={10} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }} padding={12}>
        <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text font="caption" foregroundStyle="secondaryLabel">已选择</Text>
          <Text
            font="subheadline"
            lineLimit={2}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {props.selectedText || "点击或横向滑过分词结果进行选择"}
          </Text>
        </VStack>
        <GeometryReader>
          {(proxy) => {
            const fallbackWidth = Math.max(120, Device.screen.width - 56)
            const contentWidth = proxy.size.width > 40 ? proxy.size.width : fallbackWidth
            const layout = layoutTokens(props.tokens, contentWidth, false)
            const targets = layout.rows.flatMap((row) => row.targets)
            const toggleHitToken = (x: number, y: number) => {
              const token = hitToken(targets, x, y)
              if (!token || draggedTokenIdsRef.current.has(token.id)) return
              suppressTapAfterDragRef.current = true
              draggedTokenIdsRef.current.add(token.id)
              props.onToggle(token)
            }
            const selectGesture = DragGesture({ minDistance: 24, coordinateSpace: "local" })
              .onChanged((gesture) => {
                const dx = Math.abs(Number(gesture.translation?.width ?? 0))
                const dy = Math.abs(Number(gesture.translation?.height ?? 0))
                if (dx <= dy * 1.8) return
                toggleHitToken(pointNumber(gesture.startLocation?.x), pointNumber(gesture.startLocation?.y))
                toggleHitToken(pointNumber(gesture.location?.x), pointNumber(gesture.location?.y))
              })
              .onEnded(() => {
                draggedTokenIdsRef.current.clear()
                ;(globalThis as any).setTimeout?.(() => {
                  suppressTapAfterDragRef.current = false
                }, 120)
              })
            return (
              <ScrollView axes="vertical" scrollIndicator="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                {props.tokens.length ? (
                  <VStack
                    spacing={layout.spacing}
                    frame={{ width: contentWidth, alignment: "topLeading" as any }}
                    simultaneousGesture={selectGesture}
                  >
                    {layout.rows.map((row) => (
                      <HStack
                        key={`row-${row.y}`}
                        spacing={layout.spacing}
                        frame={{ width: contentWidth, height: layout.rowHeight, alignment: "leading" as any }}
                      >
                        {row.tokens.map(({ token, width }) => {
                          const selected = props.selectedIds.includes(token.id)
                          return (
                            <ZStack
                              key={token.id}
                              frame={{ width, height: layout.rowHeight }}
                              background={selected ? { style: "systemBlue", shape: { type: "rect", cornerRadius: 8 } } : "clear" as any}
                              glassEffect={!selected ? { type: "rect", cornerRadius: 8 } as any : undefined}
                              clipShape={{ type: "rect", cornerRadius: 8 } as any}
                              onTapGesture={() => {
                                if (suppressTapAfterDragRef.current) return
                                hapticLight()
                                props.onToggle(token)
                              }}
                            >
                              <Text
                                font="body"
                                foregroundStyle={selected ? "white" : "label"}
                                padding={{ top: 8, bottom: 8, leading: 12, trailing: 12 }}
                                lineLimit={1}
                                allowsTightening
                                frame={{ width, height: layout.rowHeight, alignment: "center" as any }}
                              >
                                {token.text}
                              </Text>
                            </ZStack>
                          )
                        })}
                      </HStack>
                    ))}
                  </VStack>
                ) : (
                  <Text foregroundStyle="secondaryLabel">没有可用的分词结果</Text>
                )}
              </ScrollView>
            )
          }}
        </GeometryReader>
      </VStack>
    </ZStack>
  )
}

function ResultView(props: {
  result: ZdicResult | null
  loading: boolean
  errorText: string
  onQuery?: (text: string) => void
}) {
  if (props.loading) {
    return (
      <GlassPanel frame={{ maxWidth: "infinity", alignment: "center" as any }} padding={18}>
        <ProgressView progressViewStyle="circular" />
        <Text font="subheadline" foregroundStyle="secondaryLabel">正在查询汉典</Text>
      </GlassPanel>
    )
  }
  if (props.errorText) {
    return (
      <GlassPanel padding={14}>
        <Text font="headline" foregroundStyle="systemRed">查询失败</Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
          {props.errorText}
        </Text>
      </GlassPanel>
    )
  }
  if (!props.result) {
    return (
      <GlassPanel padding={14}>
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          选择中文词条后查询。
        </Text>
      </GlassPanel>
    )
  }
  return (
    <VStack spacing={12} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
      {props.result.sections.map((section, index) => (
        <GlassPanel key={`${index}-${section.title}`} padding={14} spacing={8}>
          <Text
            font="headline"
            lineLimit={2}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {section.title}
          </Text>
          <SectionLines title={section.title} lines={section.lines} onQuery={props.onQuery} />
        </GlassPanel>
      ))}
      <GlassPanel padding={12}>
        <Text font="headline" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.result.title}
        </Text>
        <Text
          font="caption"
          foregroundStyle="systemBlue"
          lineLimit={2}
          truncationMode="middle"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
          onTapGesture={() => void openUrl(props.result?.url ?? "")}
          selectionDisabled={false}
        >
          {displayUrl(props.result.url)}
        </Text>
      </GlassPanel>
    </VStack>
  )
}

function ZDictTranslationView() {
  const sourceText = TranslationUIProvider.inputText ?? ""
  const tokens = useMemo(() => tokenizeWords(sourceText), [sourceText])
  const initialSelectedIds = useMemo(() => {
    if (tokens.length > 1) return []
    const trimmed = normalizeQuery(sourceText)
    if (isChineseQuery(trimmed) && Array.from(trimmed).length <= 12) {
      const exactToken = tokens.find((item) => item.text === trimmed)
      if (exactToken) return [exactToken.id]
      return tokens.filter((item) => isChineseQuery(item.text)).map((item) => item.id)
    }
    const firstChineseToken = tokens.find((token) => isChineseQuery(token.text))
    return firstChineseToken ? [firstChineseToken.id] : []
  }, [sourceText, tokens])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialSelectedIds)
  const [directQueryText, setDirectQueryText] = useState("")
  const selectedText = selectedTokenText(tokens, selectedIds)
  const queryText = normalizeQuery(selectedText || directQueryText)
  const canQuery = isChineseQuery(queryText)
  const [result, setResult] = useState<ZdicResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState("")
  const requestIdRef = useRef(0)

  async function runLookup(nextQuery = queryText) {
    const normalized = normalizeQuery(nextQuery)
    if (!isChineseQuery(normalized)) {
      setResult(null)
      setErrorText(normalized ? "仅支持查询中文汉字或词语" : "")
      return
    }
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    setLoading(true)
    setErrorText("")
    try {
      TranslationUIProvider.expandSheet?.()
      const nextResult = await lookupZdic(normalized)
      if (requestId !== requestIdRef.current) return
      setResult(nextResult)
      hapticSuccess()
    } catch (error: any) {
      if (requestId !== requestIdRef.current) return
      setResult(null)
      setErrorText(String(error?.message ?? error ?? "查询失败"))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  function toggleToken(token: DictToken) {
    setDirectQueryText("")
    setSelectedIds((ids) => ids.includes(token.id)
      ? ids.filter((id) => id !== token.id)
      : [...ids, token.id])
  }

  function queryLinkedText(text: string) {
    const normalized = normalizeQuery(text)
    if (!isChineseQuery(normalized)) return
    setSelectedIds([])
    setDirectQueryText(normalized)
    hapticLight()
    void runLookup(normalized)
  }

  useEffect(() => {
    if (canQuery && !result && !loading) {
      void runLookup(queryText)
    }
  }, [])

  return (
    <VStack
      spacing={14}
      padding={16}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
    >
      {sourceText.trim() && tokens.length > 1 ? (
        <TokenSelectionPanel
          tokens={tokens}
          selectedIds={selectedIds}
          selectedText={selectedText}
          onToggle={toggleToken}
        />
      ) : !sourceText.trim() ? (
        <GlassPanel padding={14}>
          <Text foregroundStyle="secondaryLabel">没有收到系统传入的文本。</Text>
        </GlassPanel>
      ) : null}

      <GlassPanel padding={10}>
        <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          <Text
            font="subheadline"
            foregroundStyle={canQuery ? "label" : "secondaryLabel"}
            lineLimit={1}
            truncationMode="tail"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {queryText || "请选择要查询的中文"}
          </Text>
          <Button
            title="复制"
            systemImage="doc.on.doc"
            disabled={!queryText}
            action={() => {
              hapticLight()
              void copyText(queryText)
            }}
          />
          <Button
            title="清空"
            systemImage="arrow.counterclockwise"
            disabled={!selectedIds.length && !directQueryText}
            action={() => {
              hapticLight()
              setDirectQueryText("")
              setSelectedIds([])
              setResult(null)
              setErrorText("")
            }}
          />
          <Button
            title="查询"
            systemImage="magnifyingglass"
            disabled={!canQuery || loading}
            action={() => {
              hapticLight()
              void runLookup(queryText)
            }}
          />
        </HStack>
      </GlassPanel>

      {!canQuery && queryText ? (
        <GlassPanel padding={10}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            当前选择包含非中文字符，汉典查询已禁用。
          </Text>
        </GlassPanel>
      ) : null}

      <ScrollView axes="vertical" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <ResultView result={result} loading={loading} errorText={errorText} onQuery={queryLinkedText} />
      </ScrollView>
    </VStack>
  )
}

TranslationUIProvider.present(<ZDictTranslationView />)
