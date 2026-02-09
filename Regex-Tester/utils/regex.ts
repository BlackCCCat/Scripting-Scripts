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

type CompiledPattern = {
  regex: RegExp
  source: string
  flags: string
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

function compileRegexPattern(pattern: string, mode: MatchMode): CompiledPattern {
  const parsed = parsePythonLeadingFlags(pattern)
  const source = mode === "full" ? `^(?:${parsed.source})$` : parsed.source
  const regex = new RegExp(source, parsed.jsFlags)
  return { regex, source, flags: parsed.jsFlags, ignoredFlags: parsed.ignoredFlags }
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
