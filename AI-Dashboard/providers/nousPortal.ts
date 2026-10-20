import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryNousPortalQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: "https://portal.nousresearch.com/api/v1/quota",
  })
