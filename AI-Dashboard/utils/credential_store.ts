import {
  DashboardSettings,
  ProviderCredentialEnvelope,
  ProviderId,
  QuotaSnapshot,
  SubscriptionAccount,
} from "../models/types"
import { getProviderMeta, PROVIDERS_CATALOG } from "./providers_catalog"

const STORAGE_ACCOUNTS_KEY = "ai_dashboard.accounts.v1"
const STORAGE_SNAPSHOTS_KEY = "ai_dashboard.snapshots.v1"
const STORAGE_SETTINGS_KEY = "ai_dashboard.settings.v1"
const CLOUD_ACCOUNTS_KEY = "ai_dashboard.sync.accounts.v1"

export const DEFAULT_SETTINGS: DashboardSettings = {
  isDemoMode: true,
  autoRefreshOnLaunch: true,
  prefersICloudKeychain: false,
  groupByRouteCategory: false,
  protectAccountIdentity: false,
  widgetPrivacyEnabled: true,
  widgetRefreshIntervalMinutes: 30,
  widgetQuotaAdaptTransparent: false,
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
    let parsed: Partial<ProviderCredentialEnvelope> | null = null
    try {
      parsed = JSON.parse(trimmed) as Partial<ProviderCredentialEnvelope>
    } catch {
      // 非 Envelope JSON，继续走下方专项封装
    }
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
      if (provider === "openAIAPI" || provider === "anthropic") {
        delete envelope.metadata.serverAddress
      }
      if (region) envelope.metadata.region = region
      envelope.metadata.sourceCredentialFingerprint = computeCredentialFingerprint(envelope)
      return envelope
    }
  }

  const metadata: Record<string, string> = { ...(extraMetadata ?? {}) }
  if (provider === "openAIAPI" || provider === "anthropic") {
    delete metadata.serverAddress
  }

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
  return Keychain.set(keychainKey, payload, {
    synchronizable,
    accessibility: synchronizable ? "first_unlock" : "first_unlock_this_device",
  })
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

/**
 * 规范化生成账号的 Keychain Key（UID）：
 * 格式：`ai_dashboard.cred.<provider>[.<accountInfo>]`
 * - 增加供应商信息（provider）；
 * - 当同一供应商存在多个账号（或指定了个性化别名/邮箱/身份）时，自动补充账号信息便于区分；
 * - 确保唯一性与多脚本互通性，方便其他脚本按前缀识别或通过 Keychain.pick() 挑选使用。
 */
export function generateAccountKeychainKey(params: {
  provider: ProviderId
  accountId?: string
  displayName?: string
  envelope?: ProviderCredentialEnvelope
  existingAccounts?: SubscriptionAccount[]
}): string {
  const { provider, accountId, displayName, envelope, existingAccounts = [] } = params

  // 1. 基础前缀包含供应商信息
  const prefix = `ai_dashboard.cred.${provider}`

  // 2. 查找同一供应商下的其他账号（排除自身）
  const otherSameProviderAccounts = existingAccounts.filter(
    (a) => a.provider === provider && (!accountId || a.id !== accountId)
  )

  // 3. 提取可识别的账号信息 (displayName / email / accountID / username)
  const meta = getProviderMeta(provider)
  const defaultProviderName = meta?.displayName ?? provider
  const candidateInfo = (
    displayName?.trim() ||
    envelope?.metadata?.displayName ||
    envelope?.metadata?.accountEmail ||
    envelope?.metadata?.username ||
    envelope?.accountID ||
    ""
  ).trim()

  // 判断是否为单纯的默认供应商名（如 "DeepSeek" 或 "deepSeek"）
  const isDefaultName =
    !candidateInfo ||
    candidateInfo.toLowerCase() === defaultProviderName.toLowerCase() ||
    candidateInfo.toLowerCase() === provider.toLowerCase()

  // 过滤并规范化字符，替换特殊分隔符（保留中文、英文字母、数字）
  const sanitize = (str: string) =>
    str.replace(/[.:/\\#?&@\s]+/g, "_").replace(/^[._]+|[._]+$/g, "").trim()

  let baseKey = prefix
  if (otherSameProviderAccounts.length > 0) {
    // 存在同供应商多个账号：必须携带区分后缀
    if (!isDefaultName) {
      baseKey = `${prefix}.${sanitize(candidateInfo)}`
    } else {
      // 默认名称则按序号补充（如 账号2）
      const index = otherSameProviderAccounts.length + 1
      baseKey = `${prefix}.账号${index}`
    }
  } else {
    // 单一账号：如果用户显式指定了个性化别名/邮箱，附加以利识别；否则保留纯前缀
    if (!isDefaultName) {
      baseKey = `${prefix}.${sanitize(candidateInfo)}`
    } else {
      baseKey = prefix
    }
  }

  // 4. 确保在全部已有账号中不发生键名冲突
  let finalKey = baseKey
  let counter = 2
  const isKeyOccupied = (key: string) =>
    existingAccounts.some(
      (a) => a.credentialKeychainKey === key && (!accountId || a.id !== accountId)
    )

  while (isKeyOccupied(finalKey)) {
    finalKey = `${baseKey}_${counter}`
    counter++
  }

  return finalKey
}

/**
 * 自动平滑升级旧版纯 UUID 的 Keychain Key（UID）：
 * 将 `ai_dashboard.cred.<uuid>` 平滑迁移为包含供应商与账号信息的规范键名。
 */
export function migrateLegacyAccountKeychainKeys(
  accounts: SubscriptionAccount[]
): boolean {
  let changed = false
  for (const acc of accounts) {
    const isOldUuidKey =
      /^ai_dashboard\.cred\.[0-9a-fA-F-]{36}$/.test(acc.credentialKeychainKey) ||
      acc.credentialKeychainKey === `ai_dashboard.cred.${acc.id}`

    if (isOldUuidKey) {
      const envelope = loadEnvelopeFromKeychain(
        acc.credentialKeychainKey,
        acc.preferssynchronizableKeychain
      )
      if (envelope) {
        const newKey = generateAccountKeychainKey({
          provider: acc.provider,
          accountId: acc.id,
          displayName: acc.displayName,
          envelope,
          existingAccounts: accounts,
        })
        if (newKey !== acc.credentialKeychainKey) {
          const saved = saveEnvelopeToKeychain(
            newKey,
            envelope,
            acc.preferssynchronizableKeychain
          )
          if (saved) {
            removeEnvelopeFromKeychain(
              acc.credentialKeychainKey,
              acc.preferssynchronizableKeychain
            )
            acc.credentialKeychainKey = newKey
            changed = true
          }
        }
      }
    }
  }
  if (changed) {
    saveStoredAccounts(accounts)
  }
  return changed
}

export function loadStoredAccounts(): SubscriptionAccount[] {
  const list = Storage.get<SubscriptionAccount[]>(STORAGE_ACCOUNTS_KEY)
  if (!Array.isArray(list)) return []
  return list
}

export function saveStoredAccounts(accounts: SubscriptionAccount[]): boolean {
  const previous = loadStoredAccounts()
  if (!Storage.set(STORAGE_ACCOUNTS_KEY, accounts)) return false
  if (loadDashboardSettings().prefersICloudKeychain) {
    try {
      updateCloudAccountIndex(previous, accounts)
    } catch {
      // 本地账号已保存；下次打开设置或脚本时会再次同步索引。
      console.warn("iCloud 账号索引暂未更新")
    }
  }
  return true
}

/**
 * 规整 Codex 历史快照中的配额窗口：
 * 对于所有 Pro 系列套餐，确保仅展示周度窗口，消除历史遗留的 5 小时限流窗口
 */
export function normalizeCodexSnapshot(snapshot: QuotaSnapshot): QuotaSnapshot {
  const isCodexSnapshot =
    Boolean(snapshot.codexResetCards) ||
    snapshot.windows.some((w) => w.id.startsWith("codex."))
  if (!isCodexSnapshot) return snapshot

  const plan = (snapshot.providerPlanName || "").toLowerCase()
  const isPro =
    plan.includes("pro") ||
    plan.includes("专业") ||
    plan.includes("旗舰") ||
    plan.includes("尊享")
  if (!isPro) return snapshot

  const nonWallet = snapshot.windows.filter((w) => !w.wallet)
  const has5h = nonWallet.some(
    (w) => w.period === "fiveHour" || /5|five/i.test(w.name)
  )
  if (!has5h) return snapshot

  // 如果只有一个非钱包窗口且被历史逻辑误标为 5 小时，直接纠正为周度窗口
  if (nonWallet.length === 1) {
    const correctedWindows = snapshot.windows.map((w) => {
      if (!w.wallet && (w.period === "fiveHour" || /5|five/i.test(w.name))) {
        return {
          ...w,
          id: "codex.weekly",
          name: "周度窗口",
          period: "weekly" as const,
        }
      }
      return w
    })
    return { ...snapshot, windows: correctedWindows }
  }

  // 如果同时存在 5 小时与周度窗口，过滤掉 5 小时窗口
  const filteredWindows = snapshot.windows.filter((w) => {
    if (w.wallet) return true
    return w.period !== "fiveHour" && !/5|five/i.test(w.name)
  })
  return { ...snapshot, windows: filteredWindows }
}

export function loadStoredSnapshots(): Record<string, QuotaSnapshot> {
  const map = Storage.get<Record<string, QuotaSnapshot>>(STORAGE_SNAPSHOTS_KEY)
  if (!map || typeof map !== "object") return {}
  const normalized: Record<string, QuotaSnapshot> = {}
  for (const [key, snap] of Object.entries(map)) {
    if (snap && typeof snap === "object" && Array.isArray(snap.windows)) {
      normalized[key] = normalizeCodexSnapshot(snap)
    } else {
      normalized[key] = snap
    }
  }
  return normalized
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
    widgetQuotaAdaptTransparent:
      saved.widgetQuotaAdaptTransparent ??
      saved.widgetConnectionAdaptTransparent ??
      DEFAULT_SETTINGS.widgetQuotaAdaptTransparent,
  }
}

export function saveDashboardSettings(settings: DashboardSettings): void {
  Storage.set(STORAGE_SETTINGS_KEY, settings)
}

const knownProviderIds = new Set<ProviderId>(PROVIDERS_CATALOG.map((item) => item.id))

function cloudAccountRecord(account: SubscriptionAccount): SubscriptionAccount {
  return {
    id: account.id,
    provider: account.provider,
    displayName: account.displayName,
    credentialKeychainKey: account.credentialKeychainKey,
    createdAt: account.createdAt,
    isEnabled: account.isEnabled,
    preferssynchronizableKeychain: true,
    serverAddress: account.serverAddress,
    region: account.region,
    widgetOrder: account.widgetOrder,
  }
}

function readCloudAccountIndex(): SubscriptionAccount[] {
  const raw = Keychain.get(CLOUD_ACCOUNTS_KEY, { synchronizable: true })
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("invalid index")
    const valid = parsed.filter((item): item is SubscriptionAccount => {
      if (!item || typeof item !== "object") return false
      const value = item as Partial<SubscriptionAccount>
      return typeof value.id === "string" && value.id.length > 0 &&
        typeof value.provider === "string" && knownProviderIds.has(value.provider as ProviderId) &&
        typeof value.displayName === "string" &&
        typeof value.credentialKeychainKey === "string" &&
        value.credentialKeychainKey.startsWith("ai_dashboard.") &&
        typeof value.createdAt === "string" &&
        typeof value.isEnabled === "boolean"
    })
    if (valid.length !== parsed.length) throw new Error("invalid index entry")
    return valid.map(cloudAccountRecord)
  } catch {
    throw new Error("iCloud 账号索引无法读取，请稍后重试")
  }
}

function credentialRawForAccount(account: SubscriptionAccount): string | null {
  const candidates = [account.preferssynchronizableKeychain, !account.preferssynchronizableKeychain]
    .map((synchronizable) => Keychain.get(account.credentialKeychainKey, { synchronizable }))
    .filter((raw): raw is string => typeof raw === "string")
  let best: { raw: string; expiresAt: number } | null = null
  for (const raw of candidates) {
    try {
      const envelope = JSON.parse(raw) as ProviderCredentialEnvelope
      if (envelope.provider !== account.provider || !envelope.accessToken?.trim()) continue
      const expiresAt = envelope.expiresAt ? Date.parse(envelope.expiresAt) : 0
      const score = Number.isFinite(expiresAt) ? expiresAt : 0
      if (!best || score > best.expiresAt) best = { raw, expiresAt: score }
    } catch {
      // 跳过损坏的凭据副本。
    }
  }
  return best?.raw ?? null
}

function credentialExpiry(raw: string | null): number {
  if (!raw) return 0
  try {
    const expiresAt = (JSON.parse(raw) as ProviderCredentialEnvelope).expiresAt
    const parsed = expiresAt ? Date.parse(expiresAt) : 0
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

function setKeychainChecked(key: string, raw: string, synchronizable: boolean): void {
  const previous = Keychain.get(key, { synchronizable })
  if (!Keychain.set(key, raw, {
    synchronizable,
    accessibility: synchronizable ? "first_unlock" : "first_unlock_this_device",
  }) || Keychain.get(key, { synchronizable }) !== raw) {
    if (previous === null) Keychain.remove(key, { synchronizable })
    else Keychain.set(key, previous, {
      synchronizable,
      accessibility: synchronizable ? "first_unlock" : "first_unlock_this_device",
    })
    throw new Error("钥匙串写入后无法回读")
  }
}

function updateCloudAccountIndex(
  previousAccounts: SubscriptionAccount[],
  accounts: SubscriptionAccount[]
): void {
  const existing = readCloudAccountIndex()
  const currentIDs = new Set(accounts.map((account) => account.id))
  const removedIDs = new Set(previousAccounts.filter((account) => !currentIDs.has(account.id)).map((account) => account.id))
  const synced = accounts.filter((account) =>
    account.preferssynchronizableKeychain &&
    credentialRawForAccount(account) !== null &&
    Keychain.get(account.credentialKeychainKey, { synchronizable: true }) !== null
  ).map(cloudAccountRecord)
  const verifiedIDs = new Set(synced.map((account) => account.id))
  const retained = existing.filter((account) => !verifiedIDs.has(account.id) && !removedIDs.has(account.id))
  const next = [...retained, ...synced]
  const raw = JSON.stringify(next)
  if (Keychain.get(CLOUD_ACCOUNTS_KEY, { synchronizable: true }) !== raw) {
    setKeychainChecked(CLOUD_ACCOUNTS_KEY, raw, true)
  }
}

export type DashboardKeychainSyncResult = {
  accounts: SubscriptionAccount[]
  settings: DashboardSettings
  moved: number
  restored: number
  cleanupFailed: number
}

/** 先写入并回读所有目标凭据，再提交账号及开关；失败时保留原位置。 */
export async function setDashboardKeychainSyncEnabled(
  enabled: boolean,
  onProgress?: (completed: number, total: number, phase: string) => void
): Promise<DashboardKeychainSyncResult> {
  const originalAccounts = loadStoredAccounts()
  const originalSettings = loadDashboardSettings()
  const cloudAccounts = enabled ? readCloudAccountIndex() : []
  const cloudByID = new Map(cloudAccounts.map((account) => [account.id, account]))
  const knownIDs = new Set(originalAccounts.map((account) => account.id))
  const restoredAccounts = cloudAccounts.filter((account) => {
    if (knownIDs.has(account.id) || credentialRawForAccount(account) === null) return false
    knownIDs.add(account.id)
    return true
  })
  const sourceAccounts = [...originalAccounts, ...restoredAccounts]
  const total = sourceAccounts.length + 2
  let completed = 0
  let moved = 0
  const written: { key: string; synchronizable: boolean; previous: string | null }[] = []
  const nextAccounts: SubscriptionAccount[] = []
  let accountsSaveAttempted = false
  let settingsSaveAttempted = false
  const progress = (phase: string) => onProgress?.(completed, total, phase)
  progress(enabled ? "正在检查现有登录凭据" : "正在保留本机登录凭据")

  const write = (key: string, raw: string, synchronizable: boolean) => {
    const previous = Keychain.get(key, { synchronizable })
    if (previous === raw) return
    if (!Keychain.set(key, raw, {
      synchronizable,
      accessibility: synchronizable ? "first_unlock" : "first_unlock_this_device",
    })) throw new Error("钥匙串写入失败")
    written.push({ key, synchronizable, previous })
    if (Keychain.get(key, { synchronizable }) !== raw) {
      throw new Error("钥匙串写入后无法回读")
    }
  }

  try {
    for (const account of sourceAccounts) {
      const localRaw = credentialRawForAccount(account)
      const remoteAccount = enabled ? cloudByID.get(account.id) : undefined
      const remoteRaw = remoteAccount ? credentialRawForAccount(remoteAccount) : null
      const raw = credentialExpiry(remoteRaw) > credentialExpiry(localRaw)
        ? remoteRaw
        : localRaw ?? remoteRaw
      if (!raw) throw new Error(`账号「${account.displayName}」的登录凭据不可读取，请先重新登录`)
      const alreadyInTarget = account.preferssynchronizableKeychain === enabled &&
        Keychain.get(account.credentialKeychainKey, { synchronizable: enabled }) !== null
      const targetKey = alreadyInTarget
        ? account.credentialKeychainKey
        : enabled
          ? `ai_dashboard.sync.cred.${account.id}`
          : `ai_dashboard.cred.${account.provider}.${account.id}`
      try {
        write(targetKey, raw, enabled)
      } catch {
        throw new Error(`账号「${account.displayName}」的${enabled ? "iCloud" : "本机"}凭据写入失败`)
      }
      if (!alreadyInTarget) moved++
      nextAccounts.push({
        ...account,
        credentialKeychainKey: targetKey,
        preferssynchronizableKeychain: enabled,
      })
      completed++
      progress(`已处理 ${account.displayName}`)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    if (JSON.stringify(loadStoredAccounts()) !== JSON.stringify(originalAccounts)) {
      throw new Error("同步期间账号列表发生变化，请重试")
    }
    if (JSON.stringify(loadDashboardSettings()) !== JSON.stringify(originalSettings)) {
      throw new Error("同步期间设置发生变化，请重试")
    }
    if (enabled && (nextAccounts.length > 0 || cloudAccounts.length > 0)) {
      const existing = cloudAccounts.filter((account) => !knownIDs.has(account.id))
      write(CLOUD_ACCOUNTS_KEY, JSON.stringify([...existing, ...nextAccounts.map(cloudAccountRecord)]), true)
    }
    completed++
    progress("已检查 iCloud 账号索引")

    const nextSettings = { ...loadDashboardSettings(), prefersICloudKeychain: enabled }
    accountsSaveAttempted = true
    if (!Storage.set(STORAGE_ACCOUNTS_KEY, nextAccounts)) throw new Error("账号列表保存失败")
    settingsSaveAttempted = true
    if (!Storage.set(STORAGE_SETTINGS_KEY, nextSettings)) throw new Error("iCloud 同步设置保存失败")
    completed++
    progress("同步设置已保存")
  } catch (error) {
    let rollbackFailed = false
    if (accountsSaveAttempted && !Storage.set(STORAGE_ACCOUNTS_KEY, originalAccounts)) rollbackFailed = true
    if (settingsSaveAttempted && !Storage.set(STORAGE_SETTINGS_KEY, originalSettings)) rollbackFailed = true
    for (const item of written.reverse()) {
      try {
        if (item.previous === null) {
          if (!Keychain.remove(item.key, { synchronizable: item.synchronizable }) &&
            Keychain.get(item.key, { synchronizable: item.synchronizable }) !== null) rollbackFailed = true
        } else if (!Keychain.set(item.key, item.previous, {
          synchronizable: item.synchronizable,
          accessibility: item.synchronizable ? "first_unlock" : "first_unlock_this_device",
        }) || Keychain.get(item.key, { synchronizable: item.synchronizable }) !== item.previous) rollbackFailed = true
      } catch {
        rollbackFailed = true
      }
    }
    if (rollbackFailed) throw new Error("iCloud 同步失败，部分回滚未完成；原登录凭据已保留，请勿删除账号并重试")
    throw error
  }

  let cleanupFailed = 0
  if (enabled) {
    for (const account of sourceAccounts) {
      try {
        const target = nextAccounts.find((item) => item.id === account.id)!
        if (Keychain.get(target.credentialKeychainKey, { synchronizable: true }) === null) {
          cleanupFailed++
          continue
        }
        if (Keychain.get(account.credentialKeychainKey, { synchronizable: false }) !== null &&
          !Keychain.remove(account.credentialKeychainKey, { synchronizable: false })) cleanupFailed++
        if (account.credentialKeychainKey !== target.credentialKeychainKey &&
          Keychain.get(account.credentialKeychainKey, { synchronizable: true }) !== null &&
          !Keychain.remove(account.credentialKeychainKey, { synchronizable: true })) cleanupFailed++
      } catch {
        cleanupFailed++
      }
    }
  }
  return {
    accounts: nextAccounts,
    settings: { ...originalSettings, prefersICloudKeychain: enabled },
    moved,
    restored: restoredAccounts.length,
    cleanupFailed,
  }
}
