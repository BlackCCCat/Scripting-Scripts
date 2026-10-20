import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  toFiniteNumber,
} from "./_shared/http"

export const queryVercelAIGatewayQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const json = await fetchJsonStrict(
    "https://ai-gateway.vercel.sh/v1/credits",
    {
      headers: { Authorization: `Bearer ${envelope.accessToken.trim()}` },
    }
  )
  const balance = toFiniteNumber(json.balance ?? json.remaining)
  const used = toFiniteNumber(json.total_used ?? json.used) ?? 0
  if (balance === undefined) {
    throw new QuotaQueryError("unreadableResponse")
  }
  const total = balance + used
  const windows: QuotaWindow[] = [
    {
      id: "vercel.wallet",
      name: "AI Gateway 可用余额",
      unit: "USD",
      wallet: {
        currency: "USD",
        total: balance,
        isMonetary: true,
      },
    },
  ]
  if (total > 0 && used > 0) {
    windows.unshift({
      id: "vercel.usage",
      name: "累计额度消耗",
      usedPercentage: Math.min((used / total) * 100, 100),
      exactCounts: {
        used,
        remaining: balance,
        total,
      },
      unit: "USD",
      resetSemantics: "nonResettingAllowance",
    })
  }
  return {
    accountID,
    collectedAt,
    windows,
  }
}
