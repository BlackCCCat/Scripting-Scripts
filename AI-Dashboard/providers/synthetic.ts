import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export const querySyntheticQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const json = await fetchJsonStrict("https://api.synthetic.new/v2/quotas", {
    headers: { Authorization: `Bearer ${envelope.accessToken.trim()}` },
  })
  const windows: QuotaWindow[] = []
  const sub = json.subscription as Record<string, unknown> | undefined
  if (sub) {
    const limit = toFiniteNumber(sub.limit)
    const reqs = toFiniteNumber(sub.requests) ?? 0
    if (limit && limit > 0) {
      windows.push({
        id: "synthetic.subscription",
        name: "订阅请求额度",
        usedPercentage: Math.min((reqs / limit) * 100, 100),
        remainingCount: Math.max(limit - reqs, 0),
        totalCount: limit,
        resetsAt: normalizeEpochDate(sub.renewsAt),
      })
    }
  }
  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }
  return {
    accountID,
    collectedAt,
    windows,
  }
}
