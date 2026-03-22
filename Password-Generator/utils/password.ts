import type { Color, StyledText } from "scripting"

export type PasswordOptions = {
  length: number
  includeLetters: boolean
  includeNumbers: boolean
  includeSymbols: boolean
  symbols: string
}

type Pool = {
  key: "letters" | "numbers" | "symbols"
  chars: string
}

export type PasswordStrength = {
  score: number
  color: Color
  description: string
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const NUMBERS = "0123456789"
const CHAR_COLORS: Record<"letters" | "numbers" | "symbols", Color> = {
  letters: "#2563EB",
  numbers: "#16A34A",
  symbols: "#EA580C",
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function randomIndex(max: number) {
  return Math.floor(Math.random() * max)
}

function shuffle<T>(items: T[]) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1)
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
  }
  return next
}

function getPools(options: PasswordOptions): Pool[] {
  const pools: Pool[] = []
  if (options.includeLetters) pools.push({ key: "letters", chars: LETTERS })
  if (options.includeNumbers) pools.push({ key: "numbers", chars: NUMBERS })
  if (options.includeSymbols && options.symbols) pools.push({ key: "symbols", chars: options.symbols })
  return pools
}

function pick(chars: string) {
  return chars[randomIndex(chars.length)] ?? chars[0] ?? ""
}

function charKind(char: string): keyof typeof CHAR_COLORS {
  if (LETTERS.includes(char)) return "letters"
  if (NUMBERS.includes(char)) return "numbers"
  return "symbols"
}

function normalizedEntropy(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return 0
  const active = values.filter((value) => value > 0)
  if (active.length <= 1) return 0
  let entropy = 0
  for (const value of active) {
    const p = value / total
    entropy -= p * Math.log2(p)
  }
  return entropy / Math.log2(active.length)
}

export function describeEnabledTypes(options: PasswordOptions) {
  const items: string[] = []
  if (options.includeLetters) items.push("字母")
  if (options.includeNumbers) items.push("数字")
  if (options.includeSymbols) items.push("符号")
  return items.join(" / ")
}

export function summarizePasswordOptions(options: PasswordOptions) {
  return `${options.length} 位 · ${describeEnabledTypes(options)}`
}

export function generatePassword(options: PasswordOptions): string {
  const pools = getPools(options)
  if (!pools.length) throw new Error("至少需要开启一种字符类型")

  const length = clamp(Math.round(options.length), pools.length, 128)
  const allChars = pools.map((pool) => pool.chars).join("")
  const seed = pools.map((pool) => pick(pool.chars))
  const restLength = Math.max(0, length - seed.length)
  const rest = Array.from({ length: restLength }, () => pick(allChars))
  return shuffle([...seed, ...rest]).join("")
}

export function buildPasswordStyledText(password: string): StyledText {
  return {
    monospaced: true,
    content: Array.from(password).map((char) => ({
      content: char,
      foregroundColor: CHAR_COLORS[charKind(char)],
    })),
  }
}

export function evaluatePasswordStrength(password: string, options: PasswordOptions): PasswordStrength {
  const pools = getPools(options)
  const typeCount = pools.length
  const poolSize = pools.reduce((sum, pool) => sum + pool.chars.length, 0)
  const entropyBits = password.length * Math.log2(Math.max(poolSize, 1))
  const chars = Array.from(password)
  const uniqueRatio = password.length ? new Set(chars).size / password.length : 0
  const counts = new Map<string, number>()
  const kindCounts = {
    letters: 0,
    numbers: 0,
    symbols: 0,
  }
  let kindSwitches = 0
  let adjacentRepeatPenalty = 0
  let previousKind: keyof typeof CHAR_COLORS | null = null
  let previousChar = ""
  for (const char of chars) counts.set(char, (counts.get(char) ?? 0) + 1)
  for (const char of chars) {
    const kind = charKind(char)
    kindCounts[kind] += 1
    if (previousKind && previousKind !== kind) kindSwitches += 1
    if (previousChar && previousChar === char) adjacentRepeatPenalty += 1
    previousKind = kind
    previousChar = char
  }
  const maxRepeat = Math.max(0, ...Array.from(counts.values()))
  const switchRatio = password.length > 1 ? kindSwitches / (password.length - 1) : 0
  const symbolRatio = password.length ? kindCounts.symbols / password.length : 0
  const mixEntropy = normalizedEntropy([
    kindCounts.letters,
    kindCounts.numbers,
    kindCounts.symbols,
  ])

  const lengthScore = clamp((password.length - 6) * 3.2, 0, 42)
  const entropyScore = clamp((entropyBits - 28) * 0.55, 0, 30)
  const uniquenessScore = clamp((uniqueRatio - 0.45) * 28, 0, 12)
  const varietyBonus = typeCount === 3 ? 16 : typeCount === 2 ? 8 : 0
  const mixScore = clamp(mixEntropy * 12, 0, 12)
  const switchScore = clamp(switchRatio * 10, 0, 10)
  const symbolBonus = options.includeSymbols
    ? clamp(symbolRatio * 6, 0, 6)
    : 0
  const repeatPenalty = Math.max(0, maxRepeat - Math.ceil(password.length / 4)) * 4
  const sequencePenalty = adjacentRepeatPenalty * 2
  const rawScore =
    lengthScore +
    entropyScore +
    uniquenessScore +
    varietyBonus +
    mixScore +
    switchScore +
    symbolBonus -
    repeatPenalty -
    sequencePenalty

  const cap = typeCount === 1
    ? (password.length >= 20 ? 62 : 52)
    : typeCount === 2
      ? (password.length >= 18 ? 80 : 72)
      : 100

  const score = clamp(Math.round(rawScore), 0, cap)

  if (score >= 85) {
    return {
      score,
      color: "systemGreen",
      description: "长度、构成分布和字符切换都很理想，整体强度处于高位。",
    }
  }
  if (score >= 65) {
    return {
      score,
      color: "systemBlue",
      description: "长度不错，字符构成较均衡，适合大多数重要账号。",
    }
  }
  if (score >= 40) {
    return {
      score,
      color: "systemOrange",
      description: "建议继续增加长度，并减少重复或提升字符混合度。",
    }
  }
  return {
    score,
    color: "systemRed",
    description: "当前长度、构成或重复情况偏保守，建议继续拉长并提高混合度。",
  }
}
