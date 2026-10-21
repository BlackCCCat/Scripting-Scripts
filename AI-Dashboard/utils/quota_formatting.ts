import {
  ProviderId,
  QuotaResetSemantics,
  QuotaWindow,
  RefreshFailureCode,
  WalletBalance,
} from "../models/types"
import { getProviderMeta } from "./providers_catalog"

export function formatAmountNumber(
  value: number,
  maxFractionDigits = 4
): string {
  if (!Number.isFinite(value)) return "0"
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
}

export function formatMoney(amount: number, currency: string): string {
  const code = (currency || "USD").trim().toUpperCase()
  const absVal = Math.abs(amount)
  const minFraction =
    absVal > 0 && absVal < 0.01 ? 4 : absVal < 1 ? 2 : 2
  const maxFraction = absVal > 0 && absVal < 0.01 ? 6 : 4
  try {
    const formatted = new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: code,
      currencyDisplay: code === "USD" ? "narrowSymbol" : "symbol",
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    }).format(amount)
    return formatted.replace(/US\$/g, "$")
  } catch {
    return code === "USD"
      ? `$${formatAmountNumber(amount, maxFraction)}`
      : `${formatAmountNumber(amount, maxFraction)} ${code}`
  }
}

export function formatWalletAmount(
  amount: number,
  wallet: WalletBalance
): string {
  if (wallet.isMonetary) {
    return formatMoney(amount, wallet.currency)
  }
  return `${formatAmountNumber(amount)} ${wallet.currency}`
}

const GENERIC_WINDOW_NAMES = new Set([
  "5 小时滚动窗口",
  "5 小时主窗口",
  "5 小时会话窗口",
  "5 小时额度",
  "5 小时快速调用窗口",
  "5 小时限流",
  "每周配额窗口",
  "周度窗口",
  "7 天综合配额",
  "每周额度",
  "7 天配额",
  "每月额度",
  "月度配额",
  "月度云端配额",
  "月度云端 Token 配额",
  "周期调用配额",
  "周期可用配额",
  "令牌总额度",
  "令牌配额",
  "账户总额度进度",
  "月度按量扩展上限",
  "按量付费支出上限",
  "按量付费支出上限 (On-Demand)",
  "按量扩展",
  "总额配额",
  "WorkBuddy 资源包总额度",
])

const REDUNDANT_SCOPES = new Set([
  "Codex CLI / 云端任务",
  "Claude 4.5 Opus / Sonnet",
  "全模型总额度",
  "MiniMax-M1 / Text-01",
])

/**
 * 返回周期标签右侧真正需要补充展示的简短子项名称；
 * 若周期标签已完整表达含义（如 5小时限流、7天配额、月度配额、按量扩展），则返回空字符串，避免显示多余后缀。
 */
export function formatWindowSubtitle(window: QuotaWindow): string {
  const scope =
    window.scope && !REDUNDANT_SCOPES.has(window.scope.trim())
      ? window.scope.trim()
      : ""
  const rawName = (window.name || "").trim()
  const cleanName = GENERIC_WINDOW_NAMES.has(rawName) ? "" : rawName

  if (scope && cleanName && scope !== cleanName) {
    return `${scope} · ${cleanName}`
  }
  return scope || cleanName
}

export function formatWindowTitle(window: QuotaWindow): string {
  const badge = formatPeriodBadgeText(window)
  const sub = formatWindowSubtitle(window)
  return sub ? `${badge} · ${sub}` : badge
}

export function formatPeriodBadgeText(window: QuotaWindow): string {
  if (window.wallet) {
    return window.wallet.isMonetary ? "资金钱包" : "点数账户"
  }
  if (window.overagePermitted) {
    return "按量扩展"
  }
  if (window.isUnlimited) {
    return "无限制"
  }
  switch (window.period) {
    case "fiveHour":
      return "5小时限流"
    case "weekly":
      return "7天配额"
    case "monthly":
      return "月度配额"
    default:
      if (window.resetSemantics === "nonResettingAllowance") {
        return "总额配额"
      }
      return "周期配额"
  }
}

export function formatRelativeCountdown(
  iso?: string,
  semantics?: QuotaResetSemantics
): string | null {
  if (!iso) {
    if (semantics === "nonResettingAllowance") {
      return "不按周期自动重置"
    }
    return null
  }
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  const diffMs = target - Date.now()
  const actionVerb =
    semantics === "replenishes"
      ? "补充"
      : semantics === "nonResettingAllowance"
        ? "到期"
        : "重置"

  if (diffMs <= 0) {
    return `即将${actionVerb}`
  }
  const totalMinutes = Math.floor(diffMs / 60000)
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)} 分钟后${actionVerb}`
  }
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) {
    const remMins = totalMinutes % 60
    return remMins > 0
      ? `${totalHours} 小时 ${remMins} 分后${actionVerb}`
      : `${totalHours} 小时后${actionVerb}`
  }
  const totalDays = Math.round(totalHours / 24)
  return `${totalDays} 天后${actionVerb}`
}

export function formatWindowQuotaBreakdown(window: QuotaWindow): {
  primaryRemainingText: string
  secondaryUsedText: string
  usedPercent: number | null
  remainingPercent: number | null
} {
  if (window.isUnlimited) {
    return {
      primaryRemainingText: "不限次数 / 不限额",
      secondaryUsedText: "套餐内无限畅享",
      usedPercent: 0,
      remainingPercent: 100,
    }
  }

  const frac = formatWindowProgressFraction(window)
  const usedPct = frac !== null ? Math.round(frac * 100) : null
  const remPct = usedPct !== null ? Math.max(0, 100 - usedPct) : null
  const unit = window.unit ? ` ${window.unit}` : ""

  if (window.exactCounts) {
    const { used, remaining, total } = window.exactCounts
    if (remaining !== undefined && total !== undefined && total > 0) {
      const computedUsed =
        used !== undefined ? used : Math.max(0, total - remaining)
      const exactRemFrac = Math.min(1, Math.max(0, remaining / total))
      let exactRemPct = remaining <= 0 ? 0 : Math.round(exactRemFrac * 100)
      if (computedUsed > 0 && remaining < total && exactRemPct >= 100) {
        exactRemPct = 99
      }
      if (remaining > 0 && exactRemPct <= 0) {
        exactRemPct = 1
      }
      const exactUsedPct = 100 - exactRemPct
      return {
        primaryRemainingText: `剩余 ${formatAmountNumber(remaining)}${unit} (${exactRemPct}%)`,
        secondaryUsedText: `已用 ${formatAmountNumber(computedUsed)} / 共 ${formatAmountNumber(total)}${unit}`,
        usedPercent: exactUsedPct,
        remainingPercent: exactRemPct,
      }
    }
    if (used !== undefined && total !== undefined && total > 0) {
      const computedRem = Math.max(0, total - used)
      const exactRemFrac = Math.min(1, Math.max(0, computedRem / total))
      let exactRemPct = computedRem <= 0 ? 0 : Math.round(exactRemFrac * 100)
      if (used > 0 && computedRem < total && exactRemPct >= 100) {
        exactRemPct = 99
      }
      if (computedRem > 0 && exactRemPct <= 0) {
        exactRemPct = 1
      }
      const exactUsedPct = 100 - exactRemPct
      return {
        primaryRemainingText: `剩余 ${formatAmountNumber(computedRem)}${unit} (${exactRemPct}%)`,
        secondaryUsedText: `已用 ${formatAmountNumber(used)} / 共 ${formatAmountNumber(total)}${unit}`,
        usedPercent: exactUsedPct,
        remainingPercent: exactRemPct,
      }
    }
  }

  if (window.remainingCount !== undefined && window.totalCount !== undefined && window.totalCount > 0) {
    const usedCount = Math.max(0, window.totalCount - window.remainingCount)
    const exactRemFrac = Math.min(1, Math.max(0, window.remainingCount / window.totalCount))
    let exactRemPct = window.remainingCount <= 0 ? 0 : Math.round(exactRemFrac * 100)
    if (usedCount > 0 && window.remainingCount < window.totalCount && exactRemPct >= 100) {
      exactRemPct = 99
    }
    if (window.remainingCount > 0 && exactRemPct <= 0) {
      exactRemPct = 1
    }
    const exactUsedPct = 100 - exactRemPct
    return {
      primaryRemainingText: `剩余 ${formatAmountNumber(window.remainingCount, 2)}${unit} (${exactRemPct}%)`,
      secondaryUsedText: `已用 ${formatAmountNumber(usedCount, 2)} / 共 ${formatAmountNumber(window.totalCount, 2)}${unit}`,
      usedPercent: exactUsedPct,
      remainingPercent: exactRemPct,
    }
  }

  if (window.remainingCount !== undefined) {
    return {
      primaryRemainingText: `剩余 ${formatAmountNumber(window.remainingCount, 2)}${unit}`,
      secondaryUsedText:
        usedPct !== null ? `已消耗 ${usedPct}%` : "可用配额余量",
      usedPercent: usedPct,
      remainingPercent: remPct,
    }
  }

  if (usedPct !== null && remPct !== null) {
    return {
      primaryRemainingText: `剩余可用 ${remPct}%`,
      secondaryUsedText: `已消耗 ${usedPct}%`,
      usedPercent: usedPct,
      remainingPercent: remPct,
    }
  }

  if (window.isExhausted !== undefined) {
    return {
      primaryRemainingText: window.isExhausted ? "额度已耗尽 (0%)" : "额度可用",
      secondaryUsedText: window.isExhausted ? "需等待下个周期重置" : "状态正常",
      usedPercent: window.isExhausted ? 100 : 0,
      remainingPercent: window.isExhausted ? 0 : 100,
    }
  }

  return {
    primaryRemainingText: "已连接",
    secondaryUsedText: "暂无细分计数",
    usedPercent: null,
    remainingPercent: null,
  }
}

export function formatWindowProgressFraction(
  window: QuotaWindow
): number | null {
  if (window.wallet || window.isUnlimited) return null
  // 优先采用精确计数计算，防止百分比与具体数字不同步
  if (
    window.exactCounts?.used !== undefined &&
    window.exactCounts?.total !== undefined &&
    window.exactCounts.total > 0
  ) {
    return Math.min(
      Math.max(window.exactCounts.used / window.exactCounts.total, 0),
      1
    )
  }
  if (
    window.exactCounts?.remaining !== undefined &&
    window.exactCounts?.total !== undefined &&
    window.exactCounts.total > 0
  ) {
    const used = window.exactCounts.total - window.exactCounts.remaining
    return Math.min(Math.max(used / window.exactCounts.total, 0), 1)
  }
  if (
    window.remainingCount !== undefined &&
    window.totalCount !== undefined &&
    window.totalCount > 0
  ) {
    const used = window.totalCount - window.remainingCount
    return Math.min(Math.max(used / window.totalCount, 0), 1)
  }
  if (
    window.usedPercentage !== undefined &&
    Number.isFinite(window.usedPercentage)
  ) {
    return Math.min(Math.max(window.usedPercentage / 100, 0), 1)
  }
  if (window.isExhausted !== undefined) {
    return window.isExhausted ? 1 : 0
  }
  return null
}

/**
 * 返回进度条剩余比例 (0 ~ 1)，1 代表 100% 剩余，0 代表已耗尽
 */
export function formatWindowRemainingFraction(
  window: QuotaWindow
): number | null {
  if (window.wallet || window.isUnlimited) return null
  if (window.isExhausted) return 0
  // 优先根据具体余量与总量计算剩余进度
  if (
    window.exactCounts?.remaining !== undefined &&
    window.exactCounts?.total !== undefined &&
    window.exactCounts.total > 0
  ) {
    return Math.min(
      Math.max(window.exactCounts.remaining / window.exactCounts.total, 0),
      1
    )
  }
  if (
    window.remainingCount !== undefined &&
    window.totalCount !== undefined &&
    window.totalCount > 0
  ) {
    return Math.min(
      Math.max(window.remainingCount / window.totalCount, 0),
      1
    )
  }
  const usedFraction = formatWindowProgressFraction(window)
  if (usedFraction === null) return null
  return Math.min(1, Math.max(0, 1 - usedFraction))
}

export function formatShortDateTime(iso?: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatFailureDescription(
  failure: RefreshFailureCode,
  provider: ProviderId,
  detail?: string
): string {
  const meta = getProviderMeta(provider)
  const base = (() => {
    switch (failure) {
      case "missingCredential":
        return `缺少 ${meta.displayName} 的有效凭证，请重新登录或粘贴密钥`
      case "invalidCredential":
        return `${meta.displayName} 凭证已失效或权限不足，请更新凭证`
      case "unsupportedProvider":
        return `${meta.displayName} 当前直连通道暂不可用`
      case "rateLimited":
        return `${meta.displayName} 请求过于频繁 (HTTP 429)，请稍后再试`
      case "network":
        return `无法连接到 ${meta.displayName} 服务端，请检查网络或代理设置`
      case "unreadableResponse":
        return `${meta.displayName} 返回了无法解析的响应格式`
      case "noQuotaWindows":
        return `${meta.displayName} 响应成功但未返回可用额度窗口`
      case "subscriptionRequired":
        return `当前 ${meta.displayName} 账号未开通对应订阅或资源包`
      case "server":
        return `${meta.displayName} 服务端返回异常状态`
    }
  })()
  return detail ? `${base}（${detail}）` : base
}
