import {
  DashboardSettings,
  ProviderCredentialEnvelope,
  ProviderId,
  QuotaSnapshot,
  SubscriptionAccount,
} from "../models/types"
import { getProviderMeta } from "./providers_catalog"

const STORAGE_ACCOUNTS_KEY = "ai_dashboard.accounts.v1"
const STORAGE_SNAPSHOTS_KEY = "ai_dashboard.snapshots.v1"
const STORAGE_SETTINGS_KEY = "ai_dashboard.settings.v1"

export const DEFAULT_SETTINGS: DashboardSettings = {
  isDemoMode: true,
  autoRefreshOnLaunch: true,
  prefersICloudKeychain: false,
  groupByRouteCategory: false,
  protectAccountIdentity: false,
  widgetPrivacyEnabled: true,
  widgetRefreshIntervalMinutes: 30,
}

export function sha256Hex(raw: string): string {
  const data = Data.fromRawString(raw)
  if (!data) return ""
  return Crypto.sha256(data).toHexString().toLowerCase()
}

export function hmacSha256Data(message: Data, key: Data): Data {
  return Crypto.hmacSHA256(message, key)
}

/**
 * 校验并规范化自建/聚合网关地址 (遵循 TokenPulse GatewayServerAddress 安全基线)
 * - 远程地址必须为 https://
 * - 仅允许 localhost / 127.0.0.1 / [::1] 使用 http://
 * - 禁止包含用户名密码、Query 参数或 Fragment
 */
export function normalizeGatewayServerAddress(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error("请输入网关服务器地址（如 https://api.example.com）")
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error("网关地址格式无效，请输入合法的 https:// 域名或地址")
  }

  const protocol = parsed.protocol.toLowerCase()
  const hostname = parsed.hostname.toLowerCase()
  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"

  if (protocol !== "https:" && !(protocol === "http:" && isLoopback)) {
    throw new Error("非本地回环网关必须使用 HTTPS 协议")
  }

  if (parsed.username || parsed.password) {
    throw new Error("网关地址中禁止内嵌用户名或密码")
  }

  if (parsed.search || parsed.hash) {
    throw new Error("网关地址中禁止包含查询参数 (?...) 或锚点 (#...)")
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, "")
  return `${parsed.origin}${cleanPath}`
}

/**
 * 计算凭证的 SHA-256 指纹 (sourceCredentialFingerprint)
 * 当用户旋转 API Key、更换网关地址或切换百炼地域时，指纹会立即变化以淘汰旧快照
 */
export function computeCredentialFingerprint(
  envelope: ProviderCredentialEnvelope
): string {
  const server = envelope.metadata.serverAddress ?? ""
  const region = envelope.metadata.region ?? ""
  const teamOrOrg =
    envelope.metadata.teamID ??
    envelope.metadata.organizationID ??
    envelope.accountID ??
    ""
  const canonical = [
    envelope.provider,
    envelope.kind,
    server,
    region,
    teamOrOrg,
    envelope.accessToken.trim(),
  ].join("\n")
  return sha256Hex(canonical)
}

/**
 * 封装用户输入或授权得到的原始凭证为统一 ProviderCredentialEnvelope
 */
export function buildCredentialEnvelope(params: {
  provider: ProviderId
  rawInput: string
  serverAddress?: string
  region?: string
  accountID?: string
  refreshToken?: string
  expiresAt?: string
  extraMetadata?: Record<string, string>
}): ProviderCredentialEnvelope {
  const { provider, rawInput, serverAddress, region, accountID, refreshToken, expiresAt, extraMetadata } =
    params
  const meta = getProviderMeta(provider)
  const trimmed = rawInput.trim()
  if (!trimmed) {
    throw new Error(`请输入 ${meta.credentialLabel}`)
  }

  // 若用户直接粘贴了已编码的 ProviderCredentialEnvelope JSON，则直接解包校验
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<ProviderCredentialEnvelope>
      if (parsed && parsed.provider === provider && typeof parsed.accessToken === "string" && parsed.accessToken.trim()) {
        const envelope: ProviderCredentialEnvelope = {
          provider,
          kind: parsed.kind ?? meta.credentialKind,
          accessToken: parsed.accessToken.trim(),
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          accountID: parsed.accountID,
          metadata: { ...(parsed.metadata ?? {}), ...(extraMetadata ?? {}) },
        }
        if (serverAddress) {
          envelope.metadata.serverAddress = normalizeGatewayServerAddress(serverAddress)
        }
        if (region) {
          envelope.metadata.region = region
        }
        envelope.metadata.sourceCredentialFingerprint = computeCredentialFingerprint(envelope)
        return envelope
      }
    } catch {
      // 非 Envelope JSON，继续走下方专项封装
    }
  }

  const metadata: Record<string, string> = { ...(extraMetadata ?? {}) }

  if (meta.requiresGatewayAddress) {
    metadata.serverAddress = normalizeGatewayServerAddress(serverAddress ?? "")
  } else if (serverAddress && serverAddress.trim()) {
    metadata.serverAddress = normalizeGatewayServerAddress(serverAddress)
  }

  if (meta.requiresRegion) {
    metadata.region = region || meta.regions?.[0]?.id || "cn-beijing"
  }

  // 专项多字段格式校验
  if (provider === "volcengine") {
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx <= 0 || colonIdx === trimmed.length - 1) {
      throw new Error("火山方舟密钥需按 AccessKeyID:SecretAccessKey 格式输入")
    }
    const ak = trimmed.slice(0, colonIdx).trim()
    const sk = trimmed.slice(colonIdx + 1).trim()
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(ak) || !sk) {
      throw new Error("火山引擎 AccessKeyID 或 SecretAccessKey 格式不合法")
    }
    const value = `${ak}:${sk}`
    const fp = sha256Hex(`volcengine\ncn-beijing\n${value}`)
    metadata.sourceCredentialFingerprint = fp
    return {
      provider,
      kind: "apiKey",
      accessToken: value,
      metadata,
    }
  }

  if (provider === "xaiAPI") {
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx <= 0 || colonIdx === trimmed.length - 1) {
      throw new Error("xAI 凭证需按 team_id:management_key 格式输入")
    }
    metadata.teamID = trimmed.slice(0, colonIdx).trim()
  }

  if (provider === "ibmBob") {
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx <= 0 || colonIdx === trimmed.length - 1) {
      throw new Error("IBM Bob 凭证需按 org_id:access_token 格式输入")
    }
    metadata.organizationID = trimmed.slice(0, colonIdx).trim()
  }

  if (provider === "workBuddy" && trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const rawObj = JSON.parse(trimmed) as Record<string, unknown>
      const authObj =
        rawObj.auth && typeof rawObj.auth === "object"
          ? (rawObj.auth as Record<string, unknown>)
          : rawObj
      const accObj =
        rawObj.account && typeof rawObj.account === "object"
          ? (rawObj.account as Record<string, unknown>)
          : rawObj
      const wbToken = String(
        authObj.accessToken ?? authObj.access_token ?? ""
      ).trim()
      if (!wbToken) {
        throw new Error("WorkBuddy 凭证 JSON 中缺少 accessToken")
      }
      const wbRefresh = String(
        authObj.refreshToken ?? authObj.refresh_token ?? ""
      ).trim()
      const wbDomain = String(authObj.domain ?? "").trim()
      const wbUid = String(accObj.uid ?? "").trim()
      const wbEnt = String(accObj.enterpriseId ?? accObj.enterprise_id ?? "").trim()
      const wbNick = String(accObj.nickname ?? "").trim()
      const rawExp = Number(authObj.expiresAt ?? authObj.expires_at ?? 0)
      const wbExpiresAt =
        rawExp > 0
          ? new Date(rawExp > 1e12 ? rawExp : rawExp * 1000).toISOString()
          : expiresAt
      if (wbDomain) {
        metadata.domain = wbDomain
        if (wbDomain.includes("workbuddy.ai") || wbDomain.includes("codebuddy.ai")) {
          metadata.region = "global"
        } else if (wbDomain.includes("tencent.com") || wbDomain.includes("codebuddy.cn")) {
          metadata.region = "cn"
        }
      }
      if (wbUid) metadata.uid = wbUid
      if (wbEnt) metadata.enterpriseId = wbEnt
      if (wbNick) metadata.nickname = wbNick
      const wbEnvelope: ProviderCredentialEnvelope = {
        provider: "workBuddy",
        kind: "oauth",
        accessToken: wbToken,
        refreshToken: wbRefresh || refreshToken,
        expiresAt: wbExpiresAt,
        accountID: wbUid || accountID,
        metadata,
      }
      wbEnvelope.metadata.sourceCredentialFingerprint =
        computeCredentialFingerprint(wbEnvelope)
      return wbEnvelope
    } catch (err) {
      if (err instanceof Error && err.message.includes("WorkBuddy")) {
        throw err
      }
      throw new Error("WorkBuddy JSON 格式无效，请粘贴合法的 workbuddy-<uid>.json 或 Access Token")
    }
  }

  const envelope: ProviderCredentialEnvelope = {
    provider,
    kind: meta.credentialKind,
    accessToken: trimmed,
    refreshToken,
    expiresAt,
    accountID,
    metadata,
  }
  envelope.metadata.sourceCredentialFingerprint = computeCredentialFingerprint(envelope)
  return envelope
}

export function saveEnvelopeToKeychain(
  keychainKey: string,
  envelope: ProviderCredentialEnvelope,
  synchronizable: boolean
): boolean {
  const payload = JSON.stringify(envelope)
  return Keychain.set(keychainKey, payload, { synchronizable })
}

export function loadEnvelopeFromKeychain(
  keychainKey: string,
  synchronizable: boolean
): ProviderCredentialEnvelope | null {
  let raw = Keychain.get(keychainKey, { synchronizable })
  if (!raw) {
    // 兼容回退另一同步域，防止用户切换开关后找不到旧凭证
    raw = Keychain.get(keychainKey, { synchronizable: !synchronizable })
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ProviderCredentialEnvelope
    if (parsed && typeof parsed.accessToken === "string" && parsed.provider) {
      return parsed
    }
  } catch {
    // 忽略损坏的 JSON
  }
  return null
}

export function removeEnvelopeFromKeychain(
  keychainKey: string,
  synchronizable: boolean
): void {
  Keychain.remove(keychainKey, { synchronizable })
  Keychain.remove(keychainKey, { synchronizable: !synchronizable })
}

export function loadStoredAccounts(): SubscriptionAccount[] {
  const list = Storage.get<SubscriptionAccount[]>(STORAGE_ACCOUNTS_KEY)
  if (!Array.isArray(list)) return []
  return list
}

export function saveStoredAccounts(accounts: SubscriptionAccount[]): void {
  Storage.set(STORAGE_ACCOUNTS_KEY, accounts)
}

export function loadStoredSnapshots(): Record<string, QuotaSnapshot> {
  const map = Storage.get<Record<string, QuotaSnapshot>>(STORAGE_SNAPSHOTS_KEY)
  if (!map || typeof map !== "object") return {}
  return map
}

export function saveStoredSnapshots(snapshots: Record<string, QuotaSnapshot>): void {
  Storage.set(STORAGE_SNAPSHOTS_KEY, snapshots)
}

export function loadDashboardSettings(): DashboardSettings {
  const saved = Storage.get<Partial<DashboardSettings>>(STORAGE_SETTINGS_KEY)
  if (!saved || typeof saved !== "object") {
    return { ...DEFAULT_SETTINGS }
  }
  return {
    isDemoMode: saved.isDemoMode ?? DEFAULT_SETTINGS.isDemoMode,
    autoRefreshOnLaunch:
      saved.autoRefreshOnLaunch ?? DEFAULT_SETTINGS.autoRefreshOnLaunch,
    prefersICloudKeychain:
      saved.prefersICloudKeychain ?? DEFAULT_SETTINGS.prefersICloudKeychain,
    groupByRouteCategory:
      saved.groupByRouteCategory ?? DEFAULT_SETTINGS.groupByRouteCategory,
    protectAccountIdentity:
      saved.protectAccountIdentity ?? DEFAULT_SETTINGS.protectAccountIdentity,
    widgetPrivacyEnabled:
      saved.widgetPrivacyEnabled ?? DEFAULT_SETTINGS.widgetPrivacyEnabled,
    widgetRefreshIntervalMinutes:
      saved.widgetRefreshIntervalMinutes ?? DEFAULT_SETTINGS.widgetRefreshIntervalMinutes,
  }
}

export function saveDashboardSettings(settings: DashboardSettings): void {
  Storage.set(STORAGE_SETTINGS_KEY, settings)
}
