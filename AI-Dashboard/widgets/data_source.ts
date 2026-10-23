import { Widget } from "scripting"
import type {
  QuotaSnapshot,
  SubscriptionAccount,
} from "../models/types"
import {
  loadDashboardSettings,
  loadStoredAccounts,
  loadStoredSnapshots,
} from "../utils/credential_store"
import {
  createDefaultDemoAccounts,
  generateDemoSnapshot,
} from "../utils/demo_mode"
import { getProviderMeta } from "../utils/providers_catalog"
import { CODEX_RESET_CACHE_KEY } from "../services/codex_reset_feed"
import { ACTIVE_WALLET_KEY } from "../services/app_intents"
import {
  getWidgetRefreshMetadata,
  isWidgetRefreshing,
} from "../services/refresh_service"
import { getWidgetStatusOrUpdateTime } from "./refresh_planner"
import {
  computeAccountOverallQuota,
  maskIdentity,
} from "../utils/theme"
import type {
  WidgetAccountData,
  WidgetQuotaItem,
  WidgetRenderData,
} from "./types"
import {
  formatWidgetCountdown,
  getAccountDisplayTitle,
  shortenQuotaWindowName,
} from "./utils"

/**
 * 判定一个额度项是否产生了实际消耗
 */
function hasQuotaConsumption(q: WidgetQuotaItem): boolean {
  if (q.isExhausted) return true
  if (q.usedPercentage !== undefined && q.usedPercentage > 0) return true
  if (q.remainingPercentage !== undefined && q.remainingPercentage < 100) return true
  if (
    q.totalCount !== undefined &&
    q.remainingCount !== undefined &&
    q.remainingCount < q.totalCount
  ) {
    return true
  }
  return false
}

/**
 * 当某个供应商配额项数量超过 5 个时：
 * 1. 至多展示 5 个，保证各种尺寸小组件的正常显示；
 * 2. 优先显示有消耗的进度条（有消耗排在最前，消耗比例更高更紧急的排在前面）；
 * 3. 0 消耗的候补项按原顺序补充，超出 5 个的多余项被安全截断。
 */
export function selectTopWidgetQuotas(
  quotas: WidgetQuotaItem[],
  maxCount = 5
): WidgetQuotaItem[] {
  if (quotas.length <= maxCount) {
    return quotas
  }

  const indexed = quotas.map((q, idx) => ({
    q,
    idx,
    consumed: hasQuotaConsumption(q),
    usedPct: q.usedPercentage ?? (q.isExhausted ? 100 : 0),
  }))

  indexed.sort((a, b) => {
    // 优先有消耗的进度条排在前面
    if (a.consumed !== b.consumed) {
      return a.consumed ? -1 : 1
    }
    // 都有消耗时，消耗比例更高（更紧急/有变动）的排在前面
    if (a.consumed && b.consumed) {
      if (b.usedPct !== a.usedPct) {
        return b.usedPct - a.usedPct
      }
    }
    // 平局或都无消耗时，保持原顺序
    return a.idx - b.idx
  })

  return indexed.slice(0, maxCount).map((item) => item.q)
}

/**
 * 转换单个账号快照为小组件结构
 */
function buildWidgetAccountData(
  acc: SubscriptionAccount,
  snapshot: QuotaSnapshot | null,
  codexFeedCached?: any
): WidgetAccountData {
  const meta = getProviderMeta(acc.provider)
  const isWallet =
    meta.routeCategory === "gateway" ||
    meta.id === "deepSeek" ||
    meta.id === "openAIAPI" ||
    meta.id === "moonshot" ||
    meta.id === "xaiAPI"

  let planName = snapshot?.providerPlanName || (isWallet ? "PayG" : "Active")
  if (acc.provider === "workBuddy") planName = "Free"
  if (acc.provider === "antigravity") planName = "Pro"

  const windows = snapshot?.windows ?? []
  let earliestResetMs: number | null = null
  let earliestResetISO: string | undefined = undefined

  const rawQuotas: WidgetQuotaItem[] = windows.map((w) => {
    let usedPct = w.usedPercentage ?? 0

    // 优先根据精确计数计算真实的已用比例，杜绝使用积分后百分比仍然显示 100% 的不同步问题
    if (
      w.exactCounts?.total !== undefined &&
      w.exactCounts.total > 0 &&
      w.exactCounts.remaining !== undefined
    ) {
      const remFrac = Math.min(1, Math.max(0, w.exactCounts.remaining / w.exactCounts.total))
      usedPct = Math.round((1 - remFrac) * 1000) / 10
    } else if (
      w.exactCounts?.total !== undefined &&
      w.exactCounts.total > 0 &&
      w.exactCounts.used !== undefined
    ) {
      usedPct = Math.round((w.exactCounts.used / w.exactCounts.total) * 1000) / 10
    } else if (
      w.totalCount !== undefined &&
      w.totalCount > 0 &&
      w.remainingCount !== undefined
    ) {
      const remFrac = Math.min(1, Math.max(0, w.remainingCount / w.totalCount))
      usedPct = Math.round((1 - remFrac) * 1000) / 10
    }

    if (w.isExhausted) usedPct = 100
    if (usedPct > 100) usedPct = 100
    if (usedPct < 0) usedPct = 0

    const isBalanceOnly =
      Boolean(w.wallet) ||
      w.unit === "Credits" ||
      (w.usedPercentage === undefined &&
        (w.remainingCount !== undefined || w.wallet?.total !== undefined))

    let balanceText: string | undefined = undefined
    if (w.wallet) {
      balanceText = `${w.wallet.total} ${w.wallet.currency}`
    } else if (w.remainingCount !== undefined) {
      balanceText = `${w.remainingCount} ${w.unit || ""}`.trim()
    }

    let remPct = Math.max(0, 100 - usedPct)
    const totalCount = w.totalCount ?? w.exactCounts?.total
    const remCount = w.remainingCount ?? w.exactCounts?.remaining
    if (totalCount !== undefined && remCount !== undefined && remCount < totalCount && remPct >= 99.5) {
      remPct = 99
    }
    if (remCount !== undefined && remCount > 0 && remPct <= 0.5) {
      remPct = 1
    }

    return {
      id: w.id,
      name: shortenQuotaWindowName(w.name, acc.provider),
      period: w.period,
      usedPercentage: usedPct,
      remainingPercentage: remPct,
      remainingCount: remCount ?? w.wallet?.total,
      totalCount: totalCount,
      unit: w.unit,
      isExhausted: !!w.isExhausted || usedPct >= 100,
      isUnlimited: !!w.isUnlimited,
      resetsAt: w.resetsAt,
      resetCountdownText: formatWidgetCountdown(w.resetsAt),
      isBalanceOnly,
      balanceText,
    }
  })

  // 当供应商指标数量超过 5 个时，至多显示 5 个并优先展示有消耗的进度条
  const quotas = selectTopWidgetQuotas(rawQuotas, 5)

  for (const q of quotas) {
    if (q.resetsAt) {
      const ms = new Date(q.resetsAt).getTime()
      if (!Number.isNaN(ms) && (earliestResetMs === null || ms < earliestResetMs)) {
        earliestResetMs = ms
        earliestResetISO = q.resetsAt
      }
    }
  }

  // 如果没有具体配额但有钱包数据
  const wallet = windows.find((w) => w.wallet)?.wallet

  // 遵循与主程序看板柱状图及卡片标题下方一致的全局整体额度统计口径
  const overall = computeAccountOverallQuota(snapshot ?? undefined)
  const overallUsed = overall.usedPercent

  let overallStatus: "normal" | "warning" | "exhausted" = "normal"
  if (overall.isExhausted || overallUsed >= 100) {
    overallStatus = "exhausted"
  } else if (overallUsed >= 60) {
    overallStatus = "warning"
  }

  // Codex 重置预告解析：仅在存在真实排程或预测概率时返回，绝不显示无意义的假占位
  let codexResetForecast: WidgetAccountData["codexResetForecast"] = undefined
  if (acc.provider === "codex" && codexFeedCached) {
    try {
      const dataNode = codexFeedCached.data || codexFeedCached
      const scheduled =
        dataNode.scheduledReset?.scheduledFor ||
        dataNode.scheduled_reset?.scheduled_for ||
        codexFeedCached.scheduledResetText ||
        codexFeedCached.scheduled_at
      const chance =
        dataNode.activeWatch?.resetChancePercent ??
        dataNode.active_watch?.reset_chance_percent ??
        codexFeedCached.forecastProbability
      const hasRealForecast =
        Boolean(scheduled) ||
        (chance !== null && chance !== undefined) ||
        Boolean(dataNode.activeWatch?.text)

      if (hasRealForecast) {
        const probText =
          chance !== null && chance !== undefined
            ? `预计重置率 ${chance}%`
            : dataNode.activeWatch?.text || undefined

        let schedText: string | undefined = undefined
        if (scheduled) {
          const schedMs = Date.parse(scheduled)
          if (!Number.isNaN(schedMs) && schedMs <= Date.now()) {
            schedText = "已重置"
          } else {
            schedText = formatWidgetCountdown(scheduled)
          }
        } else {
          schedText = dataNode.scheduledReset?.text || undefined
        }

        codexResetForecast = {
          scheduledText: schedText,
          probabilityText: probText,
          status: codexFeedCached.isResetActive ? "active" : "forecast",
        }
      }
    } catch {}
  }

  // 检查该账号刷新元数据与数据新鲜度
  const isRefreshing = isWidgetRefreshing()
  const refreshMeta = getWidgetRefreshMetadata(acc.id)
  const statusInfo = getWidgetStatusOrUpdateTime({
    fetchedAtISO: snapshot?.collectedAt,
    metadata: refreshMeta,
  })

  return {
    id: acc.id,
    provider: acc.provider,
    displayName: getAccountDisplayTitle(acc, snapshot),
    planName,
    identity: snapshot?.accountIdentity,
    region: acc.region,
    isWallet,
    wallet,
    quotas,
    worstUsedPercentage: overallUsed,
    overallStatus,
    statusColor: overall.color,
    earliestResetCountdown: formatWidgetCountdown(earliestResetISO),
    codexResetForecast,
    codexResetCardsCount: snapshot?.codexResetCards?.availableCount,
    widgetOrder: acc.widgetOrder,
    updateStatusText: isRefreshing ? "正在刷新..." : statusInfo.text,
    isUpdateWarning: !isRefreshing && statusInfo.isWarning,
  }
}

/**
 * 对于同一个供应商拥有多个账号且每个账号只有一个数据/进度条（如 WorkBuddy）：
 * 1. 按小组件序号 (widgetOrder) 升序排序；
 * 2. 将账号按每 2 个合并为一个卡片批次 (WidgetAccountData)；
 * 3. 进度条标题加上账号脱敏身份 (跟随小组件隐私保护设置)：如 "谁说****警长 · 总配额"；
 * 4. 进度条合并为成对展示（小号和中号展示前 2 个，大号展示前 4 个，超大号展示前 6 个）。
 */
function mergeSingleQuotaAccounts(
  accounts: WidgetAccountData[],
  widgetPrivacyEnabled: boolean
): WidgetAccountData[] {
  // 统计各供应商账号中 quotas.length === 1 && !isWallet 的数量
  const singleQuotaProviderCounts = new Map<string, number>()
  for (const acc of accounts) {
    if (!acc.isWallet && acc.quotas.length === 1) {
      singleQuotaProviderCounts.set(
        acc.provider,
        (singleQuotaProviderCounts.get(acc.provider) || 0) + 1
      )
    }
  }

  // 找出需要合并的供应商 (>= 2 个单指标账号)
  const mergeProviders = new Set<string>()
  for (const [provider, count] of singleQuotaProviderCounts.entries()) {
    if (count >= 2) {
      mergeProviders.add(provider)
    }
  }

  if (mergeProviders.size === 0) {
    return accounts
  }

  const providerGroups = new Map<string, WidgetAccountData[]>()
  for (const acc of accounts) {
    if (mergeProviders.has(acc.provider) && !acc.isWallet && acc.quotas.length === 1) {
      if (!providerGroups.has(acc.provider)) {
        providerGroups.set(acc.provider, [])
      }
      providerGroups.get(acc.provider)!.push(acc)
    }
  }

  const mergedBatchesByProvider = new Map<string, WidgetAccountData[]>()
  for (const [provider, group] of providerGroups.entries()) {
    const sorted = [...group].sort((a, b) => {
      const orderA = a.widgetOrder !== undefined && a.widgetOrder > 0 ? a.widgetOrder : 9999
      const orderB = b.widgetOrder !== undefined && b.widgetOrder > 0 ? b.widgetOrder : 9999
      if (orderA !== orderB) return orderA - orderB
      return 0
    })

    const batches: WidgetAccountData[] = []
    for (let i = 0; i < sorted.length; i += 2) {
      const a1 = sorted[i]
      const a2 = sorted[i + 1] as WidgetAccountData | undefined

      const formatQuota = (acc: WidgetAccountData): WidgetQuotaItem => {
        const rawId = acc.identity || acc.displayName
        const masked = widgetPrivacyEnabled ? maskIdentity(rawId) : rawId
        const origQuota = acc.quotas[0]
        return {
          ...origQuota,
          name: `${masked} · ${origQuota.name}`,
        }
      }

      const q1 = formatQuota(a1)
      const mergedQuotas: WidgetQuotaItem[] = [q1]
      let worstUsed = a1.worstUsedPercentage
      let statusColor = a1.statusColor

      if (a2) {
        const q2 = formatQuota(a2)
        mergedQuotas.push(q2)
        if (a2.worstUsedPercentage > worstUsed) {
          worstUsed = a2.worstUsedPercentage
          statusColor = a2.statusColor
        }
      }

      let overallStatus: "normal" | "warning" | "exhausted" = "normal"
      if (
        worstUsed >= 100 ||
        a1.overallStatus === "exhausted" ||
        a2?.overallStatus === "exhausted"
      ) {
        overallStatus = "exhausted"
      } else if (worstUsed >= 60) {
        overallStatus = "warning"
      }

      const isUpdateWarning = Boolean(a1.isUpdateWarning || a2?.isUpdateWarning)
      const updateStatusText = a1.isUpdateWarning
        ? a1.updateStatusText
        : a2?.isUpdateWarning
          ? a2.updateStatusText
          : a1.updateStatusText

      const batchItem: WidgetAccountData = {
        id: a1.id,
        provider: a1.provider,
        displayName: a1.displayName,
        planName: a1.planName,
        identity: a1.identity,
        region: a1.region,
        isWallet: false,
        quotas: mergedQuotas,
        worstUsedPercentage: worstUsed,
        overallStatus,
        statusColor,
        earliestResetCountdown: a1.earliestResetCountdown || a2?.earliestResetCountdown,
        widgetOrder: a1.widgetOrder,
        updateStatusText,
        isUpdateWarning,
      }
      batches.push(batchItem)
    }
    mergedBatchesByProvider.set(provider, batches)
  }

  const result: WidgetAccountData[] = []
  const emittedProviders = new Set<string>()

  for (const acc of accounts) {
    if (mergeProviders.has(acc.provider) && !acc.isWallet && acc.quotas.length === 1) {
      if (!emittedProviders.has(acc.provider)) {
        emittedProviders.add(acc.provider)
        const batches = mergedBatchesByProvider.get(acc.provider) || []
        result.push(...batches)
      }
    } else {
      result.push(acc)
    }
  }

  return result
}

/**
 * 读取小组件全局渲染数据
 * @param forceDemo 是否强制使用演示数据（供小组件效果预览切换）
 */
export function loadWidgetRenderData(forceDemo?: boolean): WidgetRenderData {
  const settings = loadDashboardSettings()
  const useDemo = forceDemo ?? settings.isDemoMode
  const widgetPrivacyEnabled = settings.widgetPrivacyEnabled ?? true
  const widgetQuotaAdaptTransparent =
    settings.widgetQuotaAdaptTransparent ??
    settings.widgetConnectionAdaptTransparent ??
    false

  let accounts: SubscriptionAccount[] = []
  let snapshots: Record<string, QuotaSnapshot> = {}

  if (useDemo) {
    accounts = createDefaultDemoAccounts()
    for (const acc of accounts) {
      snapshots[acc.id] = generateDemoSnapshot(acc.id, acc.provider, acc.region) as any
    }
  } else {
    // 优先读取用户在应用内配置的真实账号与配额快照
    accounts = loadStoredAccounts()
    snapshots = loadStoredSnapshots()

    // 如果还没有在应用内添加任何真实账号，优雅回退到演示数据，确保首次预览立即可见
    if (accounts.length === 0) {
      accounts = createDefaultDemoAccounts()
      for (const acc of accounts) {
        snapshots[acc.id] = generateDemoSnapshot(acc.id, acc.provider, acc.region) as any
      }
    }
  }

  // 读取可能存在的 Codex 缓存
  let codexCache: any = null
  try {
    const raw = Storage.get<string>(CODEX_RESET_CACHE_KEY)
    if (raw) codexCache = JSON.parse(raw)
  } catch {}

  let totalWalletUSD = 0
  let totalWalletCNY = 0

  // 1. 将所有账号及快照转为小组件数据项
  let accountDataList: WidgetAccountData[] = accounts.map((acc) => {
    const snap = snapshots[acc.id] || null
    const item = buildWidgetAccountData(acc, snap, codexCache)

    if (item.wallet) {
      if (/CNY|RMB|¥/i.test(item.wallet.currency)) {
        totalWalletCNY += item.wallet.total
      } else {
        totalWalletUSD += item.wallet.total
      }
    }
    return item
  })

  // 2. 对于同一个供应商只有一个数据的（如 WorkBuddy），按序号合并成对展示
  accountDataList = mergeSingleQuotaAccounts(accountDataList, widgetPrivacyEnabled)

  // 3. 支持通过 Widget.parameter 指定置顶供应商（支持逗号/空格分隔多个，如 "codex, workbuddy"）
  let parameterTokensCount = 0
  const param = (Widget.parameter || "").trim()
  if (param) {
    const tokens = param
      .toLowerCase()
      .split(/[,，;\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)

    parameterTokensCount = tokens.length

    if (tokens.length === 1) {
      // 填入单个参数（如 "workbuddy"）：匹配该供应商的所有账号/批次，全部置顶
      const token = tokens[0]
      const matched: WidgetAccountData[] = []
      const remaining: WidgetAccountData[] = []

      for (const a of accountDataList) {
        if (
          a.id.toLowerCase() === token ||
          a.provider.toLowerCase() === token ||
          a.displayName.toLowerCase().includes(token)
        ) {
          matched.push(a)
        } else {
          remaining.push(a)
        }
      }
      if (matched.length > 0) {
        accountDataList = [...matched, ...remaining]
      }
    } else if (tokens.length > 1) {
      // 填入多个参数（如 "workbuddy, codex"）：每个参数依次认领一个卡片插槽
      const matched: WidgetAccountData[] = []
      const remaining: WidgetAccountData[] = [...accountDataList]

      for (const token of tokens) {
        const foundIdx = remaining.findIndex(
          (a) =>
            a.id.toLowerCase() === token ||
            a.provider.toLowerCase() === token ||
            a.displayName.toLowerCase().includes(token)
        )
        if (foundIdx !== -1) {
          const [item] = remaining.splice(foundIdx, 1)
          matched.push(item)
        }
      }
      if (matched.length > 0) {
        accountDataList = [...matched, ...remaining]
      }
    }
  } else {
    // 未填写参数时，如果有交互选中的活跃钱包，将其放到底端主卡展示
    let activeWalletId: string | null = null
    try {
      activeWalletId = Storage.get<string>(ACTIVE_WALLET_KEY)
    } catch {}

    if (activeWalletId) {
      const idx = accountDataList.findIndex((a) => a.id === activeWalletId)
      if (idx !== -1) {
        const [item] = accountDataList.splice(idx, 1)
        accountDataList.unshift(item)
      }
    }
  }

  let latestCollectedAt: string | undefined = undefined
  for (const acc of accountDataList) {
    const snap = snapshots[acc.id]
    if (snap?.collectedAt) {
      if (!latestCollectedAt || snap.collectedAt > latestCollectedAt) {
        latestCollectedAt = snap.collectedAt
      }
    }
  }

  const lastUpdatedAt = latestCollectedAt
    ? new Date(latestCollectedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })

  // 检查当前显示账号是否存在刷新异常或超过 6 小时未更新
  const isRefreshing = isWidgetRefreshing()
  const warningAccount = accountDataList.find((a) => a.isUpdateWarning)
  const defaultStatusText = `更新于 ${lastUpdatedAt}`
  const overallStatusText = isRefreshing
    ? "正在刷新..."
    : warningAccount?.updateStatusText || defaultStatusText
  const isOverallWarning = !isRefreshing && Boolean(warningAccount?.isUpdateWarning)

  return {
    accounts: accountDataList,
    totalAccountsCount: accounts.length,
    totalWalletUSD,
    totalWalletCNY,
    hasCodexForecast: !!codexCache,
    lastUpdatedAt,
    updateStatusText: overallStatusText,
    isUpdateWarning: isOverallWarning,
    isDemoMode: useDemo,
    widgetPrivacyEnabled,
    widgetQuotaAdaptTransparent,
    widgetConnectionAdaptTransparent: widgetQuotaAdaptTransparent,
    parameterTokensCount,
  }
}
