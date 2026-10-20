import { ProviderQuotaHandler } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  toFiniteNumber,
} from "./_shared/http"

export const queryPoeQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const json = await fetchJsonStrict(
    "https://api.poe.com/usage/current_balance",
    {
      headers: { Authorization: `Bearer ${envelope.accessToken.trim()}` },
    }
  )
  const balance = toFiniteNumber(
    json.current_point_balance ?? json.balance ?? json.points
  )
  if (balance === undefined) {
    throw new QuotaQueryError("unreadableResponse")
  }
  return {
    accountID,
    collectedAt,
    windows: [
      {
        id: "poe.points",
        name: "可用计算积分 (Points)",
        unit: "Points",
        wallet: {
          currency: "Points",
          total: balance,
          isMonetary: false,
        },
      },
    ],
  }
}
