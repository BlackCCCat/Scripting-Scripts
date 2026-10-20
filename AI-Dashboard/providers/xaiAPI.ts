import { ProviderQuotaHandler } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  toFiniteNumber,
} from "./_shared/http"

export const queryXaiAPIQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const rawToken = envelope.accessToken.trim()
  const colonIdx = rawToken.indexOf(":")
  if (colonIdx <= 0) {
    throw new QuotaQueryError(
      "invalidCredential",
      "需为 team_id:management_key 格式"
    )
  }
  const teamID = rawToken.slice(0, colonIdx).trim()
  const key = rawToken.slice(colonIdx + 1).trim()

  const json = await fetchJsonStrict(
    `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamID)}/prepaid/balance`,
    {
      headers: { Authorization: `Bearer ${key}` },
    }
  )

  const totalObj = (json.total as Record<string, unknown> | undefined) ?? json
  const rawCents = toFiniteNumber(totalObj.val ?? json.balance ?? json.amount)
  if (rawCents === undefined) {
    throw new QuotaQueryError("unreadableResponse")
  }
  const usd = Math.abs(rawCents) / 100

  return {
    accountID,
    collectedAt,
    accountIdentity: teamID,
    windows: [
      {
        id: "xai.prepaid",
        name: "xAI Team 预付可用余额",
        unit: "USD",
        wallet: {
          currency: "USD",
          total: usd,
          isMonetary: true,
        },
      },
    ],
  }
}
