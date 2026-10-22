import type { Color } from "scripting"
import type {
  ProviderId,
  QuotaPeriod,
  WalletBalance,
} from "../models/types"

export type WidgetQuotaItem = {
  id: string
  name: string
  period?: QuotaPeriod
  usedPercentage: number
  remainingPercentage: number
  remainingCount?: number
  totalCount?: number
  unit?: string
  isExhausted: boolean
  isUnlimited: boolean
  resetsAt?: string // ISO 8601
  resetCountdownText?: string
  isBalanceOnly?: boolean
  balanceText?: string
}

export type WidgetAccountData = {
  id: string
  provider: ProviderId
  displayName: string
  planName: string
  identity?: string
  region?: string
  isWallet: boolean
  wallet?: WalletBalance
  quotas: WidgetQuotaItem[]
  worstUsedPercentage: number
  overallStatus: "normal" | "warning" | "exhausted"
  statusColor?: Color
  earliestResetCountdown?: string
  codexResetForecast?: {
    scheduledText?: string
    probabilityText?: string
    status: "active" | "forecast" | "normal"
  }
  codexResetCardsCount?: number
  widgetOrder?: number
  updateStatusText?: string
  isUpdateWarning?: boolean
}

export type WidgetRenderData = {
  accounts: WidgetAccountData[]
  totalAccountsCount: number
  totalWalletUSD: number
  totalWalletCNY: number
  hasCodexForecast: boolean
  lastUpdatedAt: string
  updateStatusText?: string
  isUpdateWarning?: boolean
  isDemoMode: boolean
  widgetPrivacyEnabled?: boolean
  widgetQuotaAdaptTransparent?: boolean
  widgetConnectionAdaptTransparent?: boolean
  parameterTokensCount: number
}
