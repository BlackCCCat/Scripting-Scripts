import type { QuotaSnapshot } from "../models/types"
import type { WidgetRefreshMetadata } from "../services/refresh_service"

export type WidgetReloadPolicy =
  | { policy: "never" }
  | { policy: "after"; date: Date }

function parseTimestamp(value?: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function clampReloadMinutes(value: number): number {
  return Math.max(5, Math.min(360, value))
}

/**
 * 规划小组件时间线调度策略
 */
export function resolveWidgetReloadPolicy(input: {
  snapshots: QuotaSnapshot[]
  metadataList: WidgetRefreshMetadata[]
  reloadMinutes: number
  now?: number
}): WidgetReloadPolicy {
  const now = input.now ?? Date.now()

  // 1. 如果所有展示账号凭证都已失效，不再调度唤醒，彻底避免耗电
  const hasValidAccount = input.metadataList.some(
    (m) =>
      m.lastErrorCode !== "missingCredential" &&
      m.lastErrorCode !== "invalidCredential"
  )
  if (input.metadataList.length > 0 && !hasValidAccount) {
    return { policy: "never" }
  }

  // 2. 检查是否有退避中的重试安排（如遭遇 429 限流或请求连续失败）
  const futureRetries: number[] = []
  for (const m of input.metadataList) {
    const retryAt = parseTimestamp(m.nextAutomaticAttemptAt)
    if (retryAt !== null && retryAt > now) {
      futureRetries.push(retryAt)
    }
  }
  if (futureRetries.length > 0) {
    futureRetries.sort((a, b) => a - b)
    return { policy: "after", date: new Date(futureRetries[0]) }
  }

  // 3. 手动模式（<= 0）不进行自动刷新，给系统一个 24 小时兜底重建窗口
  if (input.reloadMinutes <= 0) {
    return { policy: "after", date: new Date(now + 24 * 60 * 60_000) }
  }

  // 4. 根据快照真实采集时间 (collectedAt) 计算下一次刷新点，而非机械从当前时刻后推
  let earliestFetched: number | null = null
  for (const snap of input.snapshots) {
    const t = parseTimestamp(snap.collectedAt)
    if (t !== null && (earliestFetched === null || t < earliestFetched)) {
      earliestFetched = t
    }
  }

  const intervalMs = clampReloadMinutes(input.reloadMinutes) * 60_000
  if (earliestFetched !== null) {
    const targetDate = earliestFetched + intervalMs
    if (targetDate > now) {
      return { policy: "after", date: new Date(targetDate) }
    }
  }

  // 默认最短 5 分钟安全调度
  return { policy: "after", date: new Date(now + 5 * 60_000) }
}

/**
 * 根据网络元数据与数据时效，计算小组件更新时间位置的展示文本：
 * 若刷新失败、接口限流、凭据失效或超过 6 小时未更新，则替换更新时间为警告文本
 */
export function getWidgetStatusOrUpdateTime(input: {
  fetchedAtISO?: string | null
  metadata?: WidgetRefreshMetadata | null
  fallbackTimeText?: string
  now?: number
}): { text: string; isWarning: boolean } {
  const now = input.now ?? Date.now()
  const meta = input.metadata

  if (meta) {
    // 凭据缺失或失效
    if (
      meta.lastErrorCode === "invalidCredential" ||
      meta.lastErrorCode === "missingCredential"
    ) {
      return { text: "授权已失效", isWarning: true }
    }

    // 接口限流
    if (
      meta.lastHttpStatus === 429 ||
      meta.lastErrorCode === "rateLimited"
    ) {
      return { text: "接口限流", isWarning: true }
    }

    // 上一次刷新失败
    const failureTime = parseTimestamp(meta.lastFailureAt)
    const successTime = parseTimestamp(meta.lastSuccessAt)
    if (
      failureTime !== null &&
      (successTime === null || failureTime > successTime)
    ) {
      return { text: "刷新失败", isWarning: true }
    }
  }

  // 超过 6 小时未更新
  const fetchedAt = parseTimestamp(input.fetchedAtISO)
  if (fetchedAt !== null && now - fetchedAt >= 6 * 3600 * 1000) {
    return { text: "数据较旧", isWarning: true }
  }

  // 正常模式：展示更新时间
  let timeStr = input.fallbackTimeText
  if (!timeStr && fetchedAt !== null) {
    timeStr = new Date(fetchedAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (timeStr) {
    const formatted = timeStr.startsWith("更新于")
      ? timeStr
      : `更新于 ${timeStr}`
    return { text: formatted, isWarning: false }
  }

  return { text: "", isWarning: false }
}
