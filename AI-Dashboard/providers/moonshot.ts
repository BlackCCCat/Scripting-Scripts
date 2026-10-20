import { ProviderQuotaHandler } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  toFiniteNumber,
} from "./_shared/http"

export const queryMoonshotQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const isIntl = envelope.metadata.region === "international"
  const host = isIntl ? "https://api.moonshot.ai" : "https://api.moonshot.cn"
  const currency = isIntl ? "USD" : "CNY"

  const json = await fetchJsonStrict(`${host}/v1/users/me/balance`, {
    headers: { Authorization: `Bearer ${envelope.accessToken.trim()}` },
  })
  const data = (json.data as Record<string, unknown> | undefined) ?? json
  const total = toFiniteNumber(data.available_balance)
  if (total === undefined) {
    throw new QuotaQueryError("unreadableResponse")
  }
  const cash = toFiniteNumber(data.cash_balance)
  const voucher = toFiniteNumber(data.voucher_balance)

  return {
    accountID,
    collectedAt,
    windows: [
      {
        id: `moonshot.${currency.toLowerCase()}`,
        name: "API 可用总余额",
        unit: currency,
        wallet: {
          currency,
          total,
          granted: voucher,
          toppedUp: cash,
          isMonetary: true,
        },
      },
    ],
  }
}
