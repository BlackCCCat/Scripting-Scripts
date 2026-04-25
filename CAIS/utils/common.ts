export function makeId(prefix = "clip"): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim()
}

export function isLikelyURL(value: string): boolean {
  const text = value.trim()
  return /^https?:\/\//i.test(text) || /^mailto:/i.test(text)
}

export function clipTitle(kind: string, content: string): string {
  if (kind === "image") return "图片"
  const firstLine = content.split("\n").map((line) => line.trim()).find(Boolean) ?? ""
  if (!firstLine) return kind === "url" ? "链接" : "文本"
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine
}

export function hashString(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function formatDateTime(timestamp?: number | null): string {
  if (!timestamp) return "暂无"
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return String(timestamp)
  }
}

export function summarizeContent(content: string, limit = 140): string {
  const fixed = content.replace(/\s+/g, " ").trim()
  if (fixed.length <= limit) return fixed
  return `${fixed.slice(0, limit)}...`
}

export function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}
