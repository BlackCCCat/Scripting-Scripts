import { ProviderQuotaHandler } from "../models/types"
import { queryStandardGateway } from "./_shared/http"

export const queryLLMProxyQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardGateway({
    accountID,
    envelope,
    collectedAt,
    path: "/v1/usage",
  })
