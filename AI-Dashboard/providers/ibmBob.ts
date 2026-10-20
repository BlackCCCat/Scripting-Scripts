import { ProviderQuotaHandler } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  parseGenericBalanceOrQuotaJson,
} from "./_shared/http"

export const queryIBMBobQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const rawToken = envelope.accessToken.trim()
  const colonIdx = rawToken.indexOf(":")
  if (colonIdx <= 0) {
    throw new QuotaQueryError(
      "invalidCredential",
      "需为 org_id:access_token 格式"
    )
  }
  const orgID = rawToken.slice(0, colonIdx).trim()
  const token = rawToken.slice(colonIdx + 1).trim()

  const json = await fetchJsonStrict(
    `https://api.bob.ibm.com/v1/organizations/${encodeURIComponent(orgID)}/usage`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  return parseGenericBalanceOrQuotaJson(accountID, "ibmBob", json, collectedAt)
}
