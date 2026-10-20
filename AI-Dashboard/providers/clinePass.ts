import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryClinePassQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
  })
