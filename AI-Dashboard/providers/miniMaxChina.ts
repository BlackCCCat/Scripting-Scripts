import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export async function queryMiniMaxCommon(
  accountID: string,
  rawToken: string,
  baseHost: string,
  defaultCurrency: string,
  collectedAt: string
) {
  let groupID = ""
  let apiKey = rawToken.trim()
  const colonIdx = apiKey.indexOf(":")
  if (colonIdx > 0 && colonIdx < apiKey.length - 1) {
    groupID = apiKey.slice(0, colonIdx).trim()
    apiKey = apiKey.slice(colonIdx + 1).trim()
  }

  const query = groupID ? `?GroupId=${encodeURIComponent(groupID)}` : ""
  const json = await fetchJsonStrict(
    `${baseHost}/v1/api/openplatform/coding_plan/remains${query}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  )

  const windows: QuotaWindow[] = []
  const modelRemains = Array.isArray(json.model_remains)
    ? json.model_remains
    : []

  for (const item of modelRemains) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const modelName = String(rec.model_name ?? "Coding Plan")
    const total = toFiniteNumber(
      rec.current_interval_total_count ?? rec.total_count
    )
    const remaining = toFiniteNumber(
      rec.current_interval_usage_count ?? rec.remains_count
    )
    const resetsAt = normalizeEpochDate(rec.end_time)
    if (total !== undefined && total > 0 && remaining !== undefined) {
      const used = Math.max(total - remaining, 0)
      windows.push({
        id: `minimax.${modelName}`,
        name: "周期调用配额",
        scope: modelName,
        period: "fiveHour",
        usedPercentage: Math.min(Math.max((used / total) * 100, 0), 100),
        remainingCount: remaining,
        totalCount: total,
        unit: "次",
        resetsAt,
      })
    }
  }

  if (windows.length === 0) {
    const cash = toFiniteNumber(
      json.available_balance ?? json.balance ?? json.total_balance
    )
    if (cash !== undefined) {
      windows.push({
        id: "minimax.wallet",
        name: "账户现金余额",
        unit: defaultCurrency,
        wallet: {
          currency: defaultCurrency,
          total: cash,
          isMonetary: true,
        },
      })
    }
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

export const queryMiniMaxChinaQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryMiniMaxCommon(
    accountID,
    envelope.accessToken,
    "https://api.minimaxi.com",
    "CNY",
    collectedAt
  )
