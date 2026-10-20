import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryPerplexityQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: "https://www.perplexity.ai/rest/rate-limit/all",
  })
