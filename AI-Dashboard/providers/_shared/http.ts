import { fetch } from "scripting"
import {
  ProviderCredentialEnvelope,
  ProviderId,
  QuotaSnapshot,
  QuotaWindow,
  RefreshFailureCode,
} from "../../models/types"
import { normalizeGatewayServerAddress } from "../../utils/credential_store"
import { getProviderMeta } from "../../utils/providers_catalog"

export class QuotaQueryError extends Error {
  readonly code: RefreshFailureCode
  readonly detail?: string

  constructor(code: RefreshFailureCode, detail?: string) {
    super(detail || code)
    this.code = code
    this.detail = detail
  }
}

export function statusToFailure(status: number): RefreshFailureCode | null {
  if (status >= 200 && status < 300) return null
  if (status === 401 || status === 403) return "invalidCredential"
  if (status === 429) return "rateLimited"
  if (status === 402 || status === 404) return "subscriptionRequired"
  return "server"
}

export function toFiniteNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val
  if (typeof val === "string" && val.trim() !== "") {
    const parsed = Number(val.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function normalizeEpochDate(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim()) {
    const num = Number(val.trim())
    if (Number.isFinite(num) && num > 0) {
      const ms = num >= 100_000_000_000 ? num : num * 1000
      return new Date(ms).toISOString()
    }
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    const ms = val >= 100_000_000_000 ? val : val * 1000
    return new Date(ms).toISOString()
  }
  return undefined
}

export async function fetchJsonStrict(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    allowSameOriginRedirect?: boolean
  } = {}
): Promise<Record<string, unknown>> {
  const originURL = new URL(url)
  let resp
  try {
    resp = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
      body: options.body,
      timeout: 15,
      handleRedirect: async (req) => {
        if (!options.allowSameOriginRedirect) {
          return null
        }
        try {
          const target = new URL(req.url)
          if (
            target.protocol === originURL.protocol &&
            target.host.toLowerCase() === originURL.host.toLowerCase()
          ) {
            return req
          }
        } catch {
          // 拒绝异常重定向
        }
        return null
      },
    })
  } catch (err) {
    throw new QuotaQueryError(
      "network",
      err instanceof Error ? err.message : "网络请求失败"
    )
  }

  const failure = statusToFailure(resp.status)
  if (failure) {
    throw new QuotaQueryError(failure, `HTTP ${resp.status}`)
  }

  try {
    const data = await resp.json()
    if (data && typeof data === "object") {
      return data as Record<string, unknown>
    }
    throw new QuotaQueryError("unreadableResponse", "响应非 JSON 对象")
  } catch (err) {
    if (err instanceof QuotaQueryError) throw err
    throw new QuotaQueryError("unreadableResponse", "解析 JSON 失败")
  }
}

export function buildSessionOrTokenHeaders(
  envelope: ProviderCredentialEnvelope,
  customAuthHeaderName?: string
): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = envelope.accessToken.trim()

  if (customAuthHeaderName) {
    headers[customAuthHeaderName] = token
    return headers
  }

  if (envelope.kind === "session") {
    if (token.includes("=")) {
      headers.Cookie = token
    } else {
      headers.Authorization = `Bearer ${token}`
    }
    if (envelope.metadata.bearerToken) {
      headers.Authorization = `Bearer ${envelope.metadata.bearerToken}`
    }
  } else {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

export async function queryStandardEndpoint(params: {
  accountID: string
  envelope: ProviderCredentialEnvelope
  collectedAt: string
  url: string
  method?: "GET" | "POST"
  customAuthHeaderName?: string
  defaultCurrency?: string
}): Promise<QuotaSnapshot> {
  const {
    accountID,
    envelope,
    collectedAt,
    url,
    method = "GET",
    customAuthHeaderName,
    defaultCurrency,
  } = params

  const headers = buildSessionOrTokenHeaders(envelope, customAuthHeaderName)
  if (method === "POST") {
    headers["Content-Type"] = "application/json"
  }

  const json = await fetchJsonStrict(url, {
    method,
    headers,
    body: method === "POST" ? "{}" : undefined,
  })

  return parseGenericBalanceOrQuotaJson(
    accountID,
    envelope.provider,
    json,
    collectedAt,
    defaultCurrency
  )
}

export async function queryStandardGateway(params: {
  accountID: string
  envelope: ProviderCredentialEnvelope
  collectedAt: string
  path: string
}): Promise<QuotaSnapshot> {
  const { accountID, envelope, collectedAt, path } = params
  const base = normalizeGatewayServerAddress(
    envelope.metadata.serverAddress ?? ""
  )
  const token = envelope.accessToken.trim()
  const json = await fetchJsonStrict(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": token,
    },
    allowSameOriginRedirect: true,
  })
  return parseGenericBalanceOrQuotaJson(
    accountID,
    envelope.provider,
    json,
    collectedAt
  )
}

export function parseGenericBalanceOrQuotaJson(
  accountID: string,
  provider: ProviderId,
  root: Record<string, unknown>,
  collectedAt: string,
  defaultCurrency = "USD"
): QuotaSnapshot {
  const data =
    (root.data as Record<string, unknown> | undefined) ??
    (root.result as Record<string, unknown> | undefined) ??
    root

  const windows: QuotaWindow[] = []
  const currency = String(
    data.currency ?? root.currency ?? data.unit ?? defaultCurrency
  ).toUpperCase()
  const isMonetary = ["USD", "CNY", "EUR", "GBP", "JPY", "HKD"].includes(
    currency
  )

  const limit = toFiniteNumber(
    data.limit ??
      data.max_budget ??
      data.hard_limit ??
      data.total_quota ??
      data.quota_limit ??
      data.total
  )
  const used = toFiniteNumber(
    data.used ??
      data.spend ??
      data.usage ??
      data.current_usage ??
      data.used_quota
  )
  const remaining = toFiniteNumber(
    data.remaining ?? data.remaining_quota ?? data.left
  )

  if (limit !== undefined && limit > 0) {
    const actualUsed =
      used ?? (remaining !== undefined ? Math.max(limit - remaining, 0) : 0)
    const actualRem = remaining ?? Math.max(limit - actualUsed, 0)
    windows.push({
      id: `${provider}.quota`,
      name: "周期可用配额",
      usedPercentage: Math.min(Math.max((actualUsed / limit) * 100, 0), 100),
      isExhausted: actualRem <= 0 || actualUsed >= limit,
      exactCounts: {
        used: actualUsed,
        remaining: actualRem,
        total: limit,
      },
      unit: currency,
      resetsAt: normalizeEpochDate(
        data.reset_at ?? data.resets_at ?? data.next_reset_at
      ),
      expiresAt: normalizeEpochDate(data.expires_at ?? data.expired_at),
    })
  }

  const balance = toFiniteNumber(
    data.balance ??
      data.total_balance ??
      data.available_balance ??
      data.credits ??
      data.credit_balance ??
      (limit === undefined ? remaining : undefined)
  )

  if (balance !== undefined) {
    windows.push({
      id: `${provider}.wallet`,
      name: isMonetary ? "API 钱包余额" : `可用 ${currency}`,
      unit: currency,
      wallet: {
        currency,
        total: balance,
        isMonetary,
      },
    })
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  const meta = getProviderMeta(provider)
  const planName =
    typeof data.plan === "string"
      ? data.plan
      : typeof data.planName === "string"
        ? data.planName
        : typeof data.tier === "string"
          ? data.tier
          : meta.loginMethod === "apiKey"
            ? "API"
            : "Pro"

  return {
    accountID,
    collectedAt,
    providerPlanName: planName,
    windows,
  }
}
