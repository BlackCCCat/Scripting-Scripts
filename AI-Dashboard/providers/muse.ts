import { AbortController, Script, fetch } from "scripting"
import type {
  ProviderCredentialEnvelope,
  ProviderQuotaHandler,
  QuotaSnapshot,
} from "../models/types"
import { normalizeEpochDate, QuotaQueryError } from "./_shared/http"
import { queryMuseViaWebKit } from "./muse_webkit"

// Muse 的 Server Action ID 随网站部署变化；发现逻辑参考
// https://github.com/whnnick/readycheck/blob/main/Sources/ReadyCheckApp/Resources/MuseSubscription.js
const ORIGIN = "https://muse.ai"
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
const ACTION_CACHE_KEY = "ai_dashboard.muse.subscription_action.v1"
const ACTION_PATTERN = /^[0-9a-f]{40,64}$/
const CHUNK_PATTERN = /^\/_next\/static\/(?:immutable\/)?chunks\/[\w~.-]+\.js$/

function chunkPaths(text: string): string[] {
  const paths = text.match(/static\/(?:immutable\/)?chunks\/[\w~.-]+\.js/g) ?? []
  return [...new Set(paths.map((path) => `/_next/${path}`))]
}

function actionFrom(text: string): string | undefined {
  return /"([0-9a-f]{40,64})",[^"\n]{0,200}"fetchSubscriptionAction"/.exec(text)?.[1]
}

function parseSubscription(
  body: string,
  accountID: string,
  collectedAt: string
): QuotaSnapshot {
  if (body.length > 524_288) {
    throw new QuotaQueryError("unreadableResponse", "Muse 响应超出预期大小")
  }

  const rows: Record<string, unknown>[] = []
  for (const line of body.split("\n")) {
    if (!/^[0-9a-f]+:\{/.test(line)) continue
    try {
      const row = JSON.parse(line.slice(line.indexOf(":") + 1))
      if (typeof row?.success === "boolean") rows.push(row)
    } catch {
      // RSC 响应还包含非订阅记录。
    }
  }
  if (rows.length !== 1) {
    throw new QuotaQueryError("unreadableResponse", "未找到 Muse 订阅额度")
  }

  const subscription = rows[0].subscription as Record<string, unknown> | null
  const usage = subscription?.usage as Record<string, unknown> | undefined
  const tier = subscription?.tier as Record<string, unknown> | undefined
  const planName = typeof tier?.name === "string" ? tier.name.trim() : ""
  if (rows[0].success !== true || !subscription || !usage || !planName) {
    throw new QuotaQueryError("subscriptionRequired", "Muse 尚未返回有效订阅与额度，可能仍在等待名单")
  }
  const percentUsed = usage.percentUsed
  if (
    typeof percentUsed !== "number" ||
    !Number.isFinite(percentUsed) ||
    percentUsed < 0 ||
    percentUsed > 100
  ) {
    throw new QuotaQueryError("unreadableResponse", "Muse 额度百分比无效")
  }
  const topupLabel = typeof subscription.topupRowValueLabel === "string"
    ? subscription.topupRowValueLabel.trim().slice(0, 120)
    : ""
  const topupBalance = subscription.topupBalance
  const topupTotal = subscription.topupTotal
  const hasTopupCounters =
    typeof topupBalance === "number" && Number.isFinite(topupBalance) &&
    typeof topupTotal === "number" && Number.isFinite(topupTotal) &&
    topupBalance >= 0 && topupTotal >= 0
  const labeledUsed = /^(\d+(?:\.\d+)?)%\s*used\b/i.exec(topupLabel)
  const remainingPercentage = hasTopupCounters && topupTotal > 0
    ? Math.min(100, Math.max(0, 100 * topupBalance / topupTotal))
    : labeledUsed && Number(labeledUsed[1]) <= 100
      ? 100 - Number(labeledUsed[1])
      : hasTopupCounters && topupBalance === 0
        ? 0
        : undefined
  const additionalTokens = topupLabel
    ? { value: topupLabel, remainingPercentage }
    : hasTopupCounters && topupBalance === 0
      ? { value: topupTotal > 0 ? "额外额度已用完" : "无额外额度", remainingPercentage }
      : hasTopupCounters && topupBalance > 0
        ? { value: "有可用额度", remainingPercentage }
        : undefined

  return {
    accountID,
    collectedAt,
    providerPlanName: planName,
    museAdditionalTokens: additionalTokens,
    windows: [{
      id: "muse.weekly",
      name: "每周使用额度",
      period: "weekly",
      usedPercentage: percentUsed,
      resetsAt: normalizeEpochDate(usage.resetsAt),
    }],
  }
}

export async function validateMuseAccount(
  envelope: ProviderCredentialEnvelope,
  existingWebView?: WebViewController
): Promise<void> {
  const accountID = "muse-login-validation"
  const collectedAt = new Date().toISOString()
  try {
    if (existingWebView) {
      try {
        const result = await queryMuseViaWebKit(
          envelope.accessToken.trim(),
          Storage.get<string>(ACTION_CACHE_KEY),
          accountID,
          collectedAt,
          parseSubscription,
          existingWebView
        )
        Storage.set(ACTION_CACHE_KEY, result.actionID)
        return
      } catch (error) {
        if (!(error instanceof QuotaQueryError) || error.code !== "network") throw error
        // 登录页关闭后 WebKit 可能不再执行脚本；再用独立查询确认。
      }
    }
    await queryMuseQuota(accountID, envelope, collectedAt)
  } catch (error) {
    if (error instanceof QuotaQueryError && error.code === "unreadableResponse") {
      throw new QuotaQueryError(
        "unreadableResponse",
        "Muse 未返回可确认的订阅额度；可能仍在等待名单，或订阅接口已变化"
      )
    }
    throw error
  }
}

async function tryCachedActionFast(
  cookie: string,
  action: string,
  accountID: string,
  collectedAt: string
): Promise<QuotaSnapshot | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch(`${ORIGIN}/`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": action,
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify([{ includeAgreement: true }]),
      signal: controller.signal,
      timeout: 4,
      handleRedirect: async () => null,
    })
    if (response.status === 429) {
      throw new QuotaQueryError("rateLimited", "Muse 请求过于频繁，请稍后重试")
    }
    if (response.status === 400 || response.status === 404 || response.status === 409) {
      Storage.remove(ACTION_CACHE_KEY)
      return null
    }
    if (!response.ok) return null
    return parseSubscription(await response.text(), accountID, collectedAt)
  } catch (error) {
    if (error instanceof QuotaQueryError && error.code === "rateLimited") throw error
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export const queryMuseQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const cookie = envelope.accessToken.trim()
  if (!/(?:^|;\s*)hatch_sess=([^;]+)/.test(cookie)) {
    throw new QuotaQueryError("invalidCredential", "缺少 Muse 登录会话，请重新登录")
  }

  let webKitFailure: QuotaQueryError | undefined
  if (Script.env === "index" || Script.env === "home_screen") {
    try {
      const cached = Storage.get<string>(ACTION_CACHE_KEY)
      if (typeof cached === "string" && ACTION_PATTERN.test(cached)) {
        const fastSnapshot = await tryCachedActionFast(
          cookie,
          cached,
          accountID,
          collectedAt
        )
        if (fastSnapshot) return fastSnapshot
      }
      const result = await queryMuseViaWebKit(
        cookie,
        Storage.get<string>(ACTION_CACHE_KEY),
        accountID,
        collectedAt,
        parseSubscription
      )
      Storage.set(ACTION_CACHE_KEY, result.actionID)
      return result.snapshot
    } catch (error) {
      if (
        error instanceof QuotaQueryError &&
        (
          error.code === "invalidCredential" ||
          error.code === "rateLimited" ||
          error.code === "subscriptionRequired"
        )
      ) {
        throw error
      }
      webKitFailure = error instanceof QuotaQueryError
        ? error
        : new QuotaQueryError("network", "Muse WebView 查询失败")
    }
  }

  const controller = new AbortController()
  const nativeDeadlineMs = webKitFailure ? 60_000 : 25_000
  const deadline = setTimeout(() => controller.abort(), nativeDeadlineMs)
  const signal = controller.signal
  let stage = "打开首页"
  const request = (
    path: string,
    options: {
      method?: string
      cookie?: boolean
      headers?: Record<string, string>
      body?: string
    } = {}
  ) => {
    if (path !== "/" && !CHUNK_PATTERN.test(path)) {
      throw new QuotaQueryError("unreadableResponse", "Muse 资源路径无效")
    }
    return fetch(`${ORIGIN}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "User-Agent": USER_AGENT,
        ...(options.cookie ? { Cookie: cookie } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body,
      signal,
      timeout: nativeDeadlineMs / 1000,
      handleRedirect: async () => null,
    })
  }

  const readChunk = async (path: string): Promise<string> => {
    if (!CHUNK_PATTERN.test(path)) return ""
    const response = await request(path)
    if (!response.ok) return ""
    const body = await response.text()
    if (body.length > 2_000_000) {
      throw new QuotaQueryError("unreadableResponse", "Muse 脚本资源超出预期大小")
    }
    return body
  }

  const discover = async (): Promise<string> => {
    stage = "打开首页"
    const home = await request("/", {
      cookie: true,
      headers: { Accept: "text/html" },
    })
    if (home.status === 401 || home.status === 403) {
      throw new QuotaQueryError("server", `Muse 原生首页请求 HTTP ${home.status}，需在应用内确认登录状态`)
    }
    if (!home.ok) {
      const code = home.status === 429 ? "rateLimited" : "network"
      throw new QuotaQueryError(code, `Muse 首页 HTTP ${home.status}`)
    }
    const html = await home.text()
    if (html.length > 8_000_000) {
      throw new QuotaQueryError("unreadableResponse", "Muse 首页超出预期大小")
    }
    const paths = chunkPaths(html).slice(0, 128).reverse()
    stage = "查找订阅入口"
    const settingsModules = new Set<string>()
    const loaders = new Map<string, string[]>()
    let bytesRead = 0

    for (let i = 0; i < paths.length; i += 8) {
      const bodies = await Promise.all(paths.slice(i, i + 8).map(readChunk))
      for (const body of bodies) {
        bytesRead += body.length
        if (bytesRead > 32_000_000) {
          throw new QuotaQueryError("unreadableResponse", "Muse 脚本资源超出预期大小")
        }
        const direct = actionFrom(body)
        if (direct) return direct
        for (const match of body.matchAll(/\.A\((\d+)\)\.then\(\(\{[^}]*Settings/g)) {
          settingsModules.add(match[1])
        }
        for (const match of body.matchAll(/[,\{\[](\d+),\w+=>\{\w+\.v\(\w+=>Promise\.all\(\[([^\]]*)/g)) {
          const dependencies = chunkPaths(match[2])
          if (dependencies.length > 0) loaders.set(match[1], dependencies)
        }
      }
    }

    for (const module of settingsModules) {
      const settings = loaders.get(module)?.slice(0, 32)
      if (!settings) continue
      for (let i = 0; i < settings.length; i += 8) {
        const bodies = await Promise.all(settings.slice(i, i + 8).map(readChunk))
        for (const body of bodies) {
          const action = actionFrom(body)
          if (action) return action
        }
      }
    }
    throw new QuotaQueryError("unreadableResponse", "Muse 订阅查询入口已变化")
  }

  const post = (action: string) => {
    stage = "读取订阅额度"
    return request("/", {
      method: "POST",
      cookie: true,
      headers: {
        Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": action,
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      body: JSON.stringify([{ includeAgreement: true }]),
    })
  }

  try {
    const cached = Storage.get<string>(ACTION_CACHE_KEY)
    const hadCache = typeof cached === "string" && ACTION_PATTERN.test(cached)
    let action = hadCache ? cached : await discover()
    let response = await post(action)
    let rediscovered = false
    if (hadCache && (response.status === 400 || response.status === 404 || response.status === 409)) {
      action = await discover()
      response = await post(action)
      rediscovered = true
    }
    if (response.status === 401 || response.status === 403) {
      throw new QuotaQueryError("server", `Muse 原生订阅请求 HTTP ${response.status}，需在应用内确认登录状态`)
    }
    if (!response.ok) {
      const code = response.status === 429
        ? "rateLimited"
        : response.status === 404
          ? "unreadableResponse"
          : "network"
      throw new QuotaQueryError(code, `Muse 订阅请求 HTTP ${response.status}`)
    }
    const body = await response.text()
    let snapshot: QuotaSnapshot
    try {
      snapshot = parseSubscription(body, accountID, collectedAt)
    } catch (error) {
      if (
        !hadCache ||
        rediscovered ||
        !(error instanceof QuotaQueryError) ||
        error.code !== "unreadableResponse"
      ) throw error
      action = await discover()
      response = await post(action)
      if (response.status === 401 || response.status === 403) {
        throw new QuotaQueryError("server", `Muse 原生订阅请求 HTTP ${response.status}，需在应用内确认登录状态`)
      }
      if (!response.ok) {
        throw new QuotaQueryError("unreadableResponse", `Muse 订阅请求 HTTP ${response.status}`)
      }
      snapshot = parseSubscription(await response.text(), accountID, collectedAt)
    }
    Storage.set(ACTION_CACHE_KEY, action)
    return snapshot
  } catch (error) {
    if (error instanceof QuotaQueryError) {
      if (webKitFailure && error.code !== "invalidCredential" && error.code !== "rateLimited") {
        throw new QuotaQueryError(
          error.code,
          `${webKitFailure.detail ?? "Muse WebView 查询失败"}；原生查询：${error.detail ?? error.code}`
        )
      }
      throw error
    }
    const detail = signal.aborted
      ? `Muse ${stage}超时`
      : `Muse ${stage}网络请求失败`
    throw new QuotaQueryError(
      "network",
      webKitFailure?.detail ? `${webKitFailure.detail}；${detail}` : detail
    )
  } finally {
    clearTimeout(deadline)
  }
}
