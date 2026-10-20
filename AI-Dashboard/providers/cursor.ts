import {
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderQuotaHandler,
  QuotaWindow,
} from "../models/types"
import {
  fetchJsonStrict,
  normalizeEpochDate,
  parseGenericBalanceOrQuotaJson,
  toFiniteNumber,
} from "./_shared/http"

export async function queryCursorCommon(
  accountID: string,
  provider: ProviderId,
  rawCookie: string,
  collectedAt: string,
  envelope?: ProviderCredentialEnvelope
) {
  const trimmed = rawCookie.trim()
  const cookieHeader = trimmed.includes("WorkosCursorSessionToken=")
    ? trimmed
    : `WorkosCursorSessionToken=${trimmed}`

  const json = await fetchJsonStrict("https://cursor.com/api/usage-summary", {
    headers: { Cookie: cookieHeader },
  })

  const windows: QuotaWindow[] = []
  const individual = json.individualUsage as Record<string, unknown> | undefined
  const plan = individual?.plan as Record<string, unknown> | undefined
  if (plan) {
    const used = toFiniteNumber(plan.used) ?? 0
    const limit = toFiniteNumber(plan.limit) ?? 0
    if (limit > 0) {
      windows.push({
        id: `${provider}.plan`,
        name: "订阅请求",
        period: "monthly",
        usedPercentage: Math.min((used / limit) * 100, 100),
        remainingCount: Math.max(limit - used, 0),
        totalCount: limit,
        unit: "次",
        resetsAt: normalizeEpochDate(json.billingCycleEnd),
      })
    }
  }
  const onDemand = individual?.onDemand as Record<string, unknown> | undefined
  if (onDemand && onDemand.enabled === true) {
    const usedCents = toFiniteNumber(onDemand.used) ?? 0
    const limitCents = toFiniteNumber(onDemand.limit) ?? 0
    if (limitCents > 0) {
      windows.push({
        id: `${provider}.ondemand`,
        name: "按量扩展",
        period: "monthly",
        usedPercentage: Math.min((usedCents / limitCents) * 100, 100),
        exactCounts: {
          used: usedCents / 100,
          remaining: Math.max(limitCents - usedCents, 0) / 100,
          total: limitCents / 100,
        },
        unit: "USD",
        overagePermitted: true,
      })
    }
  }

  if (windows.length === 0) {
    return parseGenericBalanceOrQuotaJson(accountID, provider, json, collectedAt)
  }

  const candidateIdentity =
    envelope?.metadata.email ||
    envelope?.metadata.accountEmail ||
    (typeof json.email === "string" ? json.email : undefined) ||
    (typeof json.userEmail === "string" ? json.userEmail : undefined) ||
    (envelope?.accountID && !envelope.accountID.startsWith("demo-")
      ? envelope.accountID
      : undefined)

  return {
    accountID,
    collectedAt,
    providerPlanName:
      typeof json.membershipType === "string"
        ? json.membershipType
        : "Pro",
    accountIdentity: candidateIdentity,
    windows,
  }
}

export const queryCursorQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) =>
  queryCursorCommon(
    accountID,
    "cursor",
    envelope.accessToken,
    collectedAt,
    envelope
  )
