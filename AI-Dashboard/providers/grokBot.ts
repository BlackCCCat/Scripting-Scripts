import { ProviderQuotaHandler } from "../models/types"
import { queryCursorCommon } from "./cursor"

export const queryGrokBotQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => queryCursorCommon(accountID, "grokBot", envelope.accessToken, collectedAt)
