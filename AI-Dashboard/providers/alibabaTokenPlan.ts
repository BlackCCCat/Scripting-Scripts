import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryAlibabaTokenPlanQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: `https://bailian-cs.${envelope.metadata.region || "cn-beijing"}.aliyuncs.com`,
    method: "POST",
  })
