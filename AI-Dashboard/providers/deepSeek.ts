import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  toFiniteNumber,
} from "./_shared/http"

export const queryDeepSeekQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const token = envelope.accessToken.trim()
  const json = await fetchJsonStrict("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${token}` },
  })
  const infos = Array.isArray(json.balance_infos) ? json.balance_infos : []
  const windows: QuotaWindow[] = []

  for (const item of infos) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const currency = String(rec.currency ?? "CNY").toUpperCase()
    const total = toFiniteNumber(rec.total_balance)
    if (total === undefined) continue
    const granted = toFiniteNumber(rec.granted_balance)
    const toppedUp = toFiniteNumber(rec.topped_up_balance)
    windows.push({
      id: `deepseek.${currency.toLowerCase()}`,
      name: `${currency} 账户余额`,
      unit: currency,
      wallet: {
        currency,
        total,
        granted,
        toppedUp,
        isMonetary: true,
      },
    })
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  return {
    accountID,
    windows,
    collectedAt,
    providerPlanName: "API",
  }
}
