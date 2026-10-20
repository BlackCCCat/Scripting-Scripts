import { fetch } from "scripting"
import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  statusToFailure,
  toFiniteNumber,
} from "./_shared/http"

export const queryClaudeQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const rawCookieOrKey = envelope.accessToken.trim()
  const cookieHeader = rawCookieOrKey.includes("=")
    ? rawCookieOrKey
    : `sessionKey=${rawCookieOrKey}`

  const orgsResp = await fetch("https://claude.ai/api/organizations", {
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
    },
    timeout: 15,
    handleRedirect: async () => null,
  })
  if (!orgsResp.ok) {
    throw new QuotaQueryError(
      statusToFailure(orgsResp.status) ?? "server",
      `HTTP ${orgsResp.status}`
    )
  }
  const orgs = (await orgsResp.json()) as unknown[]
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new QuotaQueryError("invalidCredential", "未找到 Claude 组织")
  }
  const firstOrg = orgs[0] as Record<string, unknown>
  const orgUUID = String(firstOrg.uuid ?? "")
  const orgName = String(firstOrg.name ?? "Claude Organization")

  const usageJson = await fetchJsonStrict(
    `https://claude.ai/api/organizations/${encodeURIComponent(orgUUID)}/usage`,
    {
      headers: { Cookie: cookieHeader },
    }
  )

  const windows: QuotaWindow[] = []
  const fiveHour = usageJson.five_hour as Record<string, unknown> | undefined
  if (fiveHour) {
    windows.push({
      id: "claude.five_hour",
      name: "5 小时会话窗口",
      period: "fiveHour",
      usedPercentage: toFiniteNumber(fiveHour.utilization),
      resetsAt: normalizeEpochDate(fiveHour.resets_at),
    })
  }
  const sevenDay = usageJson.seven_day as Record<string, unknown> | undefined
  if (sevenDay) {
    windows.push({
      id: "claude.seven_day",
      name: "7 天综合配额",
      period: "weekly",
      usedPercentage: toFiniteNumber(sevenDay.utilization),
      resetsAt: normalizeEpochDate(sevenDay.resets_at),
    })
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  return {
    accountID,
    collectedAt,
    accountIdentity: orgName,
    providerPlanName: "Claude Web",
    windows,
  }
}
