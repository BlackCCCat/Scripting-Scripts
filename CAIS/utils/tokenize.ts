export type CaisToken = {
  id: string
  text: string
  index: number
}

function languageHint(text: string): NaturalLanguage.Language | undefined {
  if (/[\u3400-\u9fff]/.test(text)) {
    return /[繫臺後萬與專業開關]/.test(text) ? "zh-Hant" : "zh-Hans"
  }
  try {
    const detected = NaturalLanguage.dominantLanguage(text)
    if (detected) return detected
  } catch {
  }
  return undefined
}

function fallbackTokenize(text: string): CaisToken[] {
  const result: CaisToken[] = []
  pushTextParts(result, text, 0)
  return result
}

function pushTextParts(result: CaisToken[], text: string, location: number) {
  const matcher = /\S+/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text))) {
    const part = match[0]
    const start = location + match.index
    pushSegmentedPart(result, part, start)
  }
}

function pushRawToken(result: CaisToken[], text: string, location: number) {
  if (!text) return
  result.push({
    id: `${result.length}-${location}-${text.length}`,
    text,
    index: result.length,
  })
}

function pushSegmentedPart(result: CaisToken[], part: string, location: number) {
  if (!/[\u3400-\u9fff]/.test(part) || Array.from(part).length <= 4) {
    pushMixedRun(result, part, location)
    return
  }
  const Segmenter = (globalThis as any).Intl?.Segmenter
  if (Segmenter) {
    try {
      const segmenter = new Segmenter("zh-Hans", { granularity: "word" })
      const pieces = Array.from(segmenter.segment(part) as Iterable<any>)
        .map((item: any) => String(item?.segment ?? ""))
        .filter(Boolean)
      if (pieces.length > 1) {
        let offset = 0
        for (const piece of pieces) {
          pushMixedRun(result, piece, location + offset)
          offset += piece.length
        }
        return
      }
    } catch {
    }
  }
  pushMixedRun(result, part, location)
}

function pushMixedRun(result: CaisToken[], text: string, location: number) {
  let buffer = ""
  let bufferKind: "cjk" | "alnum" | null = null
  let bufferOffset = 0
  let offset = 0
  const flush = () => {
    if (!buffer || !bufferKind) return
    if (bufferKind === "cjk" && Array.from(buffer).length > 4) {
      pushCjkChunks(result, buffer, location + bufferOffset)
    } else {
      pushRawToken(result, buffer, location + bufferOffset)
    }
    buffer = ""
    bufferKind = null
  }
  for (const part of splitGraphemes(text)) {
    if (/^\s+$/.test(part)) {
      flush()
      offset += part.length
      continue
    }
    const kind = /^[\u3400-\u9fff]+$/.test(part)
      ? "cjk"
      : /^[A-Za-z0-9]+$/.test(part)
        ? "alnum"
        : null
    if (!kind) {
      flush()
      pushRawToken(result, part, location + offset)
    } else if (bufferKind === kind) {
      buffer += part
    } else {
      flush()
      buffer = part
      bufferKind = kind
      bufferOffset = offset
    }
    offset += part.length
  }
  flush()
}

function splitGraphemes(text: string): string[] {
  const Segmenter = (globalThis as any).Intl?.Segmenter
  if (Segmenter) {
    try {
      const segmenter = new Segmenter(undefined, { granularity: "grapheme" })
      return Array.from(segmenter.segment(text) as Iterable<any>)
        .map((item: any) => String(item?.segment ?? ""))
        .filter(Boolean)
    } catch {
    }
  }
  return Array.from(text)
}

function pushCjkChunks(result: CaisToken[], text: string, location: number) {
  let buffer = ""
  let bufferOffset = 0
  let offset = 0
  const flush = () => {
    if (buffer) {
      pushRawToken(result, buffer, location + bufferOffset)
      buffer = ""
    }
  }
  for (const char of Array.from(text)) {
    if (!buffer) bufferOffset = offset
    buffer += char
    if (Array.from(buffer).length >= 2) flush()
    offset += char.length
  }
  flush()
}

export function tokenizeWords(text: string): CaisToken[] {
  const source = String(text ?? "")
  if (!source.trim()) return []
  try {
    const language = languageHint(source)
    const tokens = NaturalLanguage.tokenize(source, {
      unit: "word",
      ...(language ? { language } : {}),
    })
    const result: CaisToken[] = []
    let cursor = 0
    for (const token of tokens) {
      const start = token.range.location
      const end = start + token.range.length
      if (start > cursor) {
        const gap = source.substring(cursor, start)
        pushTextParts(result, gap, cursor)
      }
      pushTextParts(result, token.text, start)
      cursor = Math.max(cursor, end)
    }
    if (cursor < source.length) {
      pushTextParts(result, source.substring(cursor), cursor)
    }
    return result
  } catch {
    return fallbackTokenize(source)
  }
}

export function selectedTokenText(tokens: CaisToken[], selectedIds: string[]): string {
  const byId = new Map(tokens.map((token) => [token.id, token.text]))
  return selectedIds.map((id) => byId.get(id) ?? "").join("")
}
