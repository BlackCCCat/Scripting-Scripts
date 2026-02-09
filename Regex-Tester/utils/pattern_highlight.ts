import type { StyledText } from "scripting"
import { validateRegexPattern } from "./regex"

type Segment = {
  text: string
  color?: string
}

const COLORS = {
  flags: "#16A34A",
  group: "#9333EA",
  quantifier: "#DC2626",
  escape: "#D97706",
  characterClass: "#0284C7",
  alternation: "#0D9488",
  anchor: "#DB2777",
}

function pushMerged(list: Segment[], next: Segment) {
  if (!next.text) return
  const last = list[list.length - 1]
  if (last && last.color === next.color) {
    last.text += next.text
    return
  }
  list.push(next)
}

function readCharacterClass(source: string, start: number): { text: string; end: number } {
  let i = start + 1
  while (i < source.length) {
    const c = source[i]
    if (c === "\\") {
      i += 2
      continue
    }
    if (c === "]") {
      return { text: source.slice(start, i + 1), end: i + 1 }
    }
    i += 1
  }
  return { text: source.slice(start), end: source.length }
}

function readBraces(source: string, start: number): { text: string; end: number; ok: boolean } {
  let i = start + 1
  while (i < source.length && source[i] !== "}") i += 1
  if (i < source.length && source[i] === "}") {
    return { text: source.slice(start, i + 1), end: i + 1, ok: true }
  }
  return { text: "{", end: start + 1, ok: false }
}

function tokenizePattern(pattern: string): Segment[] {
  const out: Segment[] = []
  let i = 0

  const leadingFlags = pattern.match(/^\(\?([a-zA-Z]+)\)/)
  if (leadingFlags) {
    pushMerged(out, { text: leadingFlags[0], color: COLORS.flags })
    i = leadingFlags[0].length
  }

  while (i < pattern.length) {
    const ch = pattern[i]

    if (ch === "\\") {
      const text = i + 1 < pattern.length ? pattern.slice(i, i + 2) : ch
      pushMerged(out, { text, color: COLORS.escape })
      i += text.length
      continue
    }

    if (ch === "[") {
      const cls = readCharacterClass(pattern, i)
      pushMerged(out, { text: cls.text, color: COLORS.characterClass })
      i = cls.end
      continue
    }

    if (ch === "(" || ch === ")") {
      pushMerged(out, { text: ch, color: COLORS.group })
      i += 1
      continue
    }

    if (ch === "*" || ch === "+" || ch === "?") {
      pushMerged(out, { text: ch, color: COLORS.quantifier })
      i += 1
      continue
    }

    if (ch === "{") {
      const braced = readBraces(pattern, i)
      if (braced.ok) {
        pushMerged(out, { text: braced.text, color: COLORS.quantifier })
        i = braced.end
        continue
      }
    }

    if (ch === "|") {
      pushMerged(out, { text: ch, color: COLORS.alternation })
      i += 1
      continue
    }

    if (ch === "^" || ch === "$") {
      pushMerged(out, { text: ch, color: COLORS.anchor })
      i += 1
      continue
    }

    pushMerged(out, { text: ch })
    i += 1
  }

  return out
}

export function buildPatternStyledText(pattern: string): StyledText {
  const segments = tokenizePattern(pattern)
  const content = segments.map((seg) => {
    if (seg.color) return { content: seg.text, foregroundColor: seg.color }
    return { content: seg.text }
  })
  return {
    monospaced: true,
    content,
  }
}

export function buildPatternPreviewStyledText(pattern: string): StyledText {
  const checked = validateRegexPattern(pattern)
  if (!checked.ok) {
    return {
      monospaced: true,
      content: [{ content: pattern, foregroundColor: "#DC2626" }],
    }
  }
  return buildPatternStyledText(pattern)
}
