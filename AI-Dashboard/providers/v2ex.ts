import { ProviderQuotaHandler } from "../models/types"
import {
  fetchJsonStrict,
  parseGenericBalanceOrQuotaJson,
  toFiniteNumber,
} from "./_shared/http"

export const queryV2EXQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const token = envelope.accessToken.trim()
  const json = await fetchJsonStrict("https://edge.v2ex.com/api/v2/chat/quota", {
    headers: { Authorization: `Bearer ${token}` },
  })
  const result = (json.result as Record<string, unknown> | undefined) ?? json
  const gold = toFiniteNumber(result.balance_gold ?? result.gold)
  const silver = toFiniteNumber(result.balance_silver ?? result.silver)
  const bronze = toFiniteNumber(result.balance_bronze ?? result.bronze)

  if (gold !== undefined || silver !== undefined || bronze !== undefined) {
    const g = gold ?? 0
    const s = silver ?? 0
    const b = bronze ?? 0
    const totalCopper = g * 10000 + s * 100 + b
    return {
      accountID,
      collectedAt,
      accountIdentity:
        typeof result.username === "string" ? result.username : undefined,
      windows: [
        {
          id: "v2ex.copper",
          name: `铜币总计 (${g}金 ${s}银 ${b}铜)`,
          unit: "Copper",
          wallet: {
            currency: "Copper",
            total: totalCopper,
            isMonetary: false,
          },
        },
      ],
    }
  }

  return parseGenericBalanceOrQuotaJson(
    accountID,
    "v2ex",
    json,
    collectedAt,
    "Copper"
  )
}
