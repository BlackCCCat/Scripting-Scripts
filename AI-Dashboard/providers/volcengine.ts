import {
  ProviderQuotaHandler,
  QuotaPeriod,
  QuotaWindow,
} from "../models/types"
import { hmacSha256Data, sha256Hex } from "../utils/credential_store"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

function formatVolcTimestamp(date: Date): string {
  const iso = date.toISOString()
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

async function fetchVolcengineAction(
  action: "GetCodingPlanUsage" | "GetAFPUsage",
  accessKeyID: string,
  secretAccessKey: string,
  now: Date
): Promise<QuotaWindow[]> {
  const host = "open.volcengineapi.com"
  const region = "cn-beijing"
  const service = "ark"
  const signedHeaders = "content-type;host;x-content-sha256;x-date"
  const contentType = "application/x-www-form-urlencoded; charset=utf-8"

  const timestamp = formatVolcTimestamp(now)
  const day = timestamp.slice(0, 8)
  const emptyPayloadHash = sha256Hex("")
  const queryString = `Action=${encodeURIComponent(action)}&Version=2024-01-01`
  const canonical = [
    "GET",
    "/",
    queryString,
    `content-type:${contentType}`,
    `host:${host}`,
    `x-content-sha256:${emptyPayloadHash}`,
    `x-date:${timestamp}`,
    "",
    signedHeaders,
    emptyPayloadHash,
  ].join("\n")

  const scope = `${day}/${region}/${service}/request`
  const toSign = [
    "HMAC-SHA256",
    timestamp,
    scope,
    sha256Hex(canonical),
  ].join("\n")

  let signingKey = Data.fromRawString(secretAccessKey)!
  for (const part of [day, region, service, "request"]) {
    signingKey = hmacSha256Data(Data.fromRawString(part)!, signingKey)
  }
  const signature = hmacSha256Data(Data.fromRawString(toSign)!, signingKey)
    .toHexString()
    .toLowerCase()

  const authHeader = `HMAC-SHA256 Credential=${accessKeyID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const json = await fetchJsonStrict(`https://${host}/?${queryString}`, {
    headers: {
      "Content-Type": contentType,
      Host: host,
      "X-Date": timestamp,
      "X-Content-Sha256": emptyPayloadHash,
      Authorization: authHeader,
    },
  })

  const meta = json.ResponseMetadata as Record<string, unknown> | undefined
  if (meta && meta.Error && typeof meta.Error === "object") {
    const errObj = meta.Error as Record<string, unknown>
    const code = String(errObj.Code ?? "").toLowerCase()
    if (
      code.includes("invalidaccesskey") ||
      code.includes("signaturedoesnotmatch") ||
      code.includes("accessdenied")
    ) {
      throw new QuotaQueryError(
        "invalidCredential",
        String(errObj.Message ?? code)
      )
    }
    throw new QuotaQueryError("server", String(errObj.Message ?? code))
  }

  const result = (json.Result as Record<string, unknown> | undefined) ?? {}
  const windows: QuotaWindow[] = []

  if (action === "GetCodingPlanUsage") {
    const rows = Array.isArray(result.QuotaUsage) ? result.QuotaUsage : []
    for (const r of rows) {
      if (!r || typeof r !== "object") continue
      const row = r as Record<string, unknown>
      const level = String(row.Level ?? "").toLowerCase()
      const period: QuotaPeriod =
        level.includes("5") || level.includes("session")
          ? "fiveHour"
          : level.includes("week")
            ? "weekly"
            : "monthly"
      const pct = toFiniteNumber(row.Percent)
      windows.push({
        id: `volcengine.coding.${period}`,
        name:
          period === "fiveHour"
            ? "5 小时额度"
            : period === "weekly"
              ? "每周额度"
              : "每月额度",
        scope: "Coding Plan",
        period,
        usedPercentage: pct,
        isExhausted: pct !== undefined ? pct >= 100 : undefined,
        resetsAt: normalizeEpochDate(row.ResetTimestamp),
      })
    }
  } else {
    const pairs: [QuotaPeriod, string, unknown][] = [
      ["fiveHour", "5 小时额度", result.AFPFiveHour],
      ["weekly", "每周额度", result.AFPWeekly],
      ["monthly", "每月额度", result.AFPMonthly],
    ]
    for (const [period, label, rawRow] of pairs) {
      if (!rawRow || typeof rawRow !== "object") continue
      const row = rawRow as Record<string, unknown>
      const quota = toFiniteNumber(row.Quota)
      const used = toFiniteNumber(row.Used) ?? 0
      if (quota && quota > 0) {
        windows.push({
          id: `volcengine.agent.${period}`,
          name: label,
          scope: "Agent Plan",
          period,
          usedPercentage: Math.min((used / quota) * 100, 100),
          remainingCount: Math.max(quota - used, 0),
          totalCount: quota,
          unit: "AFP",
          resetsAt: normalizeEpochDate(row.ResetTime),
        })
      }
    }
  }

  return windows
}

export const queryVolcengineQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const rawToken = envelope.accessToken.trim()
  const colonIdx = rawToken.indexOf(":")
  if (colonIdx <= 0 || colonIdx === rawToken.length - 1) {
    throw new QuotaQueryError("invalidCredential", "需为 AK:SK 格式")
  }
  const ak = rawToken.slice(0, colonIdx).trim()
  const sk = rawToken.slice(colonIdx + 1).trim()
  const now = new Date()

  const results = await Promise.allSettled([
    fetchVolcengineAction("GetCodingPlanUsage", ak, sk, now),
    fetchVolcengineAction("GetAFPUsage", ak, sk, now),
  ])

  const windows: QuotaWindow[] = []
  let firstError: QuotaQueryError | null = null
  for (const res of results) {
    if (res.status === "fulfilled") {
      windows.push(...res.value)
    } else if (!firstError && res.reason instanceof QuotaQueryError) {
      firstError = res.reason
    }
  }

  if (windows.length === 0) {
    if (firstError) throw firstError
    throw new QuotaQueryError("subscriptionRequired")
  }

  return {
    accountID,
    windows,
    collectedAt,
    providerPlanName: "Coding Plan",
  }
}
