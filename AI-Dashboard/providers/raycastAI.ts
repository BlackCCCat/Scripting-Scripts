import { ProviderQuotaHandler } from "../models/types"
import {
  fetchJsonStrict,
  parseGenericBalanceOrQuotaJson,
} from "./_shared/http"

export const queryRaycastAIQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const bearer = envelope.accessToken
    .trim()
    .replace(/^_raycast_session=/, "")
    .split(";")[0]
    .trim()
  const json = await fetchJsonStrict("https://backend.raycast.com/api/v1/me", {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  return parseGenericBalanceOrQuotaJson(
    accountID,
    "raycastAI",
    json,
    collectedAt
  )
}
