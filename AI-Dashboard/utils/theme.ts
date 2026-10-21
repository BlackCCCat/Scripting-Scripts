import { Color } from "scripting"
import {
  ProviderId,
  ProviderLoginMethodType,
  ProviderRouteCategory,
  QuotaSnapshot,
} from "../models/types"

/**
 * 判断当前设备是否为 iOS 26 及以上系统
 * 按 AGENTS.md 规范在 iOS 26+ 启用原生玻璃按钮特性，低版本自动降级为系统标准样式
 */
export function isIOS26OrLater(): boolean {
  const version = parseFloat(Device.systemVersion || "0")
  return Number.isFinite(version) && version >= 26
}

export function adaptiveProminentButtonStyle():
  | "glassProminent"
  | "borderedProminent" {
  return isIOS26OrLater() ? "glassProminent" : "borderedProminent"
}

export function adaptiveSecondaryButtonStyle(): "glass" | "bordered" {
  return isIOS26OrLater() ? "glass" : "bordered"
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * Math.min(1, Math.max(0, t)))
}

function rgbToHex(r: number, g: number, b: number): Color {
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase()
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * 根据剩余额度百分比 (0 ~ 100) 返回平滑过渡颜色：
 * - 用完 (<= 0% 或 isExhausted)：返回灰色 systemGray
 * - 100% -> 60%：翠绿 (#34C759) -> 黄绿 (#8ADB28) [余量充足]
 * - 60%  -> 40%：黄绿 (#8ADB28) -> 明黄色 (#FFCC00) [余量适中]
 * - 40%  -> 15%：明黄 (#FFCC00) -> 鲜橙色 (#FF9500) [余量偏低]
 * - 15%  -> 0% ：鲜橙 (#FF9500) -> 警示红 (#FF3B30) [额度告急]
 */
export function remainingQuotaColor(
  remainingPercentage?: number | null,
  isExhausted?: boolean
): Color {
  if (
    isExhausted ||
    (remainingPercentage !== undefined &&
      remainingPercentage !== null &&
      remainingPercentage <= 0)
  ) {
    return "systemGray"
  }
  if (
    remainingPercentage === undefined ||
    remainingPercentage === null ||
    !Number.isFinite(remainingPercentage)
  ) {
    return "#34C759"
  }
  const rem = Math.min(100, Math.max(0, remainingPercentage))
  if (rem >= 60) {
    const t = (100 - rem) / (100 - 60)
    return rgbToHex(
      lerpChannel(0x34, 0x8a, t),
      lerpChannel(0xc7, 0xdb, t),
      lerpChannel(0x59, 0x28, t)
    )
  }
  if (rem >= 40) {
    const t = (60 - rem) / (60 - 40)
    return rgbToHex(
      lerpChannel(0x8a, 0xff, t),
      lerpChannel(0xdb, 0xcc, t),
      lerpChannel(0x28, 0x00, t)
    )
  }
  if (rem >= 15) {
    const t = (40 - rem) / (40 - 15)
    return rgbToHex(
      lerpChannel(0xff, 0xff, t),
      lerpChannel(0xcc, 0x95, t),
      lerpChannel(0x00, 0x00, t)
    )
  }
  const t = (15 - rem) / 15
  return rgbToHex(
    lerpChannel(0xff, 0xff, t),
    lerpChannel(0x95, 0x3b, t),
    lerpChannel(0x00, 0x30, t)
  )
}

import { formatWindowRemainingFraction } from "./quota_formatting"

export interface OverallQuotaSummary {
  remainingPercent: number // 0 ~ 100
  usedPercent: number // 0 ~ 100
  isExhausted: boolean
  isUnlimited: boolean
  isWalletOnly: boolean
  hasUsage: boolean
  label: string
  color: Color
  symbol: string
}

export function computeAccountOverallQuota(snapshot?: QuotaSnapshot): OverallQuotaSummary {
  if (!snapshot || snapshot.windows.length === 0) {
    return {
      remainingPercent: 100,
      usedPercent: 0,
      isExhausted: false,
      isUnlimited: false,
      isWalletOnly: false,
      hasUsage: false,
      label: "待刷新",
      color: "secondaryLabel",
      symbol: "clock.badge.questionmark",
    }
  }

  // 1. 过滤钱包与非配额窗口
  const quotaWindows = snapshot.windows.filter((w) => !w.wallet)
  if (quotaWindows.length === 0) {
    // 纯钱包/资金池类型
    const walletWindows = snapshot.windows.filter((w) => Boolean(w.wallet))
    const isExhausted = walletWindows.some((w) => w.isExhausted)
    return {
      remainingPercent: isExhausted ? 0 : 100,
      usedPercent: isExhausted ? 100 : 0,
      isExhausted,
      isUnlimited: false,
      isWalletOnly: true,
      hasUsage: false,
      label: isExhausted ? "余额已耗尽" : "钱包正常",
      color: isExhausted ? "systemGray" : "systemBlue",
      symbol: isExhausted ? "xmark.octagon.fill" : "creditcard.fill",
    }
  }

  // 2. 检查是否全为不限额/无限制窗口（如 Copilot）
  const nonUnlimited = quotaWindows.filter((w) => !w.isUnlimited)
  if (nonUnlimited.length === 0) {
    return {
      remainingPercent: 100,
      usedPercent: 0,
      isExhausted: false,
      isUnlimited: true,
      isWalletOnly: false,
      hasUsage: false,
      label: "不限次数 / 不限额",
      color: "systemGreen",
      symbol: "infinity",
    }
  }

  // 3. 提取参与整体额度统计的核心目标窗口：
  // 优先选取具备周/月周期的核心周期配额（例如 Antigravity 的 Gemini 周配额、Claude/GPT 周配额、Gemini 4 Argon，与柱状图完全对齐）
  const cycleWindows = nonUnlimited.filter(
    (w) => w.period === "weekly" || w.period === "monthly"
  )
  const targetWindows = cycleWindows.length > 0 ? cycleWindows : nonUnlimited

  const fractions: {
    remPct: number
    hasUsage: boolean
    isExhausted: boolean
  }[] = []

  for (const win of targetWindows) {
    if (win.isExhausted) {
      fractions.push({ remPct: 0, hasUsage: true, isExhausted: true })
      continue
    }

    let remPct: number | null = null
    let hasUsage = false

    // 优先采用精准计数（如 WorkBuddy 积分等）
    if (
      win.exactCounts?.remaining !== undefined &&
      win.exactCounts?.total !== undefined &&
      win.exactCounts.total > 0
    ) {
      const used =
        win.exactCounts.used ?? (win.exactCounts.total - win.exactCounts.remaining)
      hasUsage = used > 0
      const frac = win.exactCounts.remaining / win.exactCounts.total
      remPct = Math.round(frac * 100)
      if (hasUsage && win.exactCounts.remaining < win.exactCounts.total && remPct >= 100) {
        remPct = 99
      }
      if (win.exactCounts.remaining > 0 && remPct <= 0) {
        remPct = 1
      }
    } else if (
      win.remainingCount !== undefined &&
      win.totalCount !== undefined &&
      win.totalCount > 0
    ) {
      const used = win.totalCount - win.remainingCount
      hasUsage = used > 0
      const frac = win.remainingCount / win.totalCount
      remPct = Math.round(frac * 100)
      if (hasUsage && win.remainingCount < win.totalCount && remPct >= 100) {
        remPct = 99
      }
      if (win.remainingCount > 0 && remPct <= 0) {
        remPct = 1
      }
    } else if (win.usedPercentage !== undefined && Number.isFinite(win.usedPercentage)) {
      hasUsage = win.usedPercentage > 0
      remPct = Math.round(100 - win.usedPercentage)
      if (hasUsage && remPct >= 100) {
        remPct = 99
      }
      if (win.usedPercentage < 100 && remPct <= 0) {
        remPct = 1
      }
    } else {
      const frac = formatWindowRemainingFraction(win)
      if (frac !== null) {
        remPct = Math.round(frac * 100)
        hasUsage = remPct < 100
      }
    }

    if (remPct !== null) {
      fractions.push({
        remPct,
        hasUsage,
        isExhausted: remPct <= 0,
      })
    }
  }

  if (fractions.length === 0) {
    return {
      remainingPercent: 100,
      usedPercent: 0,
      isExhausted: false,
      isUnlimited: false,
      isWalletOnly: false,
      hasUsage: false,
      label: "已连接",
      color: "systemGreen",
      symbol: "checkmark.circle.fill",
    }
  }

  const sumRemaining = fractions.reduce((acc, f) => acc + f.remPct, 0)
  let finalRemPct = Math.round(sumRemaining / fractions.length)
  const anyUsed = fractions.some((f) => f.hasUsage)
  const allExhausted = fractions.every((f) => f.isExhausted)

  // 全局防呆与对齐：只要产生了消耗，且没有全部剩余，不能显示 100%
  if (anyUsed && finalRemPct >= 100) {
    finalRemPct = 99
  }
  // 只要还有余量，且不是所有窗口都耗尽，不能显示 0%
  if (!allExhausted && finalRemPct <= 0) {
    finalRemPct = 1
  }

  const isExhausted = allExhausted || finalRemPct <= 0
  if (isExhausted) {
    finalRemPct = 0
  }
  const finalUsedPct = 100 - finalRemPct
  const dynamicColor = isExhausted
    ? "systemGray"
    : remainingQuotaColor(finalRemPct, false)

  let label: string
  let symbol: string
  if (isExhausted) {
    label = "额度已耗尽 (0%)"
    symbol = "xmark.octagon.fill"
  } else if (finalRemPct <= 15) {
    label = `额度告急 (${finalRemPct}%)`
    symbol = "exclamationmark.octagon.fill"
  } else if (finalRemPct <= 40) {
    label = `余量偏低 (${finalRemPct}%)`
    symbol = "exclamationmark.triangle.fill"
  } else if (finalRemPct <= 60) {
    label = `余量适中 (${finalRemPct}%)`
    symbol = "exclamationmark.circle.fill"
  } else {
    label = `余量充足 (${finalRemPct}%)`
    symbol = "checkmark.circle.fill"
  }

  return {
    remainingPercent: finalRemPct,
    usedPercent: finalUsedPct,
    isExhausted,
    isUnlimited: false,
    isWalletOnly: false,
    hasUsage: anyUsed,
    label,
    color: dynamicColor,
    symbol,
  }
}

export function accountHealthSummary(snapshot?: QuotaSnapshot): {
  label: string
  color: Color
  symbol: string
} {
  const overall = computeAccountOverallQuota(snapshot)
  return {
    label: overall.label,
    color: overall.color,
    symbol: overall.symbol,
  }
}

export function providerBrandBadgeBgColor(_provider: ProviderId): Color {
  return "quaternarySystemFill"
}

export function routeCategoryTitle(category: ProviderRouteCategory): string {
  switch (category) {
    case "direct_api":
      return "直连 API 密钥 / 令牌"
    case "gateway":
      return "自建与聚合网关"
    case "device_oauth":
      return "OAuth 设备码与轮询"
    case "google_oauth":
      return "Google 原生 OAuth"
    case "web_session":
      return "Web 会话与工作台"
  }
}

export function routeCategorySymbol(category: ProviderRouteCategory): string {
  switch (category) {
    case "direct_api":
      return "key.fill"
    case "gateway":
      return "server.rack"
    case "device_oauth":
      return "qrcode.viewfinder"
    case "google_oauth":
      return "person.badge.key.fill"
    case "web_session":
      return "globe"
  }
}

export function loginMethodBadgeText(method: ProviderLoginMethodType): string {
  switch (method) {
    case "apiKey":
      return "API 密钥"
    case "deviceCode":
      return "设备码授权"
    case "webSession":
      return "Web 会话"
    case "authorizationCode":
      return "OAuth 授权"
  }
}

/**
 * 格式化看板卡片名称右侧的账户类型胶囊标签（如 Free、Pro、Plus、Max、Team、Enterprise、API、Coding Plan）
 */
export function formatAccountTypeBadge(
  provider: ProviderId,
  rawPlanName?: string,
  loginMethod?: ProviderLoginMethodType
): string {
  if (rawPlanName && rawPlanName.trim()) {
    const raw = rawPlanName.trim()

    if (/企业分组/.test(raw)) return "企业分组"
    if (/coding\s*plan/i.test(raw)) return "Coding Plan"
    if (/agent\s*plan/i.test(raw)) return "Agent Plan"
    if (/企业|enterprise/i.test(raw)) return "Enterprise"
    if (/团队|\bteam\b|\bbusiness\b/i.test(raw)) return "Team"
    if (/\bmax\b|\bultra\b/i.test(raw)) return "Max"
    if (/\bplus\b/i.test(raw)) return "Plus"
    if (
      /免费|体验|试用|赠送|新人|基础|个人|\bfree\b|\btrial\b|\bhobby\b|\bstarter\b/i.test(
        raw
      )
    ) {
      return "Free"
    }
    if (/专业|旗舰|尊享|\bpro\b|\bindividual\b/i.test(raw)) return "Pro"
    if (/\bapi\b|开放平台/i.test(raw)) return "API"

    const cleaned = raw
      .replace(/\s*\(.*?\)\s*/g, "")
      .replace(/^CodeBuddy\s*/i, "")
      .replace(/^WorkBuddy\s*/i, "")
      .replace(/^ChatGPT\s+/i, "")
      .replace(/^OpenAI\s+Codex\s*/i, "")
      .replace(/^Claude\s+(Web\s*)?/i, "")
      .replace(/^Cursor\s+/i, "")
      .replace(/^GitHub\s+Copilot\s*/i, "")
      .replace(/^Copilot\s+/i, "")
      .replace(/^Gemini\s+(Code\s+Assist\s*)?/i, "")
      .replace(/^Google\s+Antigravity\s*/i, "")
      .replace(/^MiniMax\s+(Coding\s+Plan\s+)?/i, "")
      .replace(/^火山方舟\s*(Ark\s*)?/i, "")
      .replace(/^DeepSeek\s*/i, "")
      .trim()

    if (cleaned && cleaned.length <= 12) {
      if (provider === "workBuddy") return "Free"
      return cleaned
    }
  }

  if (provider === "workBuddy") {
    return "Free"
  }
  if (loginMethod === "apiKey" || provider === "deepSeek") {
    return "API"
  }
  return "Pro"
}

/**
 * 格式化账户所属区域徽章（如 [中国站] / [国际站]）
 * 用于同一供应商合并后在仪表盘卡片头部直观区分
 */
export function formatAccountRegionBadge(
  provider: ProviderId,
  region?: string
): string | null {
  if (provider === "miniMaxChina" || provider === "qoderChina") return "中国站"
  if (provider === "miniMaxInternational" || provider === "qoderInternational")
    return "国际站"
  if (!region) return null
  const lower = region.toLowerCase()
  if (
    lower === "cn" ||
    lower === "china" ||
    lower.includes("beijing") ||
    lower === "chinese"
  ) {
    return "中国站"
  }
  if (
    lower === "global" ||
    lower === "international" ||
    lower.includes("us") ||
    lower.includes("southeast")
  ) {
    return "国际站"
  }
  return region
}

/**
 * 对邮箱、手机号或账号名称进行遮罩处理，中间替换为 ****
 * 示例：
 * - 360252749zzx@gmail.com -> 36****x@gmail.com
 * - 13812345678 -> 138****5678
 * - user_01J9DEMO -> use****EMO
 * - dev -> d****
 */
export function maskIdentity(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (trimmed.includes("@")) {
    const atIndex = trimmed.indexOf("@")
    const username = trimmed.slice(0, atIndex)
    const domain = trimmed.slice(atIndex)
    if (username.length <= 2) {
      return `${username.charAt(0)}****${domain}`
    }
    const lead = Math.min(2, Math.floor(username.length / 3)) || 1
    const tail = username.length > 4 ? username.slice(-1) : ""
    return `${username.slice(0, lead)}****${tail}${domain}`
  }
  if (/^1\d{10}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}****${trimmed.slice(7)}`
  }
  if (trimmed.length <= 4) {
    return `${trimmed.slice(0, 1)}****`
  }
  const keep = Math.min(3, Math.floor(trimmed.length / 3)) || 1
  return `${trimmed.slice(0, keep)}****${trimmed.slice(-keep)}`
}

/**
 * 尝试从 JWT 令牌载荷中解析身份信息 (Email / Phone / Username / Sub)
 */
export function tryExtractIdentityFromJWT(token: string): string | null {
  if (!token || typeof token !== "string") return null
  try {
    const parts = token.split(".")
    if (parts.length >= 2) {
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
      while (b64.length % 4) b64 += "="
      const raw = Data.fromBase64String(b64)?.toRawString()
      if (raw) {
        const payload = JSON.parse(raw) as Record<string, unknown>
        if (typeof payload.email === "string" && payload.email.trim()) {
          return payload.email.trim()
        }
        if (
          typeof payload.phone_number === "string" &&
          payload.phone_number.trim()
        ) {
          return payload.phone_number.trim()
        }
        if (typeof payload.phone === "string" && payload.phone.trim()) {
          return payload.phone.trim()
        }
        if (
          typeof payload.preferred_username === "string" &&
          payload.preferred_username.trim()
        ) {
          return payload.preferred_username.trim()
        }
        if (
          typeof payload.unique_name === "string" &&
          payload.unique_name.trim()
        ) {
          return payload.unique_name.trim()
        }
        if (typeof payload.name === "string" && payload.name.trim()) {
          return payload.name.trim()
        }
        if (typeof payload.sub === "string" && payload.sub.trim()) {
          const sub = payload.sub.trim()
          if (!sub.startsWith("auth0|") && !sub.startsWith("user-")) {
            return sub
          }
        }
      }
    }
  } catch {}
  return null
}


