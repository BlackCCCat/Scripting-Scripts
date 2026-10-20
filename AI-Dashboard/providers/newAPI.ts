import { ProviderQuotaHandler } from "../models/types"
import { normalizeGatewayServerAddress } from "../utils/credential_store"
import {
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export const queryNewAPIQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const base = normalizeGatewayServerAddress(
    envelope.metadata.serverAddress ?? ""
  )
  const token = envelope.accessToken.trim()
  const colonIdx = token.indexOf(":")

  // 模式 A: user_id:system_access_token -> GET /api/user/self
  if (colonIdx > 0 && /^\d+$/.test(token.slice(0, colonIdx).trim())) {
    const userID = token.slice(0, colonIdx).trim()
    const sysToken = token.slice(colonIdx + 1).trim()
    const json = await fetchJsonStrict(`${base}/api/user/self`, {
      headers: {
        Authorization: `Bearer ${sysToken}`,
        "New-Api-User": userID,
      },
      allowSameOriginRedirect: true,
    })
    const data = (json.data as Record<string, unknown> | undefined) ?? json
    const quotaRaw = toFiniteNumber(data.quota) ?? 0
    const usedRaw = toFiniteNumber(data.used_quota) ?? 0
    // New API 内部配额换算基准：500,000 = $1 USD
    const remainingUSD = quotaRaw / 500000
    const usedUSD = usedRaw / 500000
    const totalUSD = remainingUSD + usedUSD

    return {
      accountID,
      collectedAt,
      accountIdentity:
        typeof data.username === "string" ? data.username : `User #${userID}`,
      providerPlanName: typeof data.group === "string" ? data.group : "企业分组",
      windows: [
        {
          id: "newapi.user.quota",
          name: "总额配额",
          usedPercentage: totalUSD > 0 ? (usedUSD / totalUSD) * 100 : 0,
          exactCounts: {
            used: usedUSD,
            remaining: remainingUSD,
            total: totalUSD,
          },
          unit: "USD",
          resetSemantics: "nonResettingAllowance",
        },
      ],
    }
  }

  // 模式 B: OpenAI 兼容账单接口 /v1/dashboard/billing/subscription & usage
  const subJson = await fetchJsonStrict(
    `${base}/v1/dashboard/billing/subscription`,
    {
      headers: { Authorization: `Bearer ${token}` },
      allowSameOriginRedirect: true,
    }
  )
  let totalUsedUSD = 0
  try {
    const usageJson = await fetchJsonStrict(
      `${base}/v1/dashboard/billing/usage`,
      {
        headers: { Authorization: `Bearer ${token}` },
        allowSameOriginRedirect: true,
      }
    )
    const cents = toFiniteNumber(usageJson.total_usage) ?? 0
    totalUsedUSD = cents / 100
  } catch {
    // 部分中转站仅开放 subscription
  }

  const hardLimitUSD =
    toFiniteNumber(subJson.hard_limit_usd ?? subJson.system_hard_limit_usd) ?? 0
  const remainingUSD = Math.max(hardLimitUSD - totalUsedUSD, 0)
  const expiresAt = normalizeEpochDate(subJson.access_until)

  return {
    accountID,
    collectedAt,
    providerPlanName:
      typeof subJson.plan === "object" && subJson.plan
        ? String((subJson.plan as Record<string, unknown>).title ?? "API")
        : "API",
    windows:
      hardLimitUSD > 0
        ? [
            {
              id: "newapi.token.budget",
              name: "总额配额",
              usedPercentage: Math.min(
                (totalUsedUSD / hardLimitUSD) * 100,
                100
              ),
              exactCounts: {
                used: totalUsedUSD,
                remaining: remainingUSD,
                total: hardLimitUSD,
              },
              unit: "USD",
              expiresAt,
              resetSemantics: "nonResettingAllowance",
            },
          ]
        : [
            {
              id: "newapi.token.wallet",
              name: "API 钱包余额",
              unit: "USD",
              wallet: {
                currency: "USD",
                total: remainingUSD,
                isMonetary: true,
              },
            },
          ],
  }
}
