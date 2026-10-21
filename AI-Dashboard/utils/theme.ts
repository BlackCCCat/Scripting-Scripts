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
 * - 100% -> 68%：翠绿 (#34C759) -> 黄绿 (#A2D228)
 * - 68%  -> 42%：黄绿 (#A2D228) -> 琥珀黄 (#FFB800)
 * - 42%  -> 18%：琥珀黄 (#FFB800) -> 橙红 (#FF6B00)
 * - 18%  -> 0% ：橙红 (#FF6B00) -> 警示红 (#FF3B30)
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
  if (rem >= 68) {
    const t = (100 - rem) / (100 - 68)
    return rgbToHex(
      lerpChannel(0x34, 0xa2, t),
      lerpChannel(0xc7, 0xd2, t),
      lerpChannel(0x59, 0x28, t)
    )
  }
  if (rem >= 42) {
    const t = (68 - rem) / (68 - 42)
    return rgbToHex(
      lerpChannel(0xa2, 0xff, t),
      lerpChannel(0xd2, 0xb8, t),
      lerpChannel(0x28, 0x00, t)
    )
  }
  if (rem >= 18) {
    const t = (42 - rem) / (42 - 18)
    return rgbToHex(
      lerpChannel(0xff, 0xff, t),
      lerpChannel(0xb8, 0x6b, t),
      lerpChannel(0x00, 0x00, t)
    )
  }
  const t = (18 - rem) / 18
  return rgbToHex(
    lerpChannel(0xff, 0xff, t),
    lerpChannel(0x6b, 0x3b, t),
    lerpChannel(0x00, 0x30, t)
  )
}

export function accountHealthSummary(snapshot?: QuotaSnapshot): {
  label: string
  color: Color
  symbol: string
} {
  if (!snapshot || snapshot.windows.length === 0) {
    return {
      label: "待刷新",
      color: "secondaryLabel",
      symbol: "clock.badge.questionmark",
    }
  }

  let maxUsed = 0
  let hasExhausted = false
  let hasQuotaWindow = false

  for (const w of snapshot.windows) {
    if (w.isExhausted) {
      hasExhausted = true
    }
    if (w.usedPercentage !== undefined && Number.isFinite(w.usedPercentage)) {
      hasQuotaWindow = true
      if (w.usedPercentage > maxUsed) {
        maxUsed = w.usedPercentage
      }
    } else if (
      w.remainingCount !== undefined &&
      w.totalCount !== undefined &&
      w.totalCount > 0
    ) {
      hasQuotaWindow = true
      const pct = ((w.totalCount - w.remainingCount) / w.totalCount) * 100
      if (pct > maxUsed) maxUsed = pct
    } else if (
      w.exactCounts?.total !== undefined &&
      w.exactCounts.total > 0 &&
      (w.exactCounts.used !== undefined || w.exactCounts.remaining !== undefined)
    ) {
      hasQuotaWindow = true
      const used =
        w.exactCounts.used !== undefined
          ? w.exactCounts.used
          : Math.max(0, w.exactCounts.total - (w.exactCounts.remaining ?? 0))
      const pct = (used / w.exactCounts.total) * 100
      if (pct > maxUsed) maxUsed = pct
    }
  }

  if (hasExhausted || hasQuotaWindow) {
    const remPct = hasExhausted
      ? 0
      : Math.max(0, Math.min(100, Math.round(100 - maxUsed)))
    const dynamicColor = remainingQuotaColor(remPct, hasExhausted || remPct <= 0)

    if (hasExhausted || remPct <= 0) {
      return {
        label: "额度已耗尽 (0%)",
        color: dynamicColor,
        symbol: "xmark.octagon.fill",
      }
    }
    if (remPct <= 10) {
      return {
        label: `额度告急 (${remPct}%)`,
        color: dynamicColor,
        symbol: "exclamationmark.octagon.fill",
      }
    }
    if (remPct <= 30) {
      return {
        label: `余量偏低 (${remPct}%)`,
        color: dynamicColor,
        symbol: "exclamationmark.triangle.fill",
      }
    }
    return {
      label: `余量充足 (${remPct}%)`,
      color: dynamicColor,
      symbol: "checkmark.circle.fill",
    }
  }
  return {
    label: "钱包正常",
    color: "systemBlue",
    symbol: "creditcard.fill",
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


