import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export const queryCopilotQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const token = envelope.accessToken.trim()
  const json = await fetchJsonStrict(
    "https://api.github.com/copilot_internal/user",
    {
      headers: {
        Authorization: `token ${token}`,
        "Editor-Version": "vscode/1.96.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
      },
    }
  )
  const windows: QuotaWindow[] = []
  const snapshots = json.quota_snapshots as Record<string, unknown> | undefined
  const resetDate = normalizeEpochDate(json.quota_reset_date)

  if (snapshots) {
    for (const [key, rawVal] of Object.entries(snapshots)) {
      if (!rawVal || typeof rawVal !== "object") continue
      const snap = rawVal as Record<string, unknown>
      const unlimited = snap.unlimited === true
      const entitlement = toFiniteNumber(snap.entitlement)
      const remaining = toFiniteNumber(snap.remaining)
      const pctRemaining = toFiniteNumber(snap.percent_remaining)
      const label =
        key === "premium_interactions"
          ? "高级模型请求 (Premium Requests)"
          : key === "chat"
            ? "Copilot Chat 对话"
            : key === "completions"
              ? "代码补全 (Completions)"
              : key

      const isExhausted =
        !unlimited &&
        (remaining !== undefined
          ? remaining <= 0
          : pctRemaining !== undefined
            ? pctRemaining <= 0
            : false)

      windows.push({
        id: `copilot.${key}`,
        name: label,
        period: "monthly",
        isUnlimited: unlimited,
        isExhausted,
        usedPercentage:
          unlimited
            ? 0
            : pctRemaining !== undefined
              ? Math.max(100 - pctRemaining, 0)
              : entitlement && remaining !== undefined
                ? Math.max(
                    0,
                    Math.min(100, ((entitlement - remaining) / entitlement) * 100)
                  )
                : undefined,
        remainingCount: remaining,
        totalCount: entitlement,
        resetsAt: resetDate,
      })
    }
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  const userObj = json.user as Record<string, unknown> | undefined
  const ghLogin =
    typeof json.login === "string"
      ? json.login
      : typeof userObj?.login === "string"
        ? userObj.login
        : envelope.metadata.username || envelope.metadata.email

  return {
    accountID,
    collectedAt,
    providerPlanName:
      typeof json.copilot_plan === "string" ? json.copilot_plan : "Pro",
    accountIdentity: ghLogin,
    windows,
  }
}
