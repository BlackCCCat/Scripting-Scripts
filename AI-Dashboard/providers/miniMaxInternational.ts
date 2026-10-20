import { ProviderQuotaHandler } from "../models/types"
import { queryMiniMaxCommon } from "./miniMaxChina"

export const queryMiniMaxInternationalQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryMiniMaxCommon(
    accountID,
    envelope.accessToken,
    "https://api.minimax.io",
    "USD",
    collectedAt
  )
