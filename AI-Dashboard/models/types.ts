export type ProviderId =
  | "abacus"
  | "aixy"
  | "alibabaCodingPlan"
  | "alibabaTokenPlan"
  | "amp"
  | "antigravity"
  | "atlasCloud"
  | "augmentCode"
  | "bifrost"
  | "chutes"
  | "claude"
  | "clawRouter"
  | "clinePass"
  | "codebuff"
  | "codex"
  | "commandCode"
  | "copilot"
  | "cursor"
  | "deepInfra"
  | "deepSeek"
  | "devin"
  | "devPass"
  | "elevenLabs"
  | "factory"
  | "gemini"
  | "gitKraken"
  | "grokBot"
  | "huggingFace"
  | "hyper"
  | "ibmBob"
  | "kiloCode"
  | "kimiCode"
  | "kiro"
  | "liteLLM"
  | "llmProxy"
  | "longCat"
  | "manus"
  | "miniMax"
  | "miniMaxChina"
  | "miniMaxInternational"
  | "mistral"
  | "moonshot"
  | "neuralwatt"
  | "newAPI"
  | "notionAI"
  | "nousPortal"
  | "ollamaCloud"
  | "openAIAPI"
  | "openCodeGo"
  | "perplexity"
  | "poe"
  | "qoder"
  | "qoderChina"
  | "qoderInternational"
  | "qwenCloud"
  | "raycastAI"
  | "replicate"
  | "sakana"
  | "stepFun"
  | "sub2api"
  | "superGrok"
  | "synthetic"
  | "t3Chat"
  | "trae"
  | "typeSafe"
  | "v0"
  | "v2ex"
  | "venice"
  | "vercelAIGateway"
  | "volcengine"
  | "warp"
  | "windsurf"
  | "workBuddy"
  | "xaiAPI"
  | "xiaomiCodingPlan"
  | "xKiro"
  | "zai"
  | "zed"
  | "zenMux"
  | "zhipu"
  | "zoomMate"

export type ProviderCredentialKind = "apiKey" | "oauth" | "session"

export type ProviderLoginMethodType =
  | "apiKey"
  | "deviceCode"
  | "webSession"
  | "authorizationCode"

/**
 * 对应《TokenPulse AI接入方式分析报告》中的 6 大接入路径分类
 */
export type ProviderRouteCategory =
  | "direct_api"
  | "gateway"
  | "device_oauth"
  | "google_oauth"
  | "web_session"

export interface ProviderCredentialEnvelope {
  provider: ProviderId
  kind: ProviderCredentialKind
  accessToken: string
  refreshToken?: string
  expiresAt?: string // ISO 8601
  accountID?: string
  metadata: Record<string, string>
}

export type QuotaPeriod = "fiveHour" | "weekly" | "monthly" | "other"

export type QuotaResetSemantics =
  | "resets"
  | "nonResettingAllowance"
  | "replenishes"

export interface WalletBalance {
  currency: string
  total: number
  granted?: number
  toppedUp?: number
  isMonetary: boolean
}

export interface DecimalQuotaCounts {
  used?: number
  remaining?: number
  total?: number
}

export interface QuotaWindow {
  id: string
  name: string
  scope?: string
  period?: QuotaPeriod
  isExhausted?: boolean
  isUnlimited?: boolean
  usedPercentage?: number
  remainingCount?: number
  totalCount?: number
  resetsAt?: string // ISO 8601
  cycleID?: string
  unit?: string
  expiresAt?: string // ISO 8601
  wallet?: WalletBalance
  overagePermitted?: boolean
  overageCount?: number
  exactCounts?: DecimalQuotaCounts
  resetSemantics?: QuotaResetSemantics
}

export interface QuotaSnapshot {
  accountID: string
  windows: QuotaWindow[]
  collectedAt: string // ISO 8601
  providerPlanName?: string
  accountIdentity?: string
  sourceCredentialFingerprint?: string
  region?: string
  codexResetCards?: {
    availableCount: number
    expirations?: string[]
  }
}

export type RefreshFailureCode =
  | "missingCredential"
  | "invalidCredential"
  | "unsupportedProvider"
  | "rateLimited"
  | "network"
  | "unreadableResponse"
  | "noQuotaWindows"
  | "subscriptionRequired"
  | "server"

export interface SubscriptionAccount {
  id: string
  provider: ProviderId
  displayName: string
  credentialKeychainKey: string
  createdAt: string // ISO 8601
  lastSuccessAt?: string // ISO 8601
  isEnabled: boolean
  preferssynchronizableKeychain: boolean
  serverAddress?: string
  region?: string
  widgetOrder?: number // 小组件合并与排序显示序号 (可选，从 1 起)
}

export type AccountQuotaState =
  | { type: "idle" }
  | { type: "loading"; previous?: QuotaSnapshot }
  | { type: "loaded"; snapshot: QuotaSnapshot }
  | {
      type: "failed"
      failure: RefreshFailureCode
      detail?: string
      previous?: QuotaSnapshot
    }

export interface ProviderQueryResult {
  snapshot: QuotaSnapshot
  updatedCredential?: ProviderCredentialEnvelope
}

/**
 * 每个独立平台脚本统一导出的额度查询处理函数签名
 */
export type ProviderQuotaHandler = (
  accountID: string,
  envelope: ProviderCredentialEnvelope,
  collectedAt: string
) => Promise<QuotaSnapshot>

export interface ProviderLoginSession {
  provider: ProviderId
  authorizationURL: string
  userCode?: string
  deviceCode?: string
  state?: string
  codeVerifier?: string
  callbackURL?: string
  pollingInterval: number
  expiresAt?: string // ISO 8601
  metadata: Record<string, string>
}

export type ProviderLoginProgress =
  | { status: "pending"; retryAfter: number }
  | { status: "completed"; credential: string }

export interface WebSessionProfile {
  loginURL: string
  allowedHosts: string[]
  cookieNames: string[]
  localStorageKeys?: string[]
  authHeaderCookieName?: string
}

export interface ProviderMeta {
  id: ProviderId
  displayName: string
  aliases: string[]
  routeCategory: ProviderRouteCategory
  credentialKind: ProviderCredentialKind
  loginMethod: ProviderLoginMethodType
  symbolName: string
  credentialLabel: string
  credentialPrompt: string
  credentialHelp?: string
  requiresGatewayAddress?: boolean
  gatewayDefaultPort?: string
  requiresRegion?: boolean
  regions?: { id: string; label: string }[]
  endpointSummary: string
  authSummary: string
  webSessionProfile?: WebSessionProfile
}

export interface DashboardSettings {
  isDemoMode: boolean
  autoRefreshOnLaunch: boolean
  prefersICloudKeychain: boolean
  groupByRouteCategory: boolean
  protectAccountIdentity: boolean
  widgetPrivacyEnabled?: boolean
  widgetRefreshIntervalMinutes?: number
}
