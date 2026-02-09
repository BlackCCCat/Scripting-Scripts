export type RegexOutputLine = {
  text: string
  matched: boolean
}

export type RegexMatchResult = {
  output: string
  lines: RegexOutputLine[]
  matchedCount: number
  ignoredFlags: string[]
}

type CompiledPattern = {
  regex: RegExp
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

function compileRegexPattern(pattern: string): CompiledPattern {
  const parsed = parsePythonLeadingFlags(pattern)
  const source = `^(?:${parsed.source})$`
  const regex = new RegExp(source, parsed.jsFlags)
  return { regex, ignoredFlags: parsed.ignoredFlags }
}

export function validateRegexPattern(pattern: string): {
  ok: boolean
  ignoredFlags: string[]
  error?: string
} {
  try {
    const compiled = compileRegexPattern(pattern)
    return { ok: true, ignoredFlags: compiled.ignoredFlags }
  } catch (e: any) {
    return {
      ok: false,
      ignoredFlags: [],
      error: String(e?.message ?? e),
    }
  }
}

export function runLineMatch(pattern: string, text: string): RegexMatchResult {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n")
  const outputLines: RegexOutputLine[] = []
  const { regex, ignoredFlags } = compileRegexPattern(pattern)

  let matchedCount = 0
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "")
    const matchRes = regex.exec(line)
    if (matchRes) {
      matchedCount += 1
      outputLines.push({ text: matchRes[0], matched: true })
    } else {
      outputLines.push({ text: line, matched: false })
    }
  }

  return {
    output: outputLines.map((v) => v.text).join("\n"),
    lines: outputLines,
    matchedCount,
    ignoredFlags,
  }
}
