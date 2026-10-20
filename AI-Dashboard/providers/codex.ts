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
  }
}
