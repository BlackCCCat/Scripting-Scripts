import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import { fetchJsonStrict, QuotaQueryError } from "./_shared/http"

export const queryAnthropicQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const query = new URLSearchParams({
    starting_at: monthStart.toISOString(),
    ending_at: now.toISOString(),
    limit: "31",
  })
  const json = await fetchJsonStrict(
    `https://api.anthropic.com/v1/organizations/cost_report?${query.toString()}`,
    {
      headers: {
        "x-api-key": envelope.accessToken.trim(),
        "anthropic-version": "2023-06-01",
      },
    }
  )

  if (!Array.isArray(json.data)) {
    throw new QuotaQueryError("unreadableResponse", "Anthropic 成本报表格式无效")
  }
  let cents = 0
  for (const bucket of json.data) {
    if (!bucket || typeof bucket !== "object" || !Array.isArray(bucket.results)) {
      throw new QuotaQueryError("unreadableResponse", "Anthropic 成本报表缺少结果")
    }
    for (const result of bucket.results) {
      const amount = Number(result?.amount)
      if (!Number.isFinite(amount) || amount < 0 || result?.currency !== "USD") {
        throw new QuotaQueryError("unreadableResponse", "Anthropic 成本金额格式无效")
      }
      cents += amount
    }
  }
  const spentUSD = cents / 100
  const window: QuotaWindow = {
    id: "anthropic.monthly_cost",
    name: "本月 API 花费",
    period: "monthly",
    spentAmount: spentUSD,
    unit: "USD",
    resetsAt: nextMonth.toISOString(),
  }
  return {
    accountID,
    collectedAt,
    providerPlanName: "API",
    windows: [window],
  }
}
