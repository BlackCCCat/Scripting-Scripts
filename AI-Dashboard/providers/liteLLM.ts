import { ProviderQuotaHandler } from "../models/types"
import { queryStandardGateway } from "./_shared/http"

export const queryLiteLLMQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardGateway({
    accountID,
    envelope,
    collectedAt,
    path: "/key/info",
  })
