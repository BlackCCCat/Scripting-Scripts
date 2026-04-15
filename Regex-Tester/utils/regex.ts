export type MatchMode = "full" | "search"

export type RegexLinePart = {
  text: string
  matched: boolean
}

export type RegexOutputLine = {
  text: string
  matched: boolean
  parts: RegexLinePart[]
}

export type RegexMatchResult = {
  output: string
  lines: RegexOutputLine[]
  matchedCount: number
  ignoredFlags: string[]
}

export type RegexReplaceResult = {
  output: string
  ignoredFlags: string[]
}

type CompiledPattern = {
  regex: RegExp
  source: string
  flags: string
  ignoredFlags: string[]
}

type RewrittenInlineFlags = {
  source: string
  ignoredFlags: string[]
}

function parsePythonLeadingFlags(pattern: string): {
  source: string
  jsFlags: string
  ignoredFlags: string[]
} {
  const m = pattern.match(/^\(\?([a-zA-Z]+)\)/)
  if (!m) return { source: pattern, jsFlags: "", ignoredFlags: [] }

  const js = new Set<string>()
  const ignored: string[] = []
  const flags = String(m[1] ?? "").toLowerCase()
  for (const ch of flags) {
    if (ch === "i" || ch === "m" || ch === "s" || ch === "u") {
      js.add(ch)
      continue
    }
    ignored.push(ch)
  }

  return {
    source: pattern.slice(m[0].length),
    jsFlags: Array.from(js).join(""),
    ignoredFlags: ignored,
  }
}

function buildCaseInsensitiveLiteral(ch: string): string {
  if (!/[A-Za-z]/.test(ch)) return ch
  const lower = ch.toLowerCase()
  const upper = ch.toUpperCase()
  if (lower === upper) return ch
  return `[${lower}${upper}]`
}

function detectGroupPrefix(source: string, index: number): string {
  const prefixes = ["(?<=", "(?<!", "(?:", "(?=", "(?!", "("]
  for (const prefix of prefixes) {
    if (source.startsWith(prefix, index)) return prefix
  }
  return "("
}

function parseInlineFlags(flags: string): { enableI: boolean | null; ignoredFlags: string[] } {
  let enableI: boolean | null = null
  const ignoredFlags: string[] = []
  let disabled = false
  for (const ch of flags.toLowerCase()) {
    if (ch === "-") {
      disabled = true
      continue
    }
    if (ch === "i") {
      enableI = !disabled
      continue
    }
    ignoredFlags.push(ch)
  }
  return { enableI, ignoredFlags }
}

function rewriteInlineFlags(source: string): RewrittenInlineFlags {
  function walk(index: number, inheritedIgnoreCase: boolean, endChar?: string): {
    text: string
    index: number
    ignoredFlags: string[]
  } {
    let out = ""
    let i = index
    let localIgnoreCase = inheritedIgnoreCase
    const ignoredFlags: string[] = []

    while (i < source.length) {
      const ch = source[i]
      if (endChar && ch === endChar) break

      const inlineFlags = source.slice(i).match(/^\(\?([a-zA-Z-]+)\)/)
      if (inlineFlags) {
        const parsedFlags = parseInlineFlags(String(inlineFlags[1] ?? ""))
        if (parsedFlags.enableI !== null) localIgnoreCase = parsedFlags.enableI
        ignoredFlags.push(...parsedFlags.ignoredFlags)
        i += inlineFlags[0].length
        continue
      }

      if (ch === "\\") {
        const token = i + 1 < source.length ? source.slice(i, i + 2) : ch
        out += token
        i += token.length
        continue
      }

      if (ch === "[") {
        let j = i + 1
        while (j < source.length) {
          if (source[j] === "\\") {
            j += 2
            continue
          }
          if (source[j] === "]") {
            j += 1
            break
          }
          j += 1
        }
        out += source.slice(i, j)
        i = j
        continue
      }

      if (ch === "(") {
        const prefix = detectGroupPrefix(source, i)
        const inner = walk(i + prefix.length, localIgnoreCase, ")")
        out += `${prefix}${inner.text}`
        ignoredFlags.push(...inner.ignoredFlags)
        i = inner.index
        if (source[i] === ")") {
          out += ")"
          i += 1
        }
        continue
      }

      if (localIgnoreCase) {
        out += buildCaseInsensitiveLiteral(ch)
      } else {
        out += ch
      }
      i += 1
    }

    return { text: out, index: i, ignoredFlags }
  }

  const walked = walk(0, false)
  return {
    source: walked.text,
    ignoredFlags: walked.ignoredFlags,
  }
}

function compileRegexPattern(pattern: string, mode: MatchMode): CompiledPattern {
  const parsed = parsePythonLeadingFlags(pattern)
  const rewritten = rewriteInlineFlags(parsed.source)
  const source = mode === "full" ? `^(?:${rewritten.source})$` : rewritten.source
  const regex = new RegExp(source, parsed.jsFlags)
  return {
    regex,
    source,
    flags: parsed.jsFlags,
    ignoredFlags: [...parsed.ignoredFlags, ...rewritten.ignoredFlags],
  }
}

function ensureFlag(flags: string, flag: string): string {
  if (flags.includes(flag)) return flags
  return `${flags}${flag}`
}

function sortAndUniqueFlags(flags: string): string {
  const keepOrder = ["g", "i", "m", "s", "u", "y"]
  const set = new Set(flags.split(""))
  return keepOrder.filter((f) => set.has(f)).join("")
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (!ranges.length) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Array<{ start: number; end: number }> = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]
    const last = out[out.length - 1]
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

function buildPartsFromRanges(line: string, ranges: Array<{ start: number; end: number }>): RegexLinePart[] {
  if (!ranges.length) return [{ text: line, matched: false }]
  const merged = mergeRanges(ranges)
  const parts: RegexLinePart[] = []
  let cursor = 0
  for (const r of merged) {
    if (r.start > cursor) {
      parts.push({ text: line.slice(cursor, r.start), matched: false })
    }
    parts.push({ text: line.slice(r.start, r.end), matched: true })
    cursor = r.end
  }
  if (cursor < line.length) {
    parts.push({ text: line.slice(cursor), matched: false })
  }
  return parts
}

function buildSearchParts(line: string, source: string, flags: string): RegexLinePart[] {
  if (!line) return [{ text: "", matched: false }]

  const testRegex = new RegExp(source, flags)
  if (!testRegex.test(line)) return [{ text: line, matched: false }]

  const globalFlags = sortAndUniqueFlags(ensureFlag(flags, "g"))
  const collectRegex = new RegExp(source, globalFlags)
  const ranges: Array<{ start: number; end: number }> = []

  while (true) {
    const m = collectRegex.exec(line)
    if (!m) break

    if (m[0].length > 0) {
      ranges.push({ start: m.index, end: m.index + m[0].length })
    } else {
      // Pattern can match empty string; fallback to captured groups for visible highlights.
      const captures = m.slice(1).filter((v) => typeof v === "string" && v.length > 0) as string[]
      for (const cap of captures) {
        let from = 0
        while (from < line.length) {
          const idx = line.indexOf(cap, from)
          if (idx < 0) break
          ranges.push({ start: idx, end: idx + cap.length })
          from = idx + cap.length
        }
      }
      // Zero-length match usually indicates lookahead-style assertions; one pass is enough.
      break
    }
  }

  if (!ranges.length) {
    return [{ text: line, matched: true }]
  }
  return buildPartsFromRanges(line, ranges)
}

export function validateRegexPattern(pattern: string): {
  ok: boolean
  ignoredFlags: string[]
  error?: string
} {
  try {
    const compiled = compileRegexPattern(pattern, "search")
    return { ok: true, ignoredFlags: compiled.ignoredFlags }
  } catch (e: any) {
    return {
      ok: false,
      ignoredFlags: [],
      error: String(e?.message ?? e),
    }
  }
}

export function runLineMatch(pattern: string, text: string, mode: MatchMode = "full"): RegexMatchResult {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
  const outputLines: RegexOutputLine[] = []
  const { regex, source, flags, ignoredFlags } = compileRegexPattern(pattern, mode)

  let matchedCount = 0
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "")
    const isMatched = regex.test(line)
    if (isMatched) {
      matchedCount += 1
      if (mode === "search") {
        const parts = buildSearchParts(line, source, flags)
        outputLines.push({ text: line, matched: true, parts })
      } else {
        outputLines.push({ text: line, matched: true, parts: [{ text: line, matched: true }] })
      }
    } else {
      outputLines.push({ text: line, matched: false, parts: [{ text: line, matched: false }] })
    }
  }

  return {
    output: outputLines.map((v) => v.text).join("\n"),
    lines: outputLines,
    matchedCount,
    ignoredFlags,
  }
}

export function runLineReplace(
  pattern: string,
  text: string,
  replacement: string,
  mode: MatchMode = "search",
): RegexReplaceResult {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
  const parsed = parsePythonLeadingFlags(pattern)
  const rewritten = rewriteInlineFlags(parsed.source)
  const baseSource = mode === "full" ? `^(?:${rewritten.source})$` : rewritten.source
  const replaceFlags = sortAndUniqueFlags(ensureFlag(parsed.jsFlags, "g"))
  const regex = new RegExp(baseSource, replaceFlags)
  const output = lines.map((line) => line.replace(regex, replacement)).join("\n")
  return {
    output,
    ignoredFlags: [...parsed.ignoredFlags, ...rewritten.ignoredFlags],
  }
}
