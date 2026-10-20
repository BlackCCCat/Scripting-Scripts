import { fetch, Response } from "scripting"
import {
  ProviderQuotaHandler,
  QuotaPeriod,
  QuotaWindow,
} from "../models/types"
import { saveEnvelopeToKeychain } from "../utils/credential_store"
import { tryExtractIdentityFromJWT } from "../utils/theme"
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
} from "../services/provider_auth"
import { QuotaQueryError } from "./_shared/http"

export type JsonObject = Record<string, unknown>

export type AntigravityProjectInfo = {
  projectId: string | null
  planLabel: string | null
  tierId: string | null
}

type UpstreamError = Error & { status?: number }

function upstreamError(message: string, status?: number): UpstreamError {
  const error = new Error(message) as UpstreamError
  error.status = status
  return error
}

// 依照 lbjlaq/Antigravity-Manager:
// 端点顺序优先 Daily 环境（支持最新 Gemini 4 Argon 模型及配额组），其次 Sandbox，最后 Prod
const CLOUD_CODE_LOAD_PROJECT_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
] as const

const QUOTA_SUMMARY_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
] as const

const QUOTA_API_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
] as const

// 依照 lbjlaq/Antigravity-Manager (Ref #3665):
// 切换为 Hub 官方标识，支持 Gemini 4 Argon 发现与正确分桶配额返回
const CLIENT_USER_AGENT =
  "antigravity/hub/2.23.1 (aidev_client; os_type=darwin; arch=arm64; cl=998881661)"
const CLIENT_ID = GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = GOOGLE_OAUTH_CLIENT_SECRET
const TOKEN_URL = "https://oauth2.googleapis.com/token"

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": CLIENT_USER_AGENT,
  }
}

export function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function firstValue(object: JsonObject | null, keys: string[]): unknown {
  for (const key of keys) {
    if (object && key in object) return object[key]
  }
  return undefined
}

function parseFraction(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value))
  }
  if (typeof value !== "string" || !value.trim()) return null
  const raw = value.trim()
  const percent = raw.endsWith("%")
  const parsed = Number(percent ? raw.slice(0, -1) : raw)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(1, percent ? parsed / 100 : parsed))
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  let ms: number
  if (typeof value === "number") {
    ms = value > 1e12 ? value : value * 1000
  } else {
    const numeric = Number(value)
    ms = Number.isFinite(numeric)
      ? numeric > 1e12
        ? numeric
        : numeric * 1000
      : new Date(value).getTime()
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

async function parseResponse(response: Response): Promise<JsonObject> {
  const text = await response.text()
  try {
    const payload = asObject(JSON.parse(text))
    if (payload) return payload
  } catch {
    /* handled below */
  }
  throw upstreamError(
    `Antigravity 响应不是合法 JSON（HTTP ${response.status}）`,
    response.status
  )
}

/**
 * 解析项目信息与订阅等级
 * 对应 lbjlaq/Antigravity-Manager 中的 fetch_project_id 优先级
 */
export function parseProjectInfo(payload: JsonObject): AntigravityProjectInfo {
  const projectValue = payload.cloudaicompanionProject
  const projectObject = asObject(projectValue)
  const projectId =
    typeof projectValue === "string" && projectValue.trim()
      ? projectValue.trim()
      : typeof projectObject?.id === "string" && projectObject.id.trim()
        ? projectObject.id.trim()
        : null

  const paidTier = asObject(payload.paidTier)
  const currentTier = asObject(payload.currentTier)
  const allowedTiers = Array.isArray(payload.allowedTiers)
    ? payload.allowedTiers
    : []

  const rawTier =
    (paidTier?.id as string) ||
    (paidTier?.name as string) ||
    (currentTier?.id as string) ||
    (currentTier?.name as string) ||
    (allowedTiers.find((t) => asObject(t)?.id === "free-tier" || asObject(t)?.isDefault) as JsonObject)?.id ||
    "free-tier"

  const rawLower = String(rawTier).toLowerCase()
  let planLabel = "Google AI Pro"
  let tierId = "pro"

  if (rawLower.includes("ultra") || rawLower.includes("helium")) {
    planLabel = "Google AI Ultra"
    tierId = "ultra"
  } else if (rawLower.includes("free") || rawLower.includes("starter")) {
    planLabel = "Antigravity Starter (Free)"
    tierId = "free"
  } else {
    planLabel = "Google AI Pro"
    tierId = "pro"
  }

  return { projectId, planLabel, tierId }
}

export async function fetchAccountInfo(
  accessToken: string,
  timeout = 15
): Promise<AntigravityProjectInfo> {
  let saw401 = false
  for (const endpoint of CLOUD_CODE_LOAD_PROJECT_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify({
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
        timeout,
        debugLabel: "AntigravityAccountInfo",
      })
      if (response.ok) {
        const json = await parseResponse(response)
        return parseProjectInfo(json)
      }
      if (response.status === 401) {
        saw401 = true
      }
      // 依照 Antigravity-Manager: 非 200 (如 403/404) 降级尝试下一个候选端点 (Daily -> Sandbox -> Prod)
    } catch {
      // 网络异常，尝试下一个端点
    }
  }
  if (saw401) {
    throw upstreamError("Antigravity 认证已失效 (401)", 401)
  }
  return { projectId: null, planLabel: "Google AI Pro", tierId: "pro" }
}

async function postWithEndpoints(
  endpoints: readonly string[],
  token: string,
  projectId: string | null,
  timeout = 15
): Promise<{ data: JsonObject | null; saw401: boolean }> {
  let saw401 = false
  for (const endpoint of endpoints) {
    const bodies = projectId ? [{ project: projectId }, {}] : [{}]
    for (const body of bodies) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(body),
          timeout,
          debugLabel: "AntigravityQuotaRequest",
        })
        if (response.ok) {
          const json = await parseResponse(response)
          if (json) return { data: json, saw401: false }
        }
        if (response.status === 401) {
          saw401 = true
        }
        // 依照 Antigravity-Manager: 遇到 403/404/5xx 等不要提前中断抛出，继续尝试备选端点 (Daily -> Sandbox -> Prod)
      } catch {
        // 网络异常，尝试下一个端点
      }
    }
  }
  return { data: null, saw401 }
}

type ParsedBucket = {
  bucketId: string
  window: string
  remainingFraction: number
  resetTime: string | null
}

type ParsedModel = {
  id: string
  displayName: string
  remainingFraction: number
  percentage: number
  resetTime: string | null
}

/**
 * 依据 lbjlaq/Antigravity-Manager (quota.rs 与 quotaDisplay.ts)
 * 提取 Gemini（5H + 周）、Claude/GPT（5H + 周）、Gemini 4 Argon（周）共 5 个独立配额进度条
 */
export function extractFourQuotaWindows(
  summaryPayload: JsonObject | null,
  modelsPayload: JsonObject | null,
  tier: string = "pro"
): QuotaWindow[] {
  const isFreeTier = tier === "free"

  // 1. 解析 retrieveUserQuotaSummary 里的 groups
  const rawGroups = summaryPayload
    ? firstValue(summaryPayload, ["groups", "quotaGroups", "quota_groups"])
    : null
  const groups = Array.isArray(rawGroups) ? (rawGroups as JsonObject[]) : []

  // 2. 解析 fetchAvailableModels 里的 models
  const rawModels = modelsPayload
    ? asObject(modelsPayload.models) || modelsPayload
    : null
  const models: ParsedModel[] = []
  if (rawModels) {
    for (const [rawId, rawVal] of Object.entries(rawModels)) {
      const id = rawId.toLowerCase().trim().replace(/^models\//, "")
      const obj = asObject(rawVal)
      if (!id || !obj || id.startsWith("chat_") || id.startsWith("tab_")) continue
      const q = asObject(firstValue(obj, ["quotaInfo", "quota_info"]))
      const frac = parseFraction(
        firstValue(q, ["remainingFraction", "remaining_fraction", "remaining"])
      )
      const reset = parseDate(firstValue(q, ["resetTime", "reset_time"]))
      const disp =
        textValue(firstValue(obj, ["displayName", "display_name", "modelName"])) ||
        id
      // 对应 Antigravity-Manager: 若缺失则 unwrap_or(0)，绝不默认 1.0 (100%)
      const percentage = frac != null ? Math.round(frac * 100) : 0
      models.push({
        id,
        displayName: disp,
        remainingFraction: frac != null ? frac : 0,
        percentage,
        resetTime: reset,
      })
    }
  }

  // 3. [FIX #3426] Fuse real bucket quotas into models so UI doesn't show fake 100%
  // 对应 Antigravity-Manager: 将 retrieveUserQuotaSummary 的真实分桶配额深度融合到 models 中
  if (groups.length > 0) {
    for (const model of models) {
      const nameLower = model.id.toLowerCase()
      const isArgon = /argon|gemini[\s_-]?4/i.test(nameLower)
      const isClaudeOrGpt =
        !isArgon && (/^claude/i.test(nameLower) || /^gpt/i.test(nameLower))
      const isGemini = !isArgon && /^gemini/i.test(nameLower)

      for (const group of groups) {
        const gName = (
          textValue(firstValue(group, ["displayName", "display_name"])) || ""
        ).toLowerCase()
        const bList = Array.isArray(group.buckets)
          ? (group.buckets as JsonObject[])
          : []
        const hasArgonBucket = bList.some((b) =>
          /argon|gemini[\s_-]?4/i.test(
            `${textValue(firstValue(b, ["bucketId", "bucket_id"])) || ""} ${textValue(firstValue(b, ["displayName", "display_name"])) || ""}`
          )
        )
        const isArgonGroup = /argon|gemini[\s_-]?4/i.test(gName) || hasArgonBucket
        const isClaudeGroup =
          !isArgonGroup &&
          (/claude|gpt|3p/i.test(gName) ||
            bList.some((b) =>
              String(firstValue(b, ["bucketId", "bucket_id"]) || "")
                .toLowerCase()
                .includes("3p")
            ))
        const isGeminiGroup =
          !isArgonGroup &&
          !isClaudeGroup &&
          (/gemini/i.test(gName) || !/claude|gpt|3p/i.test(gName))

        const matchesGroup = isArgon
          ? isArgonGroup
          : isClaudeOrGpt
            ? isClaudeGroup
            : isGemini
              ? isGeminiGroup
              : false

        if (matchesGroup && bList.length > 0) {
          const parsedBuckets: ParsedBucket[] = bList.map((b) => ({
            bucketId:
              textValue(firstValue(b, ["bucketId", "bucket_id", "id"])) || "",
            window: textValue(b.window) || "",
            remainingFraction:
              parseFraction(
                firstValue(b, [
                  "remainingFraction",
                  "remaining_fraction",
                  "remaining",
                ])
              ) ?? 0,
            resetTime: parseDate(firstValue(b, ["resetTime", "reset_time"])),
          }))

          const b5h = parsedBuckets.find((b) =>
            /5h|hour/i.test(`${b.window} ${b.bucketId}`)
          )
          const bWeekly = parsedBuckets.find((b) =>
            /week|7d/i.test(`${b.window} ${b.bucketId}`)
          )

          const chosen =
            bWeekly && bWeekly.remainingFraction <= 0.001
              ? bWeekly
              : b5h && bWeekly
                ? b5h.remainingFraction <= bWeekly.remainingFraction
                  ? b5h
                  : bWeekly
                : b5h || bWeekly || parsedBuckets[0]

          if (chosen) {
            model.remainingFraction = chosen.remainingFraction
            model.percentage = Math.round(chosen.remainingFraction * 100)
            if (chosen.resetTime) {
              model.resetTime = chosen.resetTime
            }
            break
          }
        }
      }
    }
  }

  // 4. 实现 Antigravity-Manager 的 getGroupQuotaSummaries 纯函数
  const findGroupBuckets = (
    target: "gemini" | "claude" | "argon"
  ): ParsedBucket[] => {
    return groups
      .filter((group) => {
        const groupName = (
          textValue(firstValue(group, ["displayName", "display_name"])) || ""
        ).toLowerCase()
        const bList = Array.isArray(group.buckets)
          ? (group.buckets as JsonObject[])
          : []
        const hasArgonBucket = bList.some((b) =>
          /argon|gemini[\s_-]?4/i.test(
            `${textValue(firstValue(b, ["bucketId", "bucket_id"])) || ""} ${textValue(firstValue(b, ["displayName", "display_name"])) || ""}`
          )
        )
        const isArgon = /argon|gemini[\s_-]?4/i.test(groupName) || hasArgonBucket
        if (target === "argon") return isArgon
        if (isArgon) return false

        const isThirdParty =
          /claude|gpt|3p/i.test(groupName) ||
          bList.some((b) =>
            String(
              firstValue(b, ["bucketId", "bucket_id"]) || ""
            )
              .toLowerCase()
              .includes("3p")
          )
        return target === "claude" ? isThirdParty : !isThirdParty
      })
      .flatMap((group) => {
        const bList = Array.isArray(group.buckets)
          ? (group.buckets as JsonObject[])
          : []
        return bList.map((b) => ({
          bucketId:
            textValue(firstValue(b, ["bucketId", "bucket_id", "id"])) || "",
          window: textValue(b.window) || "",
          remainingFraction:
            parseFraction(
              firstValue(b, [
                "remainingFraction",
                "remaining_fraction",
                "remaining",
              ])
            ) ?? 0,
          resetTime: parseDate(firstValue(b, ["resetTime", "reset_time"])),
        }))
      })
  }

  type GroupQuotaItem = {
    percentage: number
    resetTime?: string
  }

  type GroupQuotaSummary = {
    key: "gemini" | "claude" | "argon"
    label: string
    fiveHour?: GroupQuotaItem
    weekly?: GroupQuotaItem
    isWeeklyConstrained: boolean
    isWeeklyExhausted: boolean
  }

  const buildGroup = (key: "gemini" | "claude" | "argon"): GroupQuotaSummary => {
    const buckets = findGroupBuckets(key)

    const fiveHourBucket = buckets
      .filter((b) => /5h|hour/i.test(`${b.window} ${b.bucketId}`))
      .reduce<ParsedBucket | undefined>(
        (chosen, b) =>
          !chosen || b.remainingFraction < chosen.remainingFraction
            ? b
            : chosen,
        undefined
      )

    const weeklyBucket = buckets
      .filter((b) => /week|7d/i.test(`${b.window} ${b.bucketId}`))
      .reduce<ParsedBucket | undefined>(
        (chosen, b) =>
          !chosen || b.remainingFraction < chosen.remainingFraction
            ? b
            : chosen,
        undefined
      )

    let fallback5h: GroupQuotaItem | undefined = undefined
    let fallbackWeekly: GroupQuotaItem | undefined = undefined

    if (models.length > 0) {
      const matched = models.filter((m) => {
        const n = m.id.toLowerCase()
        const isArgon =
          /argon|gemini[\s_-]?4/i.test(n) ||
          /argon|gemini[\s_-]?4/i.test(m.displayName)
        if (key === "argon") return isArgon
        if (isArgon) return false
        return key === "claude"
          ? n.startsWith("claude") || n.startsWith("gpt")
          : n.startsWith("gemini")
      })

      if (matched.length > 0) {
        const now = Date.now()
        const fiveHourModels = matched.filter((m) => {
          if (!m.resetTime) return false
          const diffMs = Date.parse(m.resetTime) - now
          return diffMs > 0 && diffMs <= 6 * 3600 * 1000
        })
        const weeklyModels = matched.filter((m) => {
          if (!m.resetTime) return false
          const diffMs = Date.parse(m.resetTime) - now
          return diffMs > 6 * 3600 * 1000
        })

        if (fiveHourModels.length > 0) {
          const min5h = fiveHourModels.reduce(
            (prev, curr) => (curr.percentage < prev.percentage ? curr : prev),
            fiveHourModels[0]
          )
          fallback5h = {
            percentage: min5h.percentage,
            resetTime: min5h.resetTime || undefined,
          }
        }

        if (weeklyModels.length > 0) {
          const minWeekly = weeklyModels.reduce(
            (prev, curr) => (curr.percentage < prev.percentage ? curr : prev),
            weeklyModels[0]
          )
          fallbackWeekly = {
            percentage: minWeekly.percentage,
            resetTime: minWeekly.resetTime || undefined,
          }
        } else if (matched.length > 0 && !fiveHourModels.length) {
          const minModel = matched.reduce(
            (prev, curr) => (curr.percentage < prev.percentage ? curr : prev),
            matched[0]
          )
          if (isFreeTier || key === "argon") {
            fallbackWeekly = {
              percentage: minModel.percentage,
              resetTime: minModel.resetTime || undefined,
            }
          } else {
            fallback5h = {
              percentage: minModel.percentage,
              resetTime: minModel.resetTime || undefined,
            }
          }
        }
      }
    }

    // Free 账号在官方架构下只有周额度，没有 5H 额度
    const raw5h =
      !isFreeTier && fiveHourBucket
        ? Math.round(fiveHourBucket.remainingFraction * 100)
        : !isFreeTier && fallback5h
          ? fallback5h.percentage
          : undefined

    const effectiveArgonBucket =
      weeklyBucket ||
      (key === "argon" && !fiveHourBucket && buckets.length > 0
        ? buckets[0]
        : undefined)

    const rawWeekly = effectiveArgonBucket
      ? Math.round(effectiveArgonBucket.remainingFraction * 100)
      : fallbackWeekly
        ? fallbackWeekly.percentage
        : isFreeTier && fallback5h
          ? fallback5h.percentage
          : undefined

    const weeklyResetTime =
      effectiveArgonBucket?.resetTime ||
      fallbackWeekly?.resetTime ||
      (isFreeTier ? fallback5h?.resetTime : undefined)
    const fiveHourResetTime = isFreeTier
      ? undefined
      : fiveHourBucket?.resetTime || fallback5h?.resetTime

    const effectiveWeekly = rawWeekly
    const effectiveWeeklyResetTime = weeklyResetTime

    const isWeeklyExhausted =
      effectiveWeekly !== undefined && effectiveWeekly <= 0
    const isWeeklyConstrained =
      isWeeklyExhausted ||
      (effectiveWeekly !== undefined &&
        raw5h !== undefined &&
        effectiveWeekly < raw5h)

    const defaultLabel =
      key === "argon"
        ? "Gemini 4 Argon"
        : key === "claude"
          ? "Claude / GPT"
          : "Gemini"

    return {
      key,
      label: defaultLabel,
      fiveHour:
        raw5h !== undefined
          ? {
              percentage: isWeeklyExhausted ? 0 : raw5h,
              resetTime: isWeeklyExhausted
                ? effectiveWeeklyResetTime
                : fiveHourResetTime,
            }
          : undefined,
      weekly:
        effectiveWeekly !== undefined
          ? {
              percentage: effectiveWeekly,
              resetTime: effectiveWeeklyResetTime,
            }
          : undefined,
      isWeeklyConstrained,
      isWeeklyExhausted,
    }
  }

  const geminiSummary = buildGroup("gemini")
  const claudeSummary = buildGroup("claude")
  const argonSummary = buildGroup("argon")

  const formatWindowFromItem = (
    id: string,
    name: string,
    period: QuotaPeriod,
    item: GroupQuotaItem | undefined,
    isExhaustedFallback = false
  ): QuotaWindow => {
    const remainingPct = item
      ? Math.max(0, Math.min(100, Math.round(item.percentage)))
      : 0
    const usedPct = 100 - remainingPct
    const isExhausted = isExhaustedFallback || remainingPct <= 0
    return {
      id,
      name,
      period,
      usedPercentage: usedPct,
      remainingCount: remainingPct,
      totalCount: 100,
      unit: "%",
      resetsAt: item?.resetTime || undefined,
      isExhausted,
    }
  }

  const resultWindows: QuotaWindow[] = [
    formatWindowFromItem(
      "antigravity:gemini_5h",
      "Gemini 5小时",
      "fiveHour",
      geminiSummary.fiveHour,
      geminiSummary.isWeeklyExhausted
    ),
    formatWindowFromItem(
      "antigravity:gemini_weekly",
      "Gemini 周配额",
      "weekly",
      geminiSummary.weekly,
      geminiSummary.isWeeklyExhausted
    ),
    formatWindowFromItem(
      "antigravity:claude_5h",
      "Claude / GPT 5小时",
      "fiveHour",
      claudeSummary.fiveHour,
      claudeSummary.isWeeklyExhausted
    ),
    formatWindowFromItem(
      "antigravity:claude_weekly",
      "Claude / GPT 周配额",
      "weekly",
      claudeSummary.weekly,
      claudeSummary.isWeeklyExhausted
    ),
    formatWindowFromItem(
      "antigravity:argon_weekly",
      "Gemini 4 Argon",
      "weekly",
      argonSummary.weekly || argonSummary.fiveHour,
      argonSummary.isWeeklyExhausted
    ),
  ]

  return resultWindows
}

async function refreshAntigravityToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      timeout: 20,
      debugLabel: "AntigravityTokenRefresh",
    })
    if (!response.ok) return null
    const json = (await response.json()) as Record<string, unknown>
    const accessToken =
      typeof json.access_token === "string" ? json.access_token : null
    if (!accessToken) return null
    const newRefresh =
      typeof json.refresh_token === "string" ? json.refresh_token : undefined
    return { accessToken, refreshToken: newRefresh }
  } catch {
    return null
  }
}

export const queryAntigravityQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  let token = envelope.accessToken.trim()
  let projectId = envelope.metadata.projectId || null
  let planLabel = envelope.metadata.planLabel || null
  let tierId = envelope.metadata.tierId || "pro"

  const runFetch = async (
    authToken: string
  ): Promise<{
    projectInfo: AntigravityProjectInfo
    windows: QuotaWindow[]
  }> => {
    // 1. 获取账号权威信息（项目 ID 与 订阅等级）
    const info = await fetchAccountInfo(authToken, 15)
    const effectivePid = info.projectId || projectId
    const effectiveTier = info.tierId || tierId

    // 2. 并行拉取配额摘要 (retrieveUserQuotaSummary) 与可用模型 (fetchAvailableModels)
    const [summaryResult, modelsResult] = await Promise.all([
      postWithEndpoints(QUOTA_SUMMARY_ENDPOINTS, authToken, effectivePid, 15),
      postWithEndpoints(QUOTA_API_ENDPOINTS, authToken, effectivePid, 15),
    ])

    if (summaryResult.saw401 || modelsResult.saw401) {
      throw upstreamError("Antigravity 认证已过期 (401)", 401)
    }

    const summaryRes = summaryResult.data
    const modelsRes = modelsResult.data

    if (!summaryRes && !modelsRes) {
      throw upstreamError("Antigravity 配额接口未响应有效数据")
    }

    // 3. 提取核心进度条（Gemini 5H/周、Claude 5H/周、Gemini 4 Argon）
    const quotaWindows = extractFourQuotaWindows(summaryRes, modelsRes, effectiveTier)
    return { projectInfo: info, windows: quotaWindows }
  }

  let fetchResult: {
    projectInfo: AntigravityProjectInfo
    windows: QuotaWindow[]
  }

  try {
    fetchResult = await runFetch(token)
  } catch (err) {
    const status = (err as UpstreamError)?.status
    if (status === 401 && envelope.refreshToken) {
      const refreshed = await refreshAntigravityToken(envelope.refreshToken)
      if (refreshed) {
        token = refreshed.accessToken
        envelope.accessToken = refreshed.accessToken
        if (refreshed.refreshToken) {
          envelope.refreshToken = refreshed.refreshToken
        }
        const keychainKey =
          envelope.metadata.keychainKey || `ai_dashboard.cred.${accountID}`
        saveEnvelopeToKeychain(keychainKey, envelope, false)
        fetchResult = await runFetch(token)
      } else {
        throw new QuotaQueryError(
          "invalidCredential",
          "Google Antigravity 授权已失效，请重新登录"
        )
      }
    } else if (status === 401 || status === 403) {
      throw new QuotaQueryError(
        "invalidCredential",
        "Google Antigravity 授权已失效或该账号无权读取用量"
      )
    } else if (status === 429) {
      throw new QuotaQueryError("rateLimited", "Antigravity 请求受限，请稍后再试")
    } else {
      throw new QuotaQueryError(
        "network",
        err instanceof Error ? err.message : "Antigravity 用量请求失败"
      )
    }
  }

  const { projectInfo, windows } = fetchResult

  if (projectInfo.projectId) {
    envelope.metadata.projectId = projectInfo.projectId
  }
  if (projectInfo.planLabel) {
    envelope.metadata.planLabel = projectInfo.planLabel
    planLabel = projectInfo.planLabel
  }
  if (projectInfo.tierId) {
    envelope.metadata.tierId = projectInfo.tierId
  }

  const accountIdentity =
    envelope.metadata.accountEmail ||
    envelope.metadata.email ||
    tryExtractIdentityFromJWT(token) ||
    projectInfo.projectId ||
    projectId ||
    undefined

  return {
    accountID,
    collectedAt,
    providerPlanName: planLabel || "Google AI Pro",
    accountIdentity,
    sourceCredentialFingerprint: envelope.metadata.sourceCredentialFingerprint,
    windows,
  }
}
