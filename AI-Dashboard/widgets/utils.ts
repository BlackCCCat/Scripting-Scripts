import type { Color } from "scripting"
import type { ProviderId } from "../models/types"
import { getProviderMeta } from "../utils/providers_catalog"

/**
 * 获取与主程序卡片完全一致的显示标题，防止超长截断或显示不一致
 */
export function simplifyDisplayName(raw: string): string {
  return raw
    .replace(/\s*[\(（][^()（）]*[\)）]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim() || raw
}

export function getAccountDisplayTitle(
  account: { id: string; provider: ProviderId; displayName?: string; region?: string },
  snapshot?: { region?: string } | null
): string {
  const meta = getProviderMeta(account.provider)
  const isWorkBuddyGlobal =
    account.provider === "workBuddy" &&
    (account.region === "global" || snapshot?.region === "global")
  const defaultProviderName = isWorkBuddyGlobal
    ? "Workbuddy AI"
    : meta.displayName
  const rawDisplayName = account.displayName?.trim() || ""

  // 如果是演示账号或未重命名，优先使用供应商标准名称（如 "Codex" 而非过长的 "OpenAI Codex"）
  let finalName = defaultProviderName
  if (!account.id.startsWith("demo-") && rawDisplayName) {
    finalName = rawDisplayName
  } else if (rawDisplayName === "WorkBuddy" && isWorkBuddyGlobal) {
    finalName = "Workbuddy AI"
  }
  return simplifyDisplayName(finalName)
}

/**
 * 格式化剩余重置倒计时（简洁小组件风格）
 */
export function formatWidgetCountdown(resetsAtISO?: string): string {
  if (!resetsAtISO) return ""
  const target = new Date(resetsAtISO).getTime()
  if (Number.isNaN(target)) return ""
  const diffMs = target - Date.now()
  if (diffMs <= 0) return "已可重置"

  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays >= 2) {
    return `${diffDays}天后重置`
  }
  if (diffDays === 1) {
    const remainHours = diffHours % 24
    return `1天${remainHours > 0 ? `${remainHours}h` : ""}后`
  }
  if (diffHours >= 1) {
    const remainMin = diffMin % 60
    return `${diffHours}h${remainMin > 0 ? `${remainMin}m` : ""}后`
  }
  if (diffMin > 0) {
    return `${diffMin}分钟后`
  }
  return "即将重置"
}

/**
 * 精简模型窗口名称以完美适配小组件紧凑空间
 */
export function shortenQuotaWindowName(
  rawName: string,
  provider?: ProviderId
): string {
  const trimmed = rawName.trim()
  if (!trimmed) return "配额"

  // Antigravity 特殊处理
  if (provider === "antigravity") {
    if (/argon/i.test(trimmed)) return "Gemini 4"
    if (/gemini.*5/i.test(trimmed)) return "Gemini 5h"
    if (/gemini.*周/i.test(trimmed)) return "Gemini 周"
    if (/claude.*5/i.test(trimmed)) return "Claude 5h"
    if (/claude.*周/i.test(trimmed)) return "Claude 周"
  }

  // Codex 特殊处理：5小时额度、周额度、Credits余额
  if (provider === "codex") {
    if (/5|five/i.test(trimmed)) return "5小时额度"
    if (/周|week|7/i.test(trimmed)) return "周额度"
    if (/credit/i.test(trimmed)) return "Credits余额"
  }

  // Copilot 特殊处理
  if (provider === "copilot") {
    if (/chat/i.test(trimmed)) return "Chat"
    if (/completions|补全/i.test(trimmed)) return "补全"
  }

  // WorkBuddy
  if (provider === "workBuddy") {
    if (/总/i.test(trimmed)) return "总配额"
    if (/日|daily/i.test(trimmed)) return "日限额"
  }

  return trimmed
    .replace(/配额|使用量|限额|额度/g, "")
    .replace(/Model\s*/i, "")
    .trim() || trimmed
}

/**
 * 根据消耗百分比获取状态颜色
 */
export function getQuotaStatusColor(usedPercentage: number): Color {
  if (usedPercentage >= 100) return "systemRed"
  if (usedPercentage >= 80) return "systemOrange"
  if (usedPercentage >= 60) return "systemYellow"
  return "systemGreen"
}

/**
 * 进度条背景浅槽色
 */
export function getProgressBarTrackColor(): Color {
  return "quaternarySystemFill"
}

/**
 * 货币金额快速格式化
 */
export function formatCurrencyAmount(amount: number, currency = "USD"): string {
  const isCNY = /CNY|RMB|¥/i.test(currency)
  const symbol = isCNY ? "¥" : "$"
  return `${symbol}${amount.toFixed(2)}`
}
