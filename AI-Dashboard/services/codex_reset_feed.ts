export interface CodexResetAnnouncement {
  id: string
  resetType: string
  announcedAt: string
  scheduledFor: string | null
  text: string
}

export interface CodexResetWatch {
  level: string
  resetChancePercent: number | null
  forecastWindow: string
  observedAt: string
  expiresAt: string
  text: string
}

export interface CodexResetStatus {
  data: {
    latestReset?: CodexResetAnnouncement | null
    scheduledReset?: CodexResetAnnouncement | null
    activeWatch?: CodexResetWatch | null
    stats?: {
      total: number
      lastResetAt: string
      daysSinceLast: number
      avgIntervalDays: number
    }
  }
  meta: {
    apiVersion?: string
    generatedAt: string
  }
}

const FEED_URL = "https://codex-resets.com/api/v1/status"
const CACHE_STORAGE_KEY = "ai-dashboard:codex-resets:cached-status"
const CACHE_ETAG_KEY = "ai-dashboard:codex-resets:cached-etag"
const CACHE_EXPIRY_MS = 5 * 60 * 1000 // 5 分钟公开缓存限制

let memoryCache: CodexResetStatus | null = null
let memoryLastFetchedAt = 0

function parseAnnouncement(raw: unknown): CodexResetAnnouncement | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const id = String(obj.id ?? "")
  const resetType = String(obj.reset_type ?? obj.resetType ?? "regular")
  const announcedAt = String(obj.announced_at ?? obj.announcedAt ?? "")
  const scheduledFor =
    obj.scheduled_for != null || obj.scheduledFor != null
      ? String(obj.scheduled_for ?? obj.scheduledFor)
      : null
  const text = String(obj.text ?? "")

  if (!id && !announcedAt && !text) return null
  return { id, resetType, announcedAt, scheduledFor, text }
}

function parseWatch(raw: unknown): CodexResetWatch | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const level = String(obj.level ?? "normal")
  const chanceRaw = obj.reset_chance_percent ?? obj.resetChancePercent
  const resetChancePercent =
    typeof chanceRaw === "number" && Number.isFinite(chanceRaw)
      ? Math.round(chanceRaw)
      : null
  const forecastWindow = String(obj.forecast_window ?? obj.forecastWindow ?? "")
  const observedAt = String(obj.observed_at ?? obj.observedAt ?? "")
  const expiresAt = String(obj.expires_at ?? obj.expiresAt ?? "")
  const text = String(obj.text ?? "")

  if (!observedAt && !expiresAt && !text) return null
  return {
    level,
    resetChancePercent,
    forecastWindow,
    observedAt,
    expiresAt,
    text,
  }
}

export function parseCodexResetStatus(raw: unknown): CodexResetStatus | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const dataNode = (obj.data as Record<string, unknown>) ?? {}
  const metaNode = (obj.meta as Record<string, unknown>) ?? {}

  const latestReset = parseAnnouncement(
    dataNode.latest_reset ?? dataNode.latestReset
  )
  const scheduledReset = parseAnnouncement(
    dataNode.scheduled_reset ?? dataNode.scheduledReset
  )
  const activeWatch = parseWatch(dataNode.active_watch ?? dataNode.activeWatch)

  const generatedAt = String(
    metaNode.generated_at ?? metaNode.generatedAt ?? new Date().toISOString()
  )

  return {
    data: {
      latestReset,
      scheduledReset,
      activeWatch,
    },
    meta: {
      apiVersion: metaNode.api_version ? String(metaNode.api_version) : undefined,
      generatedAt,
    },
  }
}

export async function fetchCodexResetStatus(
  force = false
): Promise<CodexResetStatus | null> {
  const now = Date.now()
  if (!force && memoryCache && now - memoryLastFetchedAt < CACHE_EXPIRY_MS) {
    return memoryCache
  }

  // 读取持久化缓存作为兜底
  if (!memoryCache) {
    try {
      const persisted = Storage.get<string>(CACHE_STORAGE_KEY)
      if (persisted) {
        const parsed = JSON.parse(persisted)
        memoryCache = parseCodexResetStatus(parsed)
      }
    } catch {
      // 忽略缓存反序列化异常
    }
  }

  try {
    const etag = Storage.get<string>(CACHE_ETAG_KEY) || undefined
    const headers: Record<string, string> = {
      Accept: "application/json",
    }
    if (etag) {
      headers["If-None-Match"] = etag
    }

    const resp = await fetch(FEED_URL, {
      headers,
      timeout: 10,
    })

    if (resp.status === 304 && memoryCache) {
      memoryLastFetchedAt = now
      return memoryCache
    }

    if (resp.ok) {
      const json = await resp.json()
      const parsed = parseCodexResetStatus(json)
      if (parsed) {
        memoryCache = parsed
        memoryLastFetchedAt = now
        try {
          Storage.set(CACHE_STORAGE_KEY, JSON.stringify(parsed))
          const newEtag = resp.headers.get("etag") || resp.headers.get("ETag")
          if (newEtag) {
            Storage.set(CACHE_ETAG_KEY, newEtag)
          }
        } catch {
          // 忽略存储异常
        }
        return parsed
      }
    }
  } catch (error) {
    console.warn("fetchCodexResetStatus error:", error)
  }

  return memoryCache
}

export function hasVisibleCodexResetPreview(
  status: CodexResetStatus | null,
  now = new Date()
): boolean {
  if (!status) return false
  if (status.data.scheduledReset) return true
  if (status.data.activeWatch) {
    const expiresMs = Date.parse(status.data.activeWatch.expiresAt)
    if (!Number.isNaN(expiresMs) && expiresMs > now.getTime()) {
      return true
    }
  }
  return false
}

export function formatScheduledResetHeadline(
  scheduledFor: string | null,
  now = new Date()
): string {
  if (!scheduledFor) return "时间待定"
  const targetMs = Date.parse(scheduledFor)
  if (Number.isNaN(targetMs)) return "时间待定"

  const diffMs = targetMs - now.getTime()
  if (diffMs <= 0) return "待确认执行"

  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return `${diffSec} 秒后`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `约 ${diffMin} 分钟后`
  const diffHours = Math.round(diffMin / 60)
  if (diffHours < 24) return `约 ${diffHours} 小时后`
  const diffDays = Math.round(diffHours / 24)
  return `约 ${diffDays} 天后`
}

export function formatCodexResetLocalTime(isoString: string): string {
  const ms = Date.parse(isoString)
  if (Number.isNaN(ms)) return isoString
  const d = new Date(ms)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = String(d.getHours()).padStart(2, "0")
  const minutes = String(d.getMinutes()).padStart(2, "0")
  return `${month}月${day}日 ${hours}:${minutes}`
}

export function getSimulatedDemoCodexResetStatus(): CodexResetStatus {
  const in3Hours = new Date(Date.now() + 3 * 3600 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  return {
    data: {
      latestReset: {
        id: "demo-latest",
        resetType: "banked",
        announcedAt: nowIso,
        scheduledFor: null,
        text: "官方已完成上一轮额度重置",
      },
      scheduledReset: {
        id: "demo-scheduled",
        resetType: "regular",
        announcedAt: nowIso,
        scheduledFor: in3Hours,
        text: "预计下一次全量额度重置",
      },
      activeWatch: {
        level: "high",
        resetChancePercent: 85,
        forecastWindow: "未来 24 小时内",
        observedAt: nowIso,
        expiresAt: in3Hours,
        text: "AI 社区预测高概率重置窗口",
      },
    },
    meta: {
      apiVersion: "v1",
      generatedAt: nowIso,
    },
  }
}
