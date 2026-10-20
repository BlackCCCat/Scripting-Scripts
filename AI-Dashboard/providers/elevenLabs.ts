import { ProviderQuotaHandler } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export const queryElevenLabsQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const json = await fetchJsonStrict(
    "https://api.elevenlabs.io/v1/user/subscription",
    {
      headers: { "xi-api-key": envelope.accessToken.trim() },
    }
  )
  const used = toFiniteNumber(json.character_count) ?? 0
  const limit = toFiniteNumber(json.character_limit) ?? 0
  if (limit <= 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }
  const remaining = Math.max(limit - used, 0)
  const resetsAt = normalizeEpochDate(json.next_character_count_reset_unix)
  const tier = typeof json.tier === "string" ? json.tier : undefined

  return {
    accountID,
    collectedAt,
    providerPlanName: tier,
    windows: [
      {
        id: "elevenlabs.characters",
        name: "月度字符合成配额",
        period: "monthly",
        usedPercentage: Math.min((used / limit) * 100, 100),
        exactCounts: {
          used,
          remaining,
          total: limit,
        },
        unit: "字符",
        resetsAt,
      },
    ],
  }
}
