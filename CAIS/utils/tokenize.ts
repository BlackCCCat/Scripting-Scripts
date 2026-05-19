export type CaisToken = {
  id: string
  text: string
  index: number
}

function languageHint(text: string): NaturalLanguage.Language | undefined {
  try {
    const detected = NaturalLanguage.dominantLanguage(text)
    if (detected) return detected
  } catch {
  }
  return /[\u3400-\u9fff]/.test(text) ? "zh-Hans" : undefined
}

function fallbackTokenize(text: string): CaisToken[] {
  return text
    .match(/\S+/g)
    ?.map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({ id: `fallback-${index}-${part}`, text: part, index })) ?? []
}

function pushToken(result: CaisToken[], text: string, location: number, length: number) {
  if (!text.trim()) return
  result.push({
    id: `${result.length}-${location}-${length}`,
    text,
    index: result.length,
  })
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
        pushToken(result, gap, cursor, start - cursor)
      }
      pushToken(result, token.text, start, token.range.length)
      cursor = Math.max(cursor, end)
    }
    if (cursor < source.length) {
      pushToken(result, source.substring(cursor), cursor, source.length - cursor)
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
