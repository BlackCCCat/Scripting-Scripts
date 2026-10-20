import { ProviderQuotaHandler } from "../models/types"
import { queryStandardGateway } from "./_shared/http"

export const querySub2APIQuota: ProviderQuotaHandler = async (
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
