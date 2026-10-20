import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export async function queryZhipuMonitorCommon(
  accountID: string,
  token: string,
  endpoint: string,
  collectedAt: string
) {
  const json = await fetchJsonStrict(endpoint, {
    headers: { Authorization: `Bearer ${token.trim()}` },
  })
  const dataObj = (json.data as Record<string, unknown> | undefined) ?? json
  const limits = Array.isArray(dataObj.limits) ? dataObj.limits : []
  const windows: QuotaWindow[] = []

  for (const item of limits) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const type = String(rec.type ?? "QUOTA")
    const pct = toFiniteNumber(rec.percentage)
    const current = toFiniteNumber(rec.currentValue)
    const total = toFiniteNumber(rec.usage)
    const remaining = toFiniteNumber(rec.remaining)
    const resetsAt = normalizeEpochDate(rec.nextResetTime)

    windows.push({
      id: `zhipu.${type}`,
      name:
        type === "TOKENS_LIMIT"
          ? "Token 速率窗口"
          : type === "TIME_LIMIT"
            ? "调用次数窗口"
            : type,
      usedPercentage:
        pct ??
        (current !== undefined && total !== undefined && total > 0
          ? (current / total) * 100
          : undefined),
      remainingCount: remaining,
      totalCount: total,
      resetsAt,
    })
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  return {
    accountID,
    windows,
    collectedAt,
  }
}

export const queryZaiQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryZhipuMonitorCommon(
    accountID,
    envelope.accessToken,
    "https://api.z.ai/api/monitor/usage/quota/limit",
    collectedAt
  )
