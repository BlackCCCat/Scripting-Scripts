export type FlowNode =
  | {
      kind: "token"
      token: string
      modifier?: string
    }
  | {
      kind: "container"
      label: string
      branches: FlowNode[][]
      modifier?: string
    }

function isQuantifierAt(source: string, index: number): { token?: string; end: number } {
  const ch = source[index]
  if (ch === "*" || ch === "+" || ch === "?") return { token: ch, end: index + 1 }
  if (ch === "{") {
    let i = index + 1
    while (i < source.length && source[i] !== "}") i += 1
    if (i < source.length) return { token: source.slice(index, i + 1), end: i + 1 }
  }
  return { end: index }
}

function splitTopLevelAlternatives(source: string): string[] {
  const out: string[] = []
  let depth = 0
  let inClass = false
  let start = 0
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "[") {
      inClass = true
      i += 1
      continue
    }
    if (ch === "]") {
      inClass = false
      i += 1
      continue
    }
    if (inClass) {
      i += 1
      continue
    }
    if (ch === "(") {
      depth += 1
      i += 1
      continue
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1)
      i += 1
      continue
    }
    if (ch === "|" && depth === 0) {
      out.push(source.slice(start, i))
      start = i + 1
    }
    i += 1
  }
  out.push(source.slice(start))
  return out.map((item) => item.trim()).filter(Boolean)
}

function readCharacterClass(source: string, start: number): { token: string; end: number } {
  let i = start + 1
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2
      continue
    }
    if (source[i] === "]") return { token: source.slice(start, i + 1), end: i + 1 }
    i += 1
  }
  return { token: source.slice(start), end: source.length }
}

function readEscapeToken(source: string, start: number): { token: string; end: number } {
  if (start + 1 >= source.length) return { token: "\\", end: start + 1 }
  const next = source[start + 1]
  if ((next === "p" || next === "P") && source[start + 2] === "{") {
    let i = start + 3
    while (i < source.length && source[i] !== "}") i += 1
    if (i < source.length) return { token: source.slice(start, i + 1), end: i + 1 }
  }
  if (next === "x" && /^[0-9a-fA-F]{2}/.test(source.slice(start + 2, start + 4))) {
    return { token: source.slice(start, start + 4), end: start + 4 }
  }
  if (next === "u") {
    if (source[start + 2] === "{") {
      let i = start + 3
      while (i < source.length && source[i] !== "}") i += 1
      if (i < source.length) return { token: source.slice(start, i + 1), end: i + 1 }
    }
    if (/^[0-9a-fA-F]{4}/.test(source.slice(start + 2, start + 6))) {
      return { token: source.slice(start, start + 6), end: start + 6 }
    }
  }
  return { token: source.slice(start, Math.min(start + 2, source.length)), end: Math.min(start + 2, source.length) }
}

function readStandaloneInlineFlag(source: string, start: number): { token: string; end: number } | null {
  if (!source.startsWith("(?", start)) return null
  let i = start + 2
  while (i < source.length && /[a-zA-Z-]/.test(source[i])) i += 1
  if (i > start + 2 && source[i] === ")") {
    return { token: source.slice(start, i + 1), end: i + 1 }
  }
  return null
}

function readGroupToken(source: string, start: number): { token: string; content: string; end: number } {
  let depth = 1
  let i = start + 1
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2
      continue
    }
    if (source[i] === "[") {
      const cls = readCharacterClass(source, i)
      i = cls.end
      continue
    }
    if (source[i] === "(") depth += 1
    if (source[i] === ")") {
      depth -= 1
      if (depth === 0) {
        return {
          token: source.slice(start, i + 1),
          content: source.slice(start + 1, i),
          end: i + 1,
        }
      }
    }
    i += 1
  }
  return {
    token: source.slice(start),
    content: source.slice(start + 1),
    end: source.length,
  }
}

function isWrappedAsSingleGroup(source: string): boolean {
  const trimmed = source.trim()
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return false
  let depth = 0
  let inClass = false
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (ch === "\\") {
      i += 1
      continue
    }
    if (ch === "[") {
      inClass = true
      continue
    }
    if (ch === "]") {
      inClass = false
      continue
    }
    if (inClass) continue
    if (ch === "(") depth += 1
    if (ch === ")") {
      depth -= 1
      if (depth === 0 && i < trimmed.length - 1) return false
    }
  }
  return depth === 0
}

function unwrapSingleWrappedGroup(source: string): string {
  let current = source.trim()
  while (isWrappedAsSingleGroup(current)) {
    current = current.slice(1, -1).trim()
  }
  return current
}

type GroupKind =
  | "capturingGroup"
  | "namedGroup"
  | "nonCapturingGroup"
  | "scopedFlagGroup"
  | "positiveLookahead"
  | "negativeLookahead"
  | "positiveLookbehind"
  | "negativeLookbehind"
  | "atomicGroup"

function classifyGroup(content: string): { kind: GroupKind; body: string } {
  if (content.startsWith("?:")) return { kind: "nonCapturingGroup", body: content.slice(2) }
  if (content.startsWith("?=")) return { kind: "positiveLookahead", body: content.slice(2) }
  if (content.startsWith("?!")) return { kind: "negativeLookahead", body: content.slice(2) }
  if (content.startsWith("?<=")) return { kind: "positiveLookbehind", body: content.slice(3) }
  if (content.startsWith("?<!")) return { kind: "negativeLookbehind", body: content.slice(3) }
  if (content.startsWith("?>")) return { kind: "atomicGroup", body: content.slice(2) }

  const pythonNamed = content.match(/^\?P<[^>]+>/)
  if (pythonNamed) return { kind: "namedGroup", body: content.slice(pythonNamed[0].length) }

  const jsNamed = content.match(/^\?<[^=!][^>]*>/)
  if (jsNamed) return { kind: "namedGroup", body: content.slice(jsNamed[0].length) }

  const scopedFlags = content.match(/^\?[a-zA-Z-]+:/)
  if (scopedFlags) return { kind: "scopedFlagGroup", body: content.slice(scopedFlags[0].length) }

  return { kind: "capturingGroup", body: content }
}

function groupLabel(kind: GroupKind): string {
  switch (kind) {
    case "capturingGroup": return "捕获组"
    case "namedGroup": return "命名组"
    case "nonCapturingGroup": return "非捕获组"
    case "scopedFlagGroup": return "作用域标志组"
    case "positiveLookahead": return "正向先行断言"
    case "negativeLookahead": return "负向先行断言"
    case "positiveLookbehind": return "正向后行断言"
    case "negativeLookbehind": return "负向后行断言"
    case "atomicGroup": return "原子组"
  }
}

function readLiteralAtom(source: string, start: number): { token: string; end: number; modifier?: string } {
  let j = start
  while (j < source.length) {
    const ch = source[j]
    if (ch === "\\" || ch === "[" || ch === "(" || ch === "." || ch === "^" || ch === "$" || ch === "|" || ch === ")") break
    const quantifier = isQuantifierAt(source, j + 1)
    if (quantifier.token) {
      if (j === start) {
        return { token: source[j], end: quantifier.end, modifier: quantifier.token }
      }
      break
    }
    j += 1
  }
  if (j === start) j += 1
  return { token: source.slice(start, j), end: j }
}

function parseSequence(source: string): FlowNode[] {
  const out: FlowNode[] = []
  let i = 0

  while (i < source.length) {
    const inlineFlag = readStandaloneInlineFlag(source, i)
    if (inlineFlag) {
      out.push({ kind: "token", token: inlineFlag.token })
      i = inlineFlag.end
      continue
    }

    const ch = source[i]
    if (ch === "|" || ch === ")") {
      i += 1
      continue
    }

    if (ch === "\\") {
      const escape = readEscapeToken(source, i)
      const quantifier = isQuantifierAt(source, escape.end)
      out.push({
        kind: "token",
        token: escape.token,
        modifier: quantifier.token,
      })
      i = quantifier.token ? quantifier.end : escape.end
      continue
    }

    if (ch === "[") {
      const cls = readCharacterClass(source, i)
      const quantifier = isQuantifierAt(source, cls.end)
      out.push({
        kind: "token",
        token: cls.token,
        modifier: quantifier.token,
      })
      i = quantifier.token ? quantifier.end : cls.end
      continue
    }

    if (ch === "(") {
      const group = readGroupToken(source, i)
      const classified = classifyGroup(group.content)
      const quantifier = isQuantifierAt(source, group.end)
      const normalizedBody = unwrapSingleWrappedGroup(classified.body)
      const branches = splitTopLevelAlternatives(normalizedBody).map(parseSequence)
      out.push({
        kind: "container",
        label: groupLabel(classified.kind),
        branches: branches.length ? branches : [[]],
        modifier: quantifier.token,
      })
      i = quantifier.token ? quantifier.end : group.end
      continue
    }

    if (ch === ".") {
      const quantifier = isQuantifierAt(source, i + 1)
      out.push({ kind: "token", token: ".", modifier: quantifier.token })
      i = quantifier.token ? quantifier.end : i + 1
      continue
    }

    if (ch === "^" || ch === "$") {
      out.push({ kind: "token", token: ch })
      i += 1
      continue
    }

    const literal = readLiteralAtom(source, i)
    out.push({ kind: "token", token: literal.token, modifier: literal.modifier })
    i = literal.end
  }

  return out.filter((item) => item.kind === "container" || item.token)
}

export function buildFlowTree(pattern: string): FlowNode[] {
  return parseSequence(String(pattern ?? ""))
}
