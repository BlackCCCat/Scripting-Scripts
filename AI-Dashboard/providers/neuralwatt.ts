import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryNeuralwattQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: "https://api.neuralwatt.com/v1/balance",
  })
