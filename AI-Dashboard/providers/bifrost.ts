import { ProviderQuotaHandler } from "../models/types"
import { queryStandardGateway } from "./_shared/http"

export const queryBifrostQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardGateway({
    accountID,
    envelope,
    collectedAt,
    path: "/api/v1/key/info",
  })
