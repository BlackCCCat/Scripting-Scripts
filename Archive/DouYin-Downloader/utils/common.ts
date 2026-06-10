export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function sanitizeFileName(input: string): string {
  return (input || "douyin_video")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "douyin_video"
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return dateString
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

export function extractFirstURL(text: string): string | null {
  // 只匹配标准的 URL 允许字符（字母、数字以及特定符号）
  // 这样无论它前后贴着什么中文、Emoji或中文标点，都能被精准地切割出来
  const urlRegex = /(https?:\/\/[a-zA-Z0-9\-_.~!*'();:@&=+$,/?#[\]%]+)/i
  const match = text.match(urlRegex)

  return match?.[0] || null
}

export function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function safeJSONParse(text: string | null | undefined): unknown | null {
  if (!text) return null
  const candidates = [
    text,
    text.trim(),
    text.replace(/\u2028|\u2029/g, ""),
    text.replace(/\\u002F/g, "/"),
  ]

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === "string") {
        try {
          return JSON.parse(parsed)
        } catch {
          return parsed
        }
      }
      return parsed
    } catch {}
  }

  return null
}
