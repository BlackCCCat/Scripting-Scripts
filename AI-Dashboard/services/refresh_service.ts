import { Widget } from "scripting"
import type {
  QuotaSnapshot,
  SubscriptionAccount,
} from "../models/types"
import {
  loadDashboardSettings,
  loadEnvelopeFromKeychain,
  loadStoredAccounts,
  loadStoredSnapshots,
  saveEnvelopeToKeychain,
  saveStoredSnapshots,
} from "../utils/credential_store"
import { generateDemoSnapshot } from "../utils/demo_mode"
import { queryProviderQuota, QuotaQueryError } from "../providers"

export type WidgetRefreshMetadata = {
  version: 1
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  failureCount: number
  nextAutomaticAttemptAt: string | null
  lastErrorCode: string | null
  lastHttpStatus: number | null
}

const STORAGE_REFRESH_META_PREFIX = "ai_dashboard_widget_meta_v1_"

let trailingReload: ReturnType<typeof setTimeout> | null = null

/**
 * 请求所有 Scripting 小组件重新加载时间线
 */
export function requestWidgetReload(): boolean {
  try {
    // reloadAll 已在底层覆盖所有用户与测试小组件，无需重复调用 reloadUserWidgets
    Widget.reloadAll()
    return true
  } catch {
    return false
  }
}

/**
 * Storage.set 只会异步提交落盘，底层没有暴露可 await 的写盘完成回调。
 * 先立即请求一次 Widget.reloadAll()，避免主页面退出导致定时器丢失；
 * 再合并一次 750ms 尾随请求，确保 WidgetKit 进程读取到真正持久化后的新快照。
 */
export function requestWidgetReloadAfterStorage(delayMs = 750): void {
  if (trailingReload === null) {
    requestWidgetReload()
  }
  if (trailingReload !== null) {
    clearTimeout(trailingReload)
  }
  trailingReload = setTimeout(() => {
    trailingReload = null
    requestWidgetReload()
  }, delayMs)
}

function metaKey(accountId: string): string {
  return `${STORAGE_REFRESH_META_PREFIX}${accountId}`
}

function iso(val: unknown): string | null {
  if (typeof val !== "string") return null
  const t = new Date(val).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function getWidgetRefreshMetadata(accountId: string): WidgetRefreshMetadata {
  try {
    const raw = Storage.get<Partial<WidgetRefreshMetadata>>(metaKey(accountId))
    if (raw && typeof raw === "object") {
      const failureCount =
        typeof raw.failureCount === "number" && Number.isFinite(raw.failureCount)
          ? Math.max(0, Math.floor(raw.failureCount))
          : 0
      return {
        version: 1,
        lastAttemptAt: iso(raw.lastAttemptAt),
        lastSuccessAt: iso(raw.lastSuccessAt),
        lastFailureAt: iso(raw.lastFailureAt),
        failureCount,
        nextAutomaticAttemptAt: iso(raw.nextAutomaticAttemptAt),
        lastErrorCode:
          typeof raw.lastErrorCode === "string" && raw.lastErrorCode
            ? raw.lastErrorCode
            : null,
        lastHttpStatus:
          typeof raw.lastHttpStatus === "number" && Number.isFinite(raw.lastHttpStatus)
            ? Math.floor(raw.lastHttpStatus)
            : null,
      }
    }
  } catch {}
  return {
    version: 1,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    nextAutomaticAttemptAt: null,
    lastErrorCode: null,
    lastHttpStatus: null,
  }
}

export function setWidgetRefreshMetadata(
  accountId: string,
  meta: WidgetRefreshMetadata
): void {
  try {
    Storage.set(metaKey(accountId), meta)
  } catch {}
}

export function recordWidgetRefreshSuccess(
  accountId: string,
  at = new Date().toISOString()
): void {
  setWidgetRefreshMetadata(accountId, {
    version: 1,
    lastAttemptAt: at,
    lastSuccessAt: at,
    lastFailureAt: null,
    failureCount: 0,
    nextAutomaticAttemptAt: null,
    lastErrorCode: null,
    lastHttpStatus: null,
  })
}

export function widgetRefreshBackoff(
  failureCount: number,
  isRateLimit = false,
  now = Date.now()
): string {
  if (isRateLimit) {
    return new Date(now + 30 * 60_000).toISOString()
  }
  const count = Math.max(1, failureCount)
  const minutes = count <= 1 ? 5 : count === 2 ? 15 : count === 3 ? 30 : 60
  return new Date(now + minutes * 60_000).toISOString()
}

export function recordWidgetRefreshFailure(
  accountId: string,
  errorCode: string,
  httpStatus?: number,
  now = Date.now()
): void {
  const prev = getWidgetRefreshMetadata(accountId)
  const count = prev.failureCount + 1
  const isRateLimit = httpStatus === 429 || errorCode === "rateLimited"
  const nextAttempt = widgetRefreshBackoff(count, isRateLimit, now)
  const at = new Date(now).toISOString()

  setWidgetRefreshMetadata(accountId, {
    version: 1,
    lastAttemptAt: at,
    lastSuccessAt: prev.lastSuccessAt,
    lastFailureAt: at,
    failureCount: count,
    nextAutomaticAttemptAt: nextAttempt,
    lastErrorCode: errorCode,
    lastHttpStatus: httpStatus || null,
  })
}

/**
 * 针对单个账号进行网络刷新并落盘持久化
 */
export async function refreshAccountById(accountId: string): Promise<{
  ok: boolean
  snapshot?: QuotaSnapshot
  error?: string
}> {
  const accounts = loadStoredAccounts()
  const account = accounts.find((a) => a.id === accountId)
  if (!account) return { ok: false, error: "账号不存在" }

  const settings = loadDashboardSettings()
  if (settings.isDemoMode) {
    const demoSnap = generateDemoSnapshot(account.id, account.provider, account.region)
    const snapshots = loadStoredSnapshots()
    snapshots[account.id] = demoSnap
    saveStoredSnapshots(snapshots)
    recordWidgetRefreshSuccess(account.id)
    requestWidgetReloadAfterStorage()
    return { ok: true, snapshot: demoSnap }
  }

  const envelope = loadEnvelopeFromKeychain(
    account.credentialKeychainKey,
    account.preferssynchronizableKeychain
  )
  if (!envelope) {
    recordWidgetRefreshFailure(account.id, "missingCredential")
    return { ok: false, error: "未找到凭据" }
  }

  try {
    const result = await queryProviderQuota(account.id, envelope)
    if (result.updatedCredential) {
      saveEnvelopeToKeychain(
        account.credentialKeychainKey,
        result.updatedCredential,
        account.preferssynchronizableKeychain
      )
    }
    const snapshots = loadStoredSnapshots()
    snapshots[account.id] = result.snapshot
    saveStoredSnapshots(snapshots)
    recordWidgetRefreshSuccess(account.id)
    requestWidgetReloadAfterStorage()
    return { ok: true, snapshot: result.snapshot }
  } catch (err) {
    const code = err instanceof QuotaQueryError ? err.code : "network"
    const isRateLimit = code === "rateLimited"
    recordWidgetRefreshFailure(account.id, code, isRateLimit ? 429 : undefined)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 后台全量刷新所有已启用的账号（供桌面快捷指令自动化与小组件交互刷新调用）
 */
export async function refreshAllAccountsFromBackground(): Promise<{
  total: number
  succeeded: number
  failed: number
}> {
  const accounts = loadStoredAccounts().filter((a) => a.isEnabled)
  if (accounts.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 }
  }

  const settings = loadDashboardSettings()
  if (settings.isDemoMode) {
    const snapshots = loadStoredSnapshots()
    for (const acc of accounts) {
      snapshots[acc.id] = generateDemoSnapshot(acc.id, acc.provider, acc.region)
      recordWidgetRefreshSuccess(acc.id)
    }
    saveStoredSnapshots(snapshots)
    requestWidgetReloadAfterStorage()
    return { total: accounts.length, succeeded: accounts.length, failed: 0 }
  }

  const snapshots = loadStoredSnapshots()
  let succeeded = 0
  let failed = 0

  // 并发量控制为 3，与 AI Usage 严格对齐，防止 iOS 后台因并发网络超限杀停脚本
  const CONCURRENCY = 3
  const chunks: SubscriptionAccount[][] = []
  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    chunks.push(accounts.slice(i, i + CONCURRENCY))
  }

  for (const chunk of chunks) {
    await Promise.allSettled(
      chunk.map(async (acc) => {
        const envelope = loadEnvelopeFromKeychain(
          acc.credentialKeychainKey,
          acc.preferssynchronizableKeychain
        )
        if (!envelope) {
          failed++
          recordWidgetRefreshFailure(acc.id, "missingCredential")
          return
        }

        try {
          const result = await queryProviderQuota(acc.id, envelope)
          if (result.updatedCredential) {
            saveEnvelopeToKeychain(
              acc.credentialKeychainKey,
              result.updatedCredential,
              acc.preferssynchronizableKeychain
            )
          }
          snapshots[acc.id] = result.snapshot
          recordWidgetRefreshSuccess(acc.id)
          succeeded++
        } catch (err) {
          failed++
          const code = err instanceof QuotaQueryError ? err.code : "network"
          const isRateLimit = code === "rateLimited"
          recordWidgetRefreshFailure(acc.id, code, isRateLimit ? 429 : undefined)
        }
      })
    )
  }

  if (succeeded > 0) {
    saveStoredSnapshots(snapshots)
  }
  requestWidgetReloadAfterStorage()
  return { total: accounts.length, succeeded, failed }
}
