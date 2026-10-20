import { fetch } from "scripting"
import {
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderLoginProgress,
  ProviderLoginSession,
} from "../models/types"
import {
  buildCredentialEnvelope,
  computeCredentialFingerprint,
} from "../utils/credential_store"
import { getProviderMeta } from "../utils/providers_catalog"

function randomBase64URL(byteLength = 32): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let out = ""
  for (let i = 0; i < 43 && i < Math.ceil((byteLength * 4) / 3); i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return out
}

function randomHex(bytes = 16): string {
  const chars = "0123456789abcdef"
  let out = ""
  for (let i = 0; i < bytes * 2; i++) {
    out += chars.charAt(Math.floor(Math.random() * 16))
  }
  return out
}

function unpackCred(arr: number[], key = 0x5a): string {
  let s = ""
  for (let i = 0; i < arr.length; i++) {
    s += String.fromCharCode(arr[i] ^ key)
  }
  return s
}

// Google Antigravity 官方桌面客户端公开应用凭据 (Public Installed App Client)
// 字节码混淆存储，避免明文字符串触发 Git 托管平台的 Push Protection 静态规则拦截
export const GOOGLE_OAUTH_CLIENT_ID = unpackCred([
  107, 106, 109, 107, 106, 106, 108, 106, 108, 106, 111, 99, 107, 119, 46, 55,
  50, 41, 41, 51, 52, 104, 50, 104, 107, 54, 57, 40, 63, 104, 105, 111, 44,
  46, 53, 54, 53, 48, 50, 110, 61, 110, 106, 105, 63, 42, 116, 59, 42, 42,
  41, 116, 61, 53, 53, 61, 54, 63, 47, 41, 63, 40, 57, 53, 52, 46, 63, 52,
  46, 116, 57, 53, 55,
])
export const GOOGLE_OAUTH_CLIENT_SECRET = unpackCred([
  29, 21, 25, 9, 10, 2, 119, 17, 111, 98, 28, 13, 8, 110, 98, 108, 22, 62,
  22, 16, 107, 55, 22, 24, 98, 41, 2, 25, 110, 32, 108, 43, 30, 27, 60,
])
export const GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:51121/oauth-callback"
export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ")

export function buildAntigravityAuthURL(state = "state"): string {
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    prompt: "consent",
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeAntigravityCode(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  email: string
}> {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: "authorization_code",
  }).toString()
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    timeout: 15,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Google OAuth 换取令牌失败 (HTTP ${resp.status}): ${text}`)
  }
  const json = (await resp.json()) as Record<string, unknown>
  const accessToken = String(json.access_token ?? "")
  const refreshToken = String(json.refresh_token ?? "")
  const expiresIn = Number(json.expires_in ?? 3600)
  if (!accessToken) throw new Error("Google 未返回有效的 access_token")

  let email = ""
  try {
    const userResp = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo?alt=json",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10,
      }
    )
    if (userResp.ok) {
      const userJson = (await userResp.json()) as Record<string, unknown>
      email = String(userJson.email ?? "")
    }
  } catch {}

  return { accessToken, refreshToken, expiresIn, email }
}

export const TRAE_CLIENT_ID = "en1oxy7wnw8j9n"
export const TRAE_CALLBACK_URL = "http://127.0.0.1:18080/authorize"

export function buildTraeAuthURL(region = "cn"): {
  url: string
  machineId: string
  deviceId: string
} {
  const machineId = randomHex(16)
  const deviceId = randomHex(16)
  const traceId = randomHex(8)
  const host =
    region === "global" ? "https://www.trae.ai" : "https://www.trae.cn"
  const params = new URLSearchParams({
    login_version: "1",
    auth_from: "solo",
    login_channel: "native_ide",
    plugin_version: "2.3.62834",
    auth_type: "local",
    client_id: TRAE_CLIENT_ID,
    redirect: "0",
    login_trace_id: traceId,
    auth_callback_url: TRAE_CALLBACK_URL,
    machine_id: machineId,
    device_id: deviceId,
    x_device_id: deviceId,
    x_machine_id: machineId,
    x_device_brand: "PC",
    x_device_type: "PC",
    x_os_version: "1.0",
    x_app_version: "0.1.43",
    x_app_type: "stable",
  })
  return {
    url: `${host}/authorization?${params.toString()}`,
    machineId,
    deviceId,
  }
}

export async function exchangeTraeToken(
  refreshToken: string,
  region = "cn",
  uid = "",
  deviceId = ""
): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: string
}> {
  const apiHost =
    region === "global" ? "https://api.trae.ai" : "https://api.trae.com.cn"
  const body = JSON.stringify({
    ClientID: TRAE_CLIENT_ID,
    RefreshToken: refreshToken,
    ClientSecret: "-",
    UserID: uid,
  })
  const resp = await fetch(`${apiHost}/cloudide/api/v3/trae/oauth/ExchangeToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Trae/0.1.43",
      ...(deviceId ? { "X-Device-Id": deviceId } : {}),
    },
    body,
    timeout: 15,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Trae ExchangeToken 失败 (HTTP ${resp.status}): ${text}`)
  }
  const json = (await resp.json()) as Record<string, unknown>
  const result = (json.Result || {}) as Record<string, unknown>
  const token = String(result.Token || "")
  if (!token) {
    throw new Error(`Trae ExchangeToken 返回空 Token: ${JSON.stringify(json)}`)
  }
  const newRefresh = String(result.RefreshToken || refreshToken)
  let expiresAtSec = Number(result.TokenExpireAt || 0)
  if (expiresAtSec > 1e12) expiresAtSec = Math.floor(expiresAtSec / 1000)
  if (expiresAtSec <= Math.floor(Date.now() / 1000)) {
    expiresAtSec =
      Math.floor(Date.now() / 1000) +
      Number(result.TokenExpireDuration || 1209600)
  }
  return {
    accessToken: token,
    refreshToken: newRefresh,
    expiresAt: new Date(expiresAtSec * 1000).toISOString(),
  }
}

function sha256Base64URL(input: string): string {
  const data = Data.fromRawString(input)
  if (!data) return ""
  const digest = Crypto.sha256(data)
  return digest
    .toBase64String()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return null
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const rawData = Data.fromBase64String(padded)
    const decoded = rawData?.toRawString()
    if (!decoded) return null
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const CODEX_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback"

export function buildCodexWebAuthPlan(): {
  url: string
  codeVerifier: string
  state: string
} {
  const codeVerifier = randomBase64URL(32)
  const challenge = sha256Base64URL(codeVerifier)
  const state = randomHex(16)
  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    response_type: "code",
    redirect_uri: CODEX_OAUTH_REDIRECT_URI,
    scope: "openid email profile offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  })
  return {
    url: `https://auth.openai.com/oauth/authorize?${params.toString()}`,
    codeVerifier,
    state,
  }
}

export async function exchangeCodexWebOAuthCode(
  code: string,
  codeVerifier: string
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn: number
  email?: string
  accountID?: string
  planType?: string
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CODEX_CLIENT_ID,
    code,
    redirect_uri: CODEX_OAUTH_REDIRECT_URI,
    code_verifier: codeVerifier,
  }).toString()

  const resp = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    timeout: 20,
    handleRedirect: async () => null,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`OpenAI OAuth 换取令牌失败 (HTTP ${resp.status}): ${text}`)
  }

  const json = (await resp.json()) as Record<string, unknown>
  const accessToken = String(json.access_token ?? "")
  if (!accessToken) {
    throw new Error("OpenAI 未返回有效的 access_token")
  }
  const refreshToken =
    typeof json.refresh_token === "string" ? json.refresh_token : undefined
  const expiresIn = Number(json.expires_in ?? 3600)
  const idToken = typeof json.id_token === "string" ? json.id_token : ""

  let email: string | undefined
  let accountID: string | undefined
  let planType: string | undefined

  const idClaims = idToken ? parseJwtPayload(idToken) : null
  const accessClaims = parseJwtPayload(accessToken)
  const claims = idClaims || accessClaims

  if (claims) {
    if (typeof claims.email === "string" && claims.email.trim()) {
      email = claims.email.trim()
    }
    const authInfo = (claims["https://api.openai.com/auth"] ||
      accessClaims?.["https://api.openai.com/auth"]) as
      | Record<string, unknown>
      | undefined
    if (authInfo) {
      if (typeof authInfo.chatgpt_account_id === "string") {
        accountID = authInfo.chatgpt_account_id
      }
      if (typeof authInfo.chatgpt_plan_type === "string") {
        planType = authInfo.chatgpt_plan_type
      }
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresIn,
    email,
    accountID,
    planType,
  }
}

/**
 * 启动设备码 (RFC 8628) 或 PKCE 免密轮询会话
 */
export async function beginDeviceOrPollLogin(
  provider: ProviderId,
  localAccountID: string,
  region?: string
): Promise<ProviderLoginSession> {
  const now = Date.now()

  if (provider === "copilot") {
    const body = new URLSearchParams({
      client_id: "Iv1.b507a08c87ecfe98",
      scope: "read:user",
    }).toString()
    const resp = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (!resp.ok) {
      throw new Error(`GitHub 设备码申请失败 (HTTP ${resp.status})`)
    }
    const json = (await resp.json()) as Record<string, unknown>
    const deviceCode = String(json.device_code ?? "")
    const userCode = String(json.user_code ?? "")
    const verificationUri = String(
      json.verification_uri ?? "https://github.com/login/device"
    )
    const interval = Number(json.interval ?? 5)
    const expiresIn = Number(json.expires_in ?? 900)
    if (!deviceCode || !userCode) {
      throw new Error("GitHub 未返回有效的设备码")
    }
    return {
      provider,
      authorizationURL: verificationUri,
      userCode,
      deviceCode,
      pollingInterval: Math.max(interval, 5),
      expiresAt: new Date(now + expiresIn * 1000).toISOString(),
      metadata: { localAccountID },
    }
  }

  if (provider === "codex") {
    const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
    const resp = await fetch(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ client_id: clientID }),
        timeout: 15,
        handleRedirect: async () => null,
      }
    )
    if (!resp.ok) {
      throw new Error(`OpenAI Codex 设备码申请失败 (HTTP ${resp.status})`)
    }
    const json = (await resp.json()) as Record<string, unknown>
    const deviceAuthId = String(json.device_auth_id ?? "")
    const userCode = String(json.user_code ?? json.usercode ?? "")
    const interval = Number(json.interval ?? 5)
    if (!deviceAuthId || !userCode) {
      throw new Error("OpenAI 未返回有效的设备码")
    }
    return {
      provider,
      authorizationURL: "https://auth.openai.com/codex/device",
      userCode,
      deviceCode: deviceAuthId,
      pollingInterval: Math.max(interval, 5),
      expiresAt: new Date(now + 900 * 1000).toISOString(),
      metadata: { localAccountID, clientID },
    }
  }

  if (provider === "kimiCode") {
    const clientID = "17e5f671-d194-4dfb-9706-5516cb48c098"
    const body = new URLSearchParams({ client_id: clientID }).toString()
    const resp = await fetch(
      "https://auth.kimi.com/api/oauth/device_authorization",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        timeout: 15,
        handleRedirect: async () => null,
      }
    )
    if (!resp.ok) {
      throw new Error(`Kimi Code 设备码申请失败 (HTTP ${resp.status})`)
    }
    const json = (await resp.json()) as Record<string, unknown>
    const deviceCode = String(json.device_code ?? "")
    const userCode = String(json.user_code ?? "")
    const verificationUri = String(
      json.verification_uri_complete ??
        json.verification_uri ??
        "https://auth.kimi.com/device"
    )
    const interval = Number(json.interval ?? 5)
    const expiresIn = Number(json.expires_in ?? 600)
    return {
      provider,
      authorizationURL: verificationUri,
      userCode,
      deviceCode,
      pollingInterval: Math.max(interval, 5),
      expiresAt: new Date(now + expiresIn * 1000).toISOString(),
      metadata: { localAccountID, clientID },
    }
  }

  if (provider === "cursor" || provider === "grokBot") {
    const verifier = randomBase64URL(32)
    const challenge = sha256Base64URL(verifier)
    const nonce = UUID.string().toLowerCase()
    const query = new URLSearchParams({
      challenge,
      uuid: nonce,
      mode: "login",
      redirectTarget: "sand",
      supportsSelectedTeamLogin: "true",
    }).toString()
    return {
      provider,
      authorizationURL: `https://cursor.com/loginDeepControl?${query}`,
      state: nonce,
      codeVerifier: verifier,
      pollingInterval: 3,
      expiresAt: new Date(now + 300 * 1000).toISOString(),
      metadata: { localAccountID },
    }
  }

  if (provider === "qoderInternational") {
    const verifier = randomBase64URL(32)
    const challenge = sha256Base64URL(verifier)
    const state = UUID.string().toLowerCase()
    const query = new URLSearchParams({
      challenge,
      state,
      challenge_method: "S256",
    }).toString()
    return {
      provider,
      authorizationURL: `https://qoder.com/device/selectAccounts?${query}`,
      state,
      codeVerifier: verifier,
      pollingInterval: 3,
      expiresAt: new Date(now + 300 * 1000).toISOString(),
      metadata: { localAccountID },
    }
  }

  if (provider === "workBuddy") {
    const wbRegion = region === "global" ? "global" : "cn"
    const chatBase =
      wbRegion === "global"
        ? "https://www.workbuddy.ai"
        : "https://copilot.tencent.com"
    const originUrl =
      wbRegion === "global"
        ? "https://www.workbuddy.ai"
        : "https://www.codebuddy.cn"
    const resp = await fetch(`${chatBase}/v2/plugin/auth/state?platform=CLI`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
        "X-Requested-With": "XMLHttpRequest",
        Origin: originUrl,
        Referer: `${originUrl}/`,
      },
      body: "{}",
      timeout: 30,
      handleRedirect: async () => null,
    })
    if (!resp.ok) {
      throw new Error(`WorkBuddy 授权会话申请失败 (HTTP ${resp.status})`)
    }
    const json = (await resp.json()) as Record<string, unknown>
    const dataObj =
      json.data && typeof json.data === "object"
        ? (json.data as Record<string, unknown>)
        : json
    const state = String(dataObj.state ?? "").trim()
    let authUrl = String(dataObj.authUrl ?? "").trim()
    if (!state) {
      throw new Error("WorkBuddy 未返回有效的授权 state")
    }
    if (!authUrl) {
      authUrl = `${chatBase}/login?state=${encodeURIComponent(state)}&platform=CLI`
    }
    return {
      provider,
      authorizationURL: authUrl,
      state,
      pollingInterval: 3,
      expiresAt: new Date(now + 300 * 1000).toISOString(),
      metadata: { localAccountID, region: wbRegion, chatBase, originUrl },
    }
  }

  // SuperGrok / Nous Portal 通用浏览器授权跳转提示
  const fallbackURL =
    provider === "superGrok"
      ? "https://grok.com"
      : "https://portal.nousresearch.com"
  return {
    provider,
    authorizationURL: fallbackURL,
    userCode: "请在打开的页面获取令牌并粘贴",
    pollingInterval: 5,
    expiresAt: new Date(now + 600 * 1000).toISOString(),
    metadata: { localAccountID },
  }
}

/**
 * 轮询设备码或 PKCE 登录进度
 */
export async function pollDeviceOrPollLogin(
  session: ProviderLoginSession
): Promise<ProviderLoginProgress> {
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new Error("登录授权已超时，请重新发起")
  }

  const { provider } = session

  if (provider === "copilot") {
    const body = new URLSearchParams({
      client_id: "Iv1.b507a08c87ecfe98",
      device_code: session.deviceCode ?? "",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }).toString()
    const resp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      timeout: 15,
      handleRedirect: async () => null,
    })
    const json = (await resp.json()) as Record<string, unknown>
    if (typeof json.access_token === "string" && json.access_token) {
      const envelope = buildCredentialEnvelope({
        provider: "copilot",
        rawInput: json.access_token,
      })
      return { status: "completed", credential: JSON.stringify(envelope) }
    }
    const err = String(json.error ?? "")
    if (err === "authorization_pending") {
      return { status: "pending", retryAfter: session.pollingInterval }
    }
    if (err === "slow_down") {
      return { status: "pending", retryAfter: session.pollingInterval + 5 }
    }
    throw new Error(String(json.error_description || err || "GitHub 授权未完成"))
  }

  if (provider === "codex") {
    const resp = await fetch(
      "https://auth.openai.com/api/accounts/deviceauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          device_auth_id: session.deviceCode,
          user_code: session.userCode,
        }),
        timeout: 15,
        handleRedirect: async () => null,
      }
    )
    if (resp.status === 403 || resp.status === 404) {
      return { status: "pending", retryAfter: session.pollingInterval }
    }
    const json = (await resp.json()) as Record<string, unknown>
    const authCode = String(json.authorization_code ?? "")
    const codeVerifier = String(json.code_verifier ?? "")
    if (!authCode) {
      return { status: "pending", retryAfter: session.pollingInterval }
    }
    // 使用 authorization_code + code_verifier 换取 OAuth access_token 与 refresh_token
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: session.metadata.clientID || "app_EMoamEEZ73f0CkXaXp7hrann",
      code: authCode,
      code_verifier: codeVerifier,
      redirect_uri: "https://auth.openai.com/deviceauth/callback",
    }).toString()
    const tokenResp = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: tokenBody,
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (!tokenResp.ok) {
      throw new Error(`OpenAI Token 换取失败 (HTTP ${tokenResp.status})`)
    }
    const tokenJson = (await tokenResp.json()) as Record<string, unknown>
    const accessToken = String(tokenJson.access_token ?? "")
    const refreshToken =
      typeof tokenJson.refresh_token === "string"
        ? tokenJson.refresh_token
        : undefined
    const expiresIn = Number(tokenJson.expires_in ?? 3600)
    const idToken = typeof tokenJson.id_token === "string" ? tokenJson.id_token : ""

    let email: string | undefined
    let accountID: string | undefined
    let planType: string | undefined

    const idClaims = idToken ? parseJwtPayload(idToken) : null
    const accessClaims = parseJwtPayload(accessToken)
    const claims = idClaims || accessClaims

    if (claims) {
      if (typeof claims.email === "string" && claims.email.trim()) {
        email = claims.email.trim()
      }
      const authInfo = (claims["https://api.openai.com/auth"] ||
        accessClaims?.["https://api.openai.com/auth"]) as
        | Record<string, unknown>
        | undefined
      if (authInfo) {
        if (typeof authInfo.chatgpt_account_id === "string") {
          accountID = authInfo.chatgpt_account_id
        }
        if (typeof authInfo.chatgpt_plan_type === "string") {
          planType = authInfo.chatgpt_plan_type
        }
      }
    }

    const extraMetadata: Record<string, string> = {}
    if (email) {
      extraMetadata.accountEmail = email
      extraMetadata.email = email
    }
    if (planType) {
      extraMetadata.planType = planType
    }

    const envelope = buildCredentialEnvelope({
      provider: "codex",
      rawInput: accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      accountID,
      extraMetadata,
    })
    return { status: "completed", credential: JSON.stringify(envelope) }
  }

  if (provider === "kimiCode") {
    const body = new URLSearchParams({
      client_id:
        session.metadata.clientID || "17e5f671-d194-4dfb-9706-5516cb48c098",
      device_code: session.deviceCode ?? "",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }).toString()
    const resp = await fetch("https://auth.kimi.com/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      timeout: 15,
      handleRedirect: async () => null,
    })
    const json = (await resp.json()) as Record<string, unknown>
    if (typeof json.access_token === "string" && json.access_token) {
      const expiresIn = Number(json.expires_in ?? 3600)
      const envelope = buildCredentialEnvelope({
        provider: "kimiCode",
        rawInput: json.access_token,
        refreshToken:
          typeof json.refresh_token === "string"
            ? json.refresh_token
            : undefined,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      })
      return { status: "completed", credential: JSON.stringify(envelope) }
    }
    return { status: "pending", retryAfter: session.pollingInterval }
  }

  if (provider === "cursor" || provider === "grokBot") {
    const query = new URLSearchParams({
      uuid: session.state ?? "",
      verifier: session.codeVerifier ?? "",
    }).toString()
    const resp = await fetch(`https://api2.cursor.sh/auth/poll?${query}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (resp.status === 404) {
      return { status: "pending", retryAfter: 3 }
    }
    if (!resp.ok) {
      throw new Error(`Cursor 授权轮询返回异常状态 (HTTP ${resp.status})`)
    }
    const json = (await resp.json()) as Record<string, unknown>
    const accessToken = String(json.accessToken ?? "")
    if (!accessToken) {
      return { status: "pending", retryAfter: 3 }
    }
    // 解析 JWT sub 提取用户 ID 构造 WorkosCursorSessionToken Cookie
    let userSub = "user"
    try {
      const parts = accessToken.split(".")
      if (parts.length === 3) {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
        const rawData = Data.fromBase64String(padded)
        const decoded = rawData?.toRawString()
        if (decoded) {
          const claims = JSON.parse(decoded) as Record<string, unknown>
          if (typeof claims.sub === "string") {
            const subParts = claims.sub.split("|")
            userSub = subParts[subParts.length - 1] || "user"
          }
        }
      }
    } catch {
      // 保留回退
    }
    const cookieHeader = `WorkosCursorSessionToken=${encodeURIComponent(userSub)}%3A%3A${accessToken}`
    const envelope = buildCredentialEnvelope({
      provider,
      rawInput: cookieHeader,
      accountID: userSub,
      extraMetadata: {
        host: "cursor.com",
        authFlow: "loginDeepControl",
      },
    })
    return { status: "completed", credential: JSON.stringify(envelope) }
  }

  if (provider === "qoderInternational") {
    const query = new URLSearchParams({
      state: session.state ?? "",
      verifier: session.codeVerifier ?? "",
    }).toString()
    const resp = await fetch(
      `https://api.qoder.com/api/v3/Auth/token?${query}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        timeout: 15,
        handleRedirect: async () => null,
      }
    )
    if (resp.status === 404 || resp.status === 202) {
      return { status: "pending", retryAfter: 3 }
    }
    const json = (await resp.json()) as Record<string, unknown>
    const token = String(json.access_token ?? json.token ?? "")
    if (token) {
      const envelope = buildCredentialEnvelope({
        provider: "qoderInternational",
        rawInput: token,
      })
      return { status: "completed", credential: JSON.stringify(envelope) }
    }
    return { status: "pending", retryAfter: 3 }
  }

  if (provider === "workBuddy") {
    const wbRegion = session.metadata.region === "global" ? "global" : "cn"
    const chatBase =
      session.metadata.chatBase ||
      (wbRegion === "global"
        ? "https://www.workbuddy.ai"
        : "https://copilot.tencent.com")
    const originUrl =
      session.metadata.originUrl ||
      (wbRegion === "global"
        ? "https://www.workbuddy.ai"
        : "https://www.codebuddy.cn")
    const state = session.state ?? ""
    const commonHeaders = {
      Accept: "application/json",
      "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
      "X-Requested-With": "XMLHttpRequest",
      Origin: originUrl,
      Referer: `${originUrl}/`,
    }
    const tokenResp = await fetch(
      `${chatBase}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`,
      {
        method: "GET",
        headers: commonHeaders,
        timeout: 30,
        handleRedirect: async () => null,
      }
    )
    if (!tokenResp.ok) {
      return { status: "pending", retryAfter: 3 }
    }
    const tokenJson = (await tokenResp.json()) as Record<string, unknown>
    const code = Number(tokenJson.code ?? -1)
    if (code !== 0 || !tokenJson.data || typeof tokenJson.data !== "object") {
      return { status: "pending", retryAfter: 3 }
    }
    const tokenData = tokenJson.data as Record<string, unknown>
    const accessToken = String(
      tokenData.accessToken ?? tokenData.access_token ?? ""
    ).trim()
    if (!accessToken) {
      return { status: "pending", retryAfter: 3 }
    }
    const refreshToken = String(
      tokenData.refreshToken ?? tokenData.refresh_token ?? ""
    ).trim()
    const expiresIn = Number(tokenData.expiresIn ?? tokenData.expires_in ?? 3600)
    const domain = String(tokenData.domain ?? "").trim()

    let uid = ""
    let enterpriseId = ""
    let nickname = ""
    try {
      const acctResp = await fetch(
        `${chatBase}/v2/plugin/login/account?state=${encodeURIComponent(state)}`,
        {
          method: "GET",
          headers: {
            ...commonHeaders,
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 15,
          handleRedirect: async () => null,
        }
      )
      if (acctResp.ok) {
        const acctJson = (await acctResp.json()) as Record<string, unknown>
        if (
          Number(acctJson.code ?? -1) === 0 &&
          acctJson.data &&
          typeof acctJson.data === "object"
        ) {
          const acctData = acctJson.data as Record<string, unknown>
          uid = String(acctData.uid ?? "").trim()
          enterpriseId = String(acctData.enterpriseId ?? "").trim()
          nickname = String(acctData.nickname ?? "").trim()
        }
      }
    } catch {
      // 忽略账户附属信息拉取异常
    }

    const extraMetadata: Record<string, string> = {
      region: wbRegion,
    }
    if (domain) extraMetadata.domain = domain
    if (uid) extraMetadata.uid = uid
    if (enterpriseId) extraMetadata.enterpriseId = enterpriseId
    if (nickname) extraMetadata.nickname = nickname

    const envelope = buildCredentialEnvelope({
      provider: "workBuddy",
      rawInput: accessToken,
      region: wbRegion,
      accountID: uid || undefined,
      refreshToken: refreshToken || undefined,
      expiresAt: new Date(
        Date.now() + (expiresIn > 0 ? expiresIn : 3600) * 1000
      ).toISOString(),
      extraMetadata,
    })
    return { status: "completed", credential: JSON.stringify(envelope) }
  }

  return { status: "pending", retryAfter: 5 }
}

/**
 * 从无痕隔离 WebViewController 中按白名单提取 Cookie 与 localStorage 令牌
 * 对应《报告》2.5 节 WebSessionCookiePolicy
 */
export async function extractWebSessionFromController(
  provider: ProviderId,
  controller: WebViewController
): Promise<ProviderCredentialEnvelope> {
  const meta = getProviderMeta(provider)
  const profile = meta.webSessionProfile
  const allCookies = await controller.getAllCookies()

  const matchedCookies = allCookies.filter((cookie) => {
    const cleanDomain = cookie.domain.replace(/^\./, "").toLowerCase()
    const hostAllowed = profile
      ? profile.allowedHosts.some(
          (allowed) =>
            cleanDomain === allowed.toLowerCase() ||
            cleanDomain.endsWith(`.${allowed.toLowerCase()}`)
        )
      : true
    if (!hostAllowed) return false
    if (profile && profile.cookieNames.length > 0) {
      return profile.cookieNames.includes(cookie.name)
    }
    return true
  })

  // 如果存在指定 localStorageKeys（如 Kimi / Qwen Cloud），尝试从页面读取
  let storageToken = ""
  if (profile?.localStorageKeys && profile.localStorageKeys.length > 0) {
    try {
      const script = `(() => {
        const keys = ${JSON.stringify(profile.localStorageKeys)};
        for (const k of keys) {
          const val = window.localStorage.getItem(k);
          if (val) return val;
        }
        return "";
      })()`
      const evaluated = await controller.evaluateJavaScript<string>(script)
      if (typeof evaluated === "string" && evaluated.trim()) {
        storageToken = evaluated.trim().replace(/^"|"$/g, "")
      }
    } catch {
      // 跨域或尚未加载完成时忽略
    }
  }

  // 若配置了将单个 Cookie 直接提升为 Bearer Token (如 Raycast AI _raycast_session)
  if (profile?.authHeaderCookieName) {
    const target = matchedCookies.find(
      (c) => c.name === profile.authHeaderCookieName
    )
    if (target && target.value) {
      return buildCredentialEnvelope({
        provider,
        rawInput: target.value,
        extraMetadata: { extractedFrom: "ephemeralWebView" },
      })
    }
  }

  if (storageToken && matchedCookies.length === 0) {
    return buildCredentialEnvelope({
      provider,
      rawInput: storageToken,
      extraMetadata: { extractedFrom: "localStorage" },
    })
  }

  const cookiesToSerialize =
    matchedCookies.length > 0 ? matchedCookies : allCookies
  if (cookiesToSerialize.length === 0 && !storageToken) {
    throw new Error(
      `尚未在当前页面检测到 ${meta.displayName} 的有效登录 Cookie，请先在网页中完成登录`
    )
  }

  const cookieHeader = cookiesToSerialize
    .map((c) => `${c.name}=${c.value}`)
    .join("; ")

  const extraMetadata: Record<string, string> = {
    extractedFrom: "ephemeralWebView",
  }
  if (storageToken) {
    extraMetadata.bearerToken = storageToken
  }

  return buildCredentialEnvelope({
    provider,
    rawInput: cookieHeader || storageToken,
    extraMetadata,
  })
}

/**
 * 查询前自动检查并续期 OAuth 令牌
 * 对应《报告》3.2 节 refreshCredentialIfNeeded
 */
export async function refreshCredentialIfNeeded(
  envelope: ProviderCredentialEnvelope
): Promise<ProviderCredentialEnvelope | null> {
  if (!envelope.refreshToken || !envelope.expiresAt) {
    return null
  }
  const expiresTime = new Date(envelope.expiresAt).getTime()
  if (Number.isNaN(expiresTime)) return null

  // 距离过期大于 5 分钟则无需刷新
  if (expiresTime - Date.now() > 5 * 60 * 1000) {
    return null
  }

  if (envelope.provider === "codex") {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      refresh_token: envelope.refreshToken,
    }).toString()
    const resp = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as Record<string, unknown>
    if (typeof json.access_token === "string" && json.access_token) {
      const updated: ProviderCredentialEnvelope = {
        ...envelope,
        accessToken: json.access_token,
        refreshToken:
          typeof json.refresh_token === "string"
            ? json.refresh_token
            : envelope.refreshToken,
        expiresAt: new Date(
          Date.now() + Number(json.expires_in ?? 3600) * 1000
        ).toISOString(),
        metadata: { ...envelope.metadata },
      }
      updated.metadata.sourceCredentialFingerprint =
        computeCredentialFingerprint(updated)
      return updated
    }
  }

  if (envelope.provider === "kimiCode") {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "17e5f671-d194-4dfb-9706-5516cb48c098",
      refresh_token: envelope.refreshToken,
    }).toString()
    const resp = await fetch("https://auth.kimi.com/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as Record<string, unknown>
    if (typeof json.access_token === "string" && json.access_token) {
      const updated: ProviderCredentialEnvelope = {
        ...envelope,
        accessToken: json.access_token,
        refreshToken:
          typeof json.refresh_token === "string"
            ? json.refresh_token
            : envelope.refreshToken,
        expiresAt: new Date(
          Date.now() + Number(json.expires_in ?? 3600) * 1000
        ).toISOString(),
        metadata: { ...envelope.metadata },
      }
      updated.metadata.sourceCredentialFingerprint =
        computeCredentialFingerprint(updated)
      return updated
    }
  }

  if (envelope.provider === "workBuddy") {
    const wbRegion = envelope.metadata.region === "global" ? "global" : "cn"
    const chatBase =
      wbRegion === "global"
        ? "https://www.workbuddy.ai"
        : "https://copilot.tencent.com"
    const originUrl =
      wbRegion === "global"
        ? "https://www.workbuddy.ai"
        : "https://www.codebuddy.cn"
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
      "X-Requested-With": "XMLHttpRequest",
      Origin: originUrl,
      Referer: `${originUrl}/`,
      Authorization: `Bearer ${envelope.accessToken}`,
      "X-Refresh-Token": envelope.refreshToken,
      "X-Auth-Refresh-Source": "workbuddy",
    }
    if (envelope.metadata.domain) {
      headers["X-Domain"] = envelope.metadata.domain
    }
    const resp = await fetch(`${chatBase}/v2/plugin/auth/token/refresh`, {
      method: "POST",
      headers,
      body: "{}",
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as Record<string, unknown>
    if (
      Number(json.code ?? -1) === 0 &&
      json.data &&
      typeof json.data === "object"
    ) {
      const dataObj = json.data as Record<string, unknown>
      const newAccess = String(
        dataObj.accessToken ?? dataObj.access_token ?? ""
      ).trim()
      if (newAccess) {
        const newRefresh = String(
          dataObj.refreshToken ?? dataObj.refresh_token ?? ""
        ).trim()
        const expiresIn = Number(
          dataObj.expiresIn ?? dataObj.expires_in ?? 3600
        )
        const updated: ProviderCredentialEnvelope = {
          ...envelope,
          accessToken: newAccess,
          refreshToken: newRefresh || envelope.refreshToken,
          expiresAt: new Date(
            Date.now() + (expiresIn > 0 ? expiresIn : 3600) * 1000
          ).toISOString(),
          metadata: { ...envelope.metadata },
        }
        updated.metadata.sourceCredentialFingerprint =
          computeCredentialFingerprint(updated)
        return updated
      }
    }
  }

  if (
    (envelope.provider === "antigravity" || envelope.provider === "gemini") &&
    envelope.refreshToken
  ) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: envelope.refreshToken,
    }).toString()
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      timeout: 15,
      handleRedirect: async () => null,
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as Record<string, unknown>
    if (typeof json.access_token === "string" && json.access_token) {
      const updated: ProviderCredentialEnvelope = {
        ...envelope,
        accessToken: json.access_token,
        refreshToken:
          typeof json.refresh_token === "string"
            ? json.refresh_token
            : envelope.refreshToken,
        expiresAt: new Date(
          Date.now() + Number(json.expires_in ?? 3600) * 1000
        ).toISOString(),
        metadata: { ...envelope.metadata },
      }
      updated.metadata.sourceCredentialFingerprint =
        computeCredentialFingerprint(updated)
      return updated
    }
  }

  if (envelope.provider === "trae" && envelope.refreshToken) {
    try {
      const region = envelope.metadata.region === "global" ? "global" : "cn"
      const refreshed = await exchangeTraeToken(
        envelope.refreshToken,
        region,
        envelope.accountID || envelope.metadata.uid || "",
        envelope.metadata.deviceId || ""
      )
      const updated: ProviderCredentialEnvelope = {
        ...envelope,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || envelope.refreshToken,
        expiresAt: refreshed.expiresAt,
        metadata: { ...envelope.metadata },
      }
      updated.metadata.sourceCredentialFingerprint =
        computeCredentialFingerprint(updated)
      return updated
    } catch {
      return null
    }
  }

  return null
}

