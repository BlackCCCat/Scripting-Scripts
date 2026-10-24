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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
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
 * 依据 Google Cloud Code PA API (retrieveUserQuotaSummary 与 fetchAvailableModels)
 * 动态提取账号实际开通/有权限的模型配额进度条：
 * - 基础 Gemini（5H + 周）
 * - Claude / GPT（5H + 周，仅在账号开通时展示）
 * - 动态高级/未来模型（如 Gemini 4 Argon、Gemini 5 等，完全依据账号实际返回的配额分组动态自适应）
 * 若账号未获得某个模型的可用权限，绝不无中生有，避免小组件与总消耗量被虚假数据污染。
 */
export function extractFourQuotaWindows(
  summaryPayload: JsonObject | null,
  modelsPayload: JsonObject | null,
  tier: string = "pro"
): QuotaWindow[] {
  const isFreeTier = tier === "free"

  // 1. 解析 retrieveUserQuotaSummary 里的 groups（最权威的账号配额分组）
  const rawGroups = summaryPayload
    ? firstValue(summaryPayload, ["groups", "quotaGroups", "quota_groups"])
    : null
  const groups = Array.isArray(rawGroups) ? (rawGroups as JsonObject[]) : []

  // 2. 解析 fetchAvailableModels 里的 models（只收录明确具有 quotaInfo 与有效 fraction 的可用模型）
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
      if (!q) continue // 若无 quotaInfo，说明当前账号无权使用此模型，直接过滤
      const frac = parseFraction(
        firstValue(q, ["remainingFraction", "remaining_fraction", "remaining"])
      )
      if (frac === null) continue // 若无有效配额数值，直接过滤
      const reset = parseDate(firstValue(q, ["resetTime", "reset_time"]))
      const disp =
        textValue(firstValue(obj, ["displayName", "display_name", "modelName"])) ||
        id
      const percentage = Math.round(frac * 100)
      models.push({
        id,
        displayName: disp,
        remainingFraction: frac,
        percentage,
        resetTime: reset,
      })
    }
  }

  type ExtractedQuotaGroup = {
    rawName: string
    displayName: string
    isBaseGemini: boolean
    isClaudeOrGpt: boolean
    isArgon: boolean
    fiveHour?: ParsedBucket
    weekly?: ParsedBucket
  }

  const extractedGroups: ExtractedQuotaGroup[] = []

  // 3. 优先使用 retrieveUserQuotaSummary 的权威 groups 数据
  if (groups.length > 0) {
    for (const g of groups) {
      const rawName =
        textValue(firstValue(g, ["displayName", "display_name", "name", "id"])) ||
        "配额"
      const bList = Array.isArray(g.buckets) ? (g.buckets as JsonObject[]) : []
      const parsedBuckets: ParsedBucket[] = bList.map((b) => ({
        bucketId: textValue(firstValue(b, ["bucketId", "bucket_id", "id"])) || "",
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

      if (parsedBuckets.length === 0) continue

      const fiveHourBucket = parsedBuckets
        .filter((b) => /5h|hour/i.test(`${b.window} ${b.bucketId}`))
        .reduce<ParsedBucket | undefined>(
          (chosen, b) =>
            !chosen || b.remainingFraction < chosen.remainingFraction
              ? b
              : chosen,
          undefined
        )

      const weeklyBucket =
        parsedBuckets
          .filter((b) => /week|7d/i.test(`${b.window} ${b.bucketId}`))
          .reduce<ParsedBucket | undefined>(
            (chosen, b) =>
              !chosen || b.remainingFraction < chosen.remainingFraction
                ? b
                : chosen,
            undefined
          ) ||
        (!fiveHourBucket && parsedBuckets.length > 0 ? parsedBuckets[0] : undefined)

      const nameLower = rawName.toLowerCase()
      const has3pBucket = parsedBuckets.some((b) =>
        b.bucketId.toLowerCase().includes("3p")
      )
      const isClaudeOrGpt =
        /claude|gpt|3p/i.test(nameLower) || has3pBucket

      const hasArgonBucket = parsedBuckets.some((b) =>
        /argon|gemini[\s_-]?4/i.test(`${b.bucketId} ${b.window}`)
      )
      const isArgon = /argon|gemini[\s_-]?4/i.test(nameLower) || hasArgonBucket

      // 区分具体特化/高级模型（如 Gemini 4 Argon, Gemini 5, Gemini Ultra 等）与标准基础 Gemini
      const isSpecificAdvancedGemini =
        isArgon || /gemini[\s_-]?[0-9]|argon|ultra/i.test(nameLower)

      // 基础 Gemini 分组：仅指标准 Gemini 基础配额池
      const isBaseGemini =
        !isClaudeOrGpt &&
        !isSpecificAdvancedGemini &&
        (/gemini/i.test(nameLower) || !isClaudeOrGpt)

      const dispName = isArgon
        ? "Gemini 4 Argon"
        : isBaseGemini
          ? "Gemini"
          : isClaudeOrGpt
            ? "Claude / GPT"
            : rawName

      extractedGroups.push({
        rawName,
        displayName: dispName,
        isBaseGemini,
        isClaudeOrGpt,
        isArgon,
        fiveHour: fiveHourBucket,
        weekly: weeklyBucket,
      })
    }
  } else if (models.length > 0) {
    // 4. 只有当 retrieveUserQuotaSummary 完全未返回 groups 时，才允许从 models 列表兜底推导配额
    const now = Date.now()

    const buildFallbackGroup = (
      matchedModels: ParsedModel[],
      rawName: string,
      displayName: string,
      isBaseGemini: boolean,
      isClaudeOrGpt: boolean,
      isArgon: boolean
    ) => {
      if (matchedModels.length === 0) return

      const fiveHourModels = matchedModels.filter((m) => {
        if (!m.resetTime) return false
        const diffMs = Date.parse(m.resetTime) - now
        return diffMs > 0 && diffMs <= 6 * 3600 * 1000
      })
      const weeklyModels = matchedModels.filter((m) => {
        if (!m.resetTime) return false
        const diffMs = Date.parse(m.resetTime) - now
        return diffMs > 6 * 3600 * 1000
      })

      let f5h: ParsedBucket | undefined
      let fWeekly: ParsedBucket | undefined

      if (fiveHourModels.length > 0) {
        const min5h = fiveHourModels.reduce(
          (prev, curr) => (curr.percentage < prev.percentage ? curr : prev),
          fiveHourModels[0]
        )
        f5h = {
          bucketId: min5h.id,
          window: "5h",
          remainingFraction: min5h.remainingFraction,
          resetTime: min5h.resetTime,
        }
      }

      if (weeklyModels.length > 0) {
        const minWeekly = weeklyModels.reduce(
          (prev, curr) => (curr.percentage < prev.percentage ? curr : prev),
          weeklyModels[0]
        )
        fWeekly = {
          bucketId: minWeekly.id,
          window: "weekly",
          remainingFraction: minWeekly.remainingFraction,
          resetTime: minWeekly.resetTime,
        }
      } else if (matchedModels.length > 0 && !fiveHourModels.length) {
        const minModel = matchedModels.reduce(
          (prev, curr) => (curr.percentage < prev.percentage ? curr : prev),
          matchedModels[0]
        )
        if (isFreeTier || isArgon) {
          fWeekly = {
            bucketId: minModel.id,
            window: "weekly",
            remainingFraction: minModel.remainingFraction,
            resetTime: minModel.resetTime,
          }
        } else {
          f5h = {
            bucketId: minModel.id,
            window: "5h",
            remainingFraction: minModel.remainingFraction,
            resetTime: minModel.resetTime,
          }
        }
      }

      extractedGroups.push({
        rawName,
        displayName,
        isBaseGemini,
        isClaudeOrGpt,
        isArgon,
        fiveHour: f5h,
        weekly: fWeekly,
      })
    }

    // Gemini
    const geminiModels = models.filter((m) => {
      const n = m.id.toLowerCase()
      const isArgon =
        /argon|gemini[\s_-]?4/i.test(n) ||
        /argon|gemini[\s_-]?4/i.test(m.displayName)
      return !isArgon && n.startsWith("gemini")
    })
    buildFallbackGroup(geminiModels, "Gemini", "Gemini", true, false, false)

    // Claude / GPT
    const claudeModels = models.filter((m) => {
      const n = m.id.toLowerCase()
      return n.startsWith("claude") || n.startsWith("gpt")
    })
    buildFallbackGroup(claudeModels, "Claude / GPT", "Claude / GPT", false, true, false)

    // Argon
    const argonModels = models.filter((m) => {
      const n = m.id.toLowerCase()
      return (
        /argon|gemini[\s_-]?4/i.test(n) ||
        /argon|gemini[\s_-]?4/i.test(m.displayName)
      )
    })
    buildFallbackGroup(argonModels, "Gemini 4 Argon", "Gemini 4 Argon", false, false, true)

    // 其他未来特化高级模型（如 Gemini 5 等，仅收录具有有效 quotaInfo 的模型）
    const handledIds = new Set([
      ...geminiModels.map((m) => m.id),
      ...claudeModels.map((m) => m.id),
      ...argonModels.map((m) => m.id),
    ])
    const futureModels = models.filter((m) => !handledIds.has(m.id))
    for (const m of futureModels) {
      buildFallbackGroup([m], m.displayName, m.displayName, false, false, false)
    }
  }

  const formatWindowFromBucket = (
    id: string,
    name: string,
    period: QuotaPeriod,
    bucket: ParsedBucket,
    isWeeklyExhausted = false
  ): QuotaWindow => {
    const remainingPct = Math.max(
      0,
      Math.min(100, Math.round(bucket.remainingFraction * 100))
    )
    const effectiveRemaining = isWeeklyExhausted ? 0 : remainingPct
    const usedPct = 100 - effectiveRemaining
    const isExhausted = isWeeklyExhausted || remainingPct <= 0
    return {
      id,
      name,
      period,
      usedPercentage: usedPct,
      resetsAt: bucket.resetTime || undefined,
      isExhausted,
    }
  }

  const resultWindows: QuotaWindow[] = []

  // 1. 基础 Gemini 配额
  const geminiGroup = extractedGroups.find((g) => g.isBaseGemini)
  if (geminiGroup) {
    const isWeeklyExhausted =
      geminiGroup.weekly !== undefined &&
      geminiGroup.weekly.remainingFraction <= 0
    if (!isFreeTier && geminiGroup.fiveHour) {
      resultWindows.push(
        formatWindowFromBucket(
          "antigravity:gemini_5h",
          "Gemini 5小时",
          "fiveHour",
          geminiGroup.fiveHour,
          isWeeklyExhausted
        )
      )
    }
    if (geminiGroup.weekly) {
      resultWindows.push(
        formatWindowFromBucket(
          "antigravity:gemini_weekly",
          "Gemini 周配额",
          "weekly",
          geminiGroup.weekly,
          isWeeklyExhausted
        )
      )
    }
  }

  // 2. Claude / GPT 配额（仅当账号开通了 Claude/GPT 分组时展示）
  const claudeGroup = extractedGroups.find((g) => g.isClaudeOrGpt)
  if (claudeGroup) {
    const isWeeklyExhausted =
      claudeGroup.weekly !== undefined &&
      claudeGroup.weekly.remainingFraction <= 0
    if (!isFreeTier && claudeGroup.fiveHour) {
      resultWindows.push(
        formatWindowFromBucket(
          "antigravity:claude_5h",
          "Claude / GPT 5小时",
          "fiveHour",
          claudeGroup.fiveHour,
          isWeeklyExhausted
        )
      )
    }
    if (claudeGroup.weekly) {
      resultWindows.push(
        formatWindowFromBucket(
          "antigravity:claude_weekly",
          "Claude / GPT 周配额",
          "weekly",
          claudeGroup.weekly,
          isWeeklyExhausted
        )
      )
    }
  }

  // 3. 所有其他特定/未来高级模型配额组（如 Gemini 4 Argon、未来的 Gemini 5 等，完全动态适配！）
  const otherGroups = extractedGroups.filter(
    (g) => !g.isBaseGemini && !g.isClaudeOrGpt
  )
  for (const group of otherGroups) {
    const isWeeklyExhausted =
      group.weekly !== undefined && group.weekly.remainingFraction <= 0
    const slug = slugify(group.displayName)
    if (!isFreeTier && group.fiveHour) {
      resultWindows.push(
        formatWindowFromBucket(
          `antigravity:${slug}_5h`,
          `${group.displayName} 5小时`,
          "fiveHour",
          group.fiveHour,
          isWeeklyExhausted
        )
      )
    }
    if (group.weekly) {
      const windowId = group.isArgon
        ? "antigravity:argon_weekly"
        : `antigravity:${slug}_weekly`
      const windowName = group.fiveHour
        ? `${group.displayName} 周配额`
        : group.displayName
      resultWindows.push(
        formatWindowFromBucket(
          windowId,
          windowName,
          "weekly",
          group.weekly,
          isWeeklyExhausted
        )
      )
    }
  }

  // 兜底保护：若全部分组都未拿到，至少给一个 Gemini 周配额默认条以防界面白屏
  if (resultWindows.length === 0) {
    resultWindows.push({
      id: "antigravity:gemini_weekly",
      name: "Gemini 周配额",
      period: "weekly",
      usedPercentage: 0,
      isExhausted: false,
    })
  }

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
