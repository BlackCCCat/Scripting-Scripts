export function normalizeBaseUrl(input: string): string {
  return String(input ?? "").trim().replace(/\/+$/, "")
}

export const WIDGET_REFRESH_HOUR_OPTIONS = [1, 3, 6, 12, 24] as const

export function normalizeWidgetRefreshHours(input: unknown): number {
  const value = Number(input)
  return WIDGET_REFRESH_HOUR_OPTIONS.includes(value as any) ? value : 3
}

export function isLikelyHttpUrl(input: string): boolean {
  const value = normalizeBaseUrl(input)
  if (!value) return false
  if (/\s/.test(value)) return false
  return /^https?:\/\/[^/]+(?:\/.*)?$/i.test(value)
}

export function joinBaseUrl(baseUrl: string, suffix: string): string {
  const base = normalizeBaseUrl(baseUrl)
  const rawSuffix = String(suffix ?? "").trim()
  if (!rawSuffix) return base
  const fixedSuffix = rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`
  return `${base}${fixedSuffix}`
}

export function maskApiKey(apiKey: string): string {
  const value = String(apiKey ?? "").trim()
  if (!value) return ""
  if (value.length <= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`
  return `${value.slice(0, 4)}${"*".repeat(Math.min(10, Math.max(4, value.length - 8)))}${value.slice(-4)}`
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "未检测"
  const date = new Date(ts)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const min = String(date.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
