import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export const queryCodexQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${envelope.accessToken.trim()}`,
  }
  const chatgptAccountId = envelope.metadata.accountID || envelope.accountID
  if (chatgptAccountId) {
    headers["chatgpt-account-id"] = String(chatgptAccountId)
  }

  const json = await fetchJsonStrict(
    "https://chatgpt.com/backend-api/wham/usage",
    { headers }
  )
  const windows: QuotaWindow[] = []
  const rateLimit = json.rate_limit as Record<string, unknown> | undefined
  if (rateLimit) {
    const primary = rateLimit.primary_window as
      | Record<string, unknown>
      | undefined
    if (primary) {
      windows.push({
        id: "codex.primary",
        name: "5 小时主窗口",
        period: "fiveHour",
        usedPercentage: toFiniteNumber(primary.used_percent),
        resetsAt: normalizeEpochDate(primary.reset_at),
      })
    }
    const secondary = rateLimit.secondary_window as
      | Record<string, unknown>
      | undefined
    if (secondary) {
      windows.push({
        id: "codex.secondary",
        name: "周度窗口",
        period: "weekly",
        usedPercentage: toFiniteNumber(secondary.used_percent),
        resetsAt: normalizeEpochDate(secondary.reset_at),
      })
    }
  }
  const credits = json.credits as Record<string, unknown> | undefined
  if (credits) {
    const bal = toFiniteNumber(credits.balance)
    if (bal !== undefined) {
      windows.push({
        id: "codex.credits",
        name: "Codex Credits 余额",
        unit: "Credits",
        wallet: {
          currency: "Credits",
          total: bal,
          isMonetary: false,
        },
      })
    }
  }
  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  // 解析可用重置卡/充值卡数据 (Reset Credits)
  let resetCardsCount: number | undefined
  let resetCardExpirations: string[] = []

  // 1. 优先从 usage 响应内置字段中提取
  const embeddedReset =
    (json.rate_limit_reset_credits as Record<string, unknown> | undefined) ||
    (json.rateLimitResetCredits as Record<string, unknown> | undefined)

  if (embeddedReset) {
    const countVal = toFiniteNumber(
      embeddedReset.available_count ?? embeddedReset.availableCount
    )
    if (countVal !== undefined && countVal !== null) {
      resetCardsCount = Math.max(0, Math.floor(countVal))
    }
  }

  // 2. 主动尝试请求独立 rate-limit-reset-credits 端点以获取精准可用卡数与到期时间
  try {
    const resetCreditsHeaders: Record<string, string> = {
      Authorization: `Bearer ${envelope.accessToken.trim()}`,
      Accept: "application/json",
      "User-Agent":
        "Codex Desktop/0.147.0-alpha.6.5 (Mac OS 27.0.0; arm64) unknown (Codex Desktop; 26.803.61601)",
      originator: "Codex Desktop",
    }
    if (chatgptAccountId) {
      resetCreditsHeaders["ChatGPT-Account-Id"] = String(chatgptAccountId)
    }

    const resetResp = await fetch(
      "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      {
        headers: resetCreditsHeaders,
        timeout: 4,
        handleRedirect: async () => null,
      }
    )
    if (resetResp.ok) {
      const resetPayload = (await resetResp.json()) as Record<string, unknown>
      const container =
        (resetPayload.rate_limit_reset_credits as Record<string, unknown> | undefined) ||
        (resetPayload.rateLimitResetCredits as Record<string, unknown> | undefined) ||
        resetPayload

      const countVal = toFiniteNumber(
        container.available_count ?? container.availableCount
      )
      if (countVal !== undefined && countVal !== null) {
        resetCardsCount = Math.max(0, Math.floor(countVal))
      }

      const rawItems = (
        container.credits ||
        container.items ||
        container.reset_credits ||
        container.resetCredits
      ) as unknown[] | undefined

      if (Array.isArray(rawItems)) {
        resetCardExpirations = rawItems
          .map((item) => {
            const obj = item as Record<string, unknown>
            const exp =
              obj.expires_at ??
              obj.expiresAt ??
              obj.expiration_at ??
              obj.expirationAt
            return normalizeEpochDate(exp)
          })
          .filter((item): item is string => Boolean(item))
      }
    }
  } catch {
    // 忽略重置卡端点非致命网络异常
  }

  let accountIdentity: string | undefined =
    envelope.metadata.email ||
    envelope.metadata.accountEmail ||
    envelope.metadata.username

  if (!accountIdentity) {
    try {
      const meResp = await fetch("https://chatgpt.com/backend-api/me", {
        headers: { Authorization: `Bearer ${envelope.accessToken.trim()}` },
        timeout: 5,
        handleRedirect: async () => null,
      })
      if (meResp.ok) {
        const meJson = (await meResp.json()) as Record<string, unknown>
        if (typeof meJson.email === "string" && meJson.email.trim()) {
          accountIdentity = meJson.email.trim()
        }
      }
    } catch {
      // 忽略 /me 偶发网络异常
    }
  }

  return {
    accountID,
    collectedAt,
    providerPlanName:
      typeof json.plan_type === "string" && json.plan_type.trim()
        ? json.plan_type.trim()
        : envelope.metadata.planType || "Pro",
    accountIdentity,
    windows,
    codexResetCards:
      resetCardsCount !== undefined
        ? {
            availableCount: resetCardsCount,
            expirations: resetCardExpirations,
          }
        : undefined,
  }
}
