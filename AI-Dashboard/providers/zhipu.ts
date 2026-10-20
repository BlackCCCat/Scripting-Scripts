import { ProviderQuotaHandler } from "../models/types"
import { queryZhipuMonitorCommon } from "./zai"

export const queryZhipuQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryZhipuMonitorCommon(
    accountID,
    envelope.accessToken,
    "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    collectedAt
  )
