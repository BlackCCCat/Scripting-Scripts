import { ProviderQuotaHandler } from "../models/types"
import { queryStandardEndpoint } from "./_shared/http"

export const queryStepFunQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryStandardEndpoint({
    accountID,
    envelope,
    collectedAt,
    url: "https://platform.stepfun.com/api/step.openapi.devcenter.DevCenter/GetCodingPlanStatus",
    method: "POST",
    defaultCurrency: "CNY",
  })
