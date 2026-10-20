import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryAbacusQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: "https://api.abacus.ai/api/v0/getOrganizationUsage",
  })
