import {
  Button,
  Capsule,
  Circle,
  Device,
  type Color,
  type DynamicShapeStyle,
  GeometryReader,
  gradient,
  HStack,
  Image,
  LazyHStack,
  LazyVGrid,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  Section,
  Spacer,
  Text,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import type { AccountQuotaState, SubscriptionAccount } from "../models/types"
import { getDashboardLanguage, localize } from "../utils/localization"
import { formatMoney, formatShortDateTime } from "../utils/quota_formatting"
import { getProviderMeta, localizeAccountName } from "../utils/providers_catalog"
import { computeAccountOverallQuota, maskIdentity, remainingQuotaColor } from "../utils/theme"
import { dashboardQuotaColor, useDashboardMetricAnimation } from "../utils/dashboard_metric_animation"
import { glassCardSurface } from "./GlassCardSurface"
import { ProviderIconView } from "./ProviderIconView"

const neutralCardAccent = "#8E8E93"

function overviewCardGradient(accent: Color): DynamicShapeStyle {
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(accent.slice(offset, offset + 2), 16))
  const tint = (opacity: number): Color => `rgba(${red},${green},${blue},${opacity})`
  return {
    light: gradient("linear", {
      colors: [tint(0.04), tint(0.38)],
      startPoint: "topLeading",
      endPoint: "bottomTrailing",
    }),
    dark: gradient("linear", {
      colors: [tint(0.06), tint(0.32)],
      startPoint: "topLeading",
      endPoint: "bottomTrailing",
    }),
  }
}

type WalletCurrency = "CNY" | "USD"

const banknoteAccents: Record<WalletCurrency, readonly (readonly [number, Color])[]> = {
  CNY: [
    [100, "#E15260"],
    [50, "#47A787"],
    [20, "#C6814F"],
    [10, "#537CAC"],
    [5, "#A777C4"],
    [1, "#87985B"],
  ],
  USD: [
    [100, "#438BCB"], // Blue security ribbon
    [50, "#C5819C"],
    [20, "#A0AE83"],
    [10, "#E7A547"],
    [5, "#AC81C5"],
    [2, "#6C9877"],
    [1, "#568063"],
  ],
}

function walletAccent(currency: WalletCurrency, balance: number): Color {
  return banknoteAccents[currency].find(([denomination]) => balance >= denomination)?.[1] ?? neutralCardAccent
}

const walletPalette = {
  CNY: ({ balance = 0 }: { balance?: number }) => walletAccent("CNY", balance),
  USD: ({ balance = 0 }: { balance?: number }) => walletAccent("USD", balance),
}

function OverviewArcs() {
  return (
    <GeometryReader>
      {(proxy) => {
        const arcGradient = (channel: number) => gradient("radial", {
          stops: [
            { color: "clear", location: 0 },
            { color: "clear", location: 0.70 },
            { color: `rgba(${channel},${channel},${channel},0.10)`, location: 0.70 },
            { color: `rgba(${channel},${channel},${channel},0.08)`, location: 0.78 },
            { color: `rgba(${channel},${channel},${channel},0.05)`, location: 0.78 },
            { color: `rgba(${channel},${channel},${channel},0.03)`, location: 0.92 },
            { color: "clear", location: 0.92 },
            { color: "clear", location: 1 },
          ],
          center: { x: 1.02, y: 0.35 },
          startRadius: 0,
          endRadius: proxy.size.width * 0.76,
        })
        return (
          <RoundedRectangle
            cornerRadius={20}
            style="continuous"
            fill={{ light: arcGradient(0), dark: arcGradient(255) }}
          />
        )
      }}
    </GeometryReader>
  )
}

interface QuotaChartItem {
  account: SubscriptionAccount
  remainingPercent: number
  isExhausted?: boolean
}

interface DashboardOverviewSectionProps {
  accounts: SubscriptionAccount[]
  accountStates: Record<string, AccountQuotaState>
  isDemoMode: boolean
  zoomNamespace?: any
  protectAccountIdentity?: boolean
  onSelectAccount: (acc: SubscriptionAccount) => void
  onOpenEditSheet?: () => void
}

export function DashboardOverviewSection(props: DashboardOverviewSectionProps) {
  const {
    accounts,
    accountStates,
    isDemoMode,
    protectAccountIdentity,
    onSelectAccount,
    onOpenEditSheet,
  } = props

  const stats = useMemo(() => {
    let totalCny = 0
    let grantedCny = 0
    let totalUsd = 0
    let grantedUsd = 0
    let healthyCount = 0
    let warningCount = 0
    let lastUpdated = 0
    const chartItems: QuotaChartItem[] = []

    for (const acc of accounts) {
      const st = accountStates[acc.id]
      const snap =
        st?.type === "loaded"
          ? st.snapshot
          : st?.type === "loading"
            ? st.previous
            : st?.type === "failed"
              ? st.previous
              : undefined

      if (!snap) continue
      lastUpdated = Math.max(lastUpdated, Date.parse(snap.collectedAt) || 0)

      for (const win of snap.windows) {
        if (win.wallet && win.wallet.isMonetary) {
          const cur = (win.wallet.currency || "").toUpperCase()
          if (cur === "CNY" || cur === "RMB") {
            totalCny += win.wallet.total || 0
            grantedCny += win.wallet.granted || 0
          } else if (cur === "USD") {
            totalUsd += win.wallet.total || 0
            grantedUsd += win.wallet.granted || 0
          }
        }
      }

      // 提取整体额度统计（与供应商卡片健康度使用完全一致的算法）
      const overall = computeAccountOverallQuota(snap)

      if (!overall.isWalletOnly && snap.windows.length > 0 && Number.isFinite(overall.remainingPercent)) {
        chartItems.push({
          account: acc,
          remainingPercent: Math.min(100, Math.max(0, overall.remainingPercent)),
          isExhausted: overall.isExhausted,
        })

        if (overall.isExhausted || overall.usedPercent >= 60) {
          warningCount++
        } else {
          healthyCount++
        }
      } else {
        healthyCount++
      }
    }

    const avgRemainingPercent =
      chartItems.length > 0
        ? Math.round(
            chartItems.reduce((sum, item) => sum + item.remainingPercent, 0) /
              chartItems.length
          )
        : null

    return {
      totalCny,
      grantedCny,
      totalUsd,
      grantedUsd,
      healthyCount,
      warningCount,
      lastUpdated,
      avgRemainingPercent,
      chartItems,
    }
  }, [accounts, accountStates])

  const lastUpdated = stats.lastUpdated
    ? formatShortDateTime(new Date(stats.lastUpdated).toISOString())
    : null

  return (
    <Section
      header={
        <HStack alignment="center" spacing={6}>
          <Image systemName="gauge.with.dots.needle.67percent" font="caption" foregroundStyle="systemIndigo" />
          <Text font="subheadline" fontWeight="semibold">{localize("全局额度与资产总览")}</Text>
          <Spacer minLength={4} />
          <HStack spacing={4}>
            <Circle
              fill={isDemoMode ? "secondaryLabel" : "systemGreen"}
              frame={{ width: 6, height: 6 }}
              accessibilityHidden={true}
            />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {localize(isDemoMode ? "演示数据" : "实时直连")}
            </Text>
          </HStack>
        </HStack>
      }
      listSectionSeparator="hidden"
    >
      <AverageQuotaOverview
        average={stats.avgRemainingPercent}
        accountCount={accounts.length}
        healthyCount={stats.healthyCount}
        warningCount={stats.warningCount}
        lastUpdated={lastUpdated}
        zoomNamespace={props.zoomNamespace}
        onOpenEditSheet={onOpenEditSheet}
      />

      <LazyVGrid
        {...overviewRowProps()}
        columns={[
          { size: { type: "flexible", min: 0 }, spacing: 8 },
          { size: { type: "flexible", min: 0 }, spacing: 8 },
        ]}
        spacing={8}
      >
        <WalletOverview currency="CNY" balance={stats.totalCny} granted={stats.grantedCny} />
        <WalletOverview currency="USD" balance={stats.totalUsd} granted={stats.grantedUsd} />
      </LazyVGrid>

      {stats.chartItems.length > 0 ? (
        <AccountQuotaChart
          items={stats.chartItems}
          average={stats.avgRemainingPercent}
          protectAccountIdentity={protectAccountIdentity}
          zoomNamespace={props.zoomNamespace}
          onSelectAccount={onSelectAccount}
        />
      ) : null}
    </Section>
  )
}

function overviewQuotaGradient(average: number | null, displayed: number) {
  return overviewCardGradient(
    average === null || (average === 0 && displayed === 0)
      ? neutralCardAccent
      : dashboardQuotaColor(displayed, average)
  )
}

function AverageQuotaOverview(props: {
  average: number | null
  accountCount: number
  healthyCount: number
  warningCount: number
  lastUpdated: string | null
  zoomNamespace?: DashboardOverviewSectionProps["zoomNamespace"]
  onOpenEditSheet?: () => void
}) {
  const { average, accountCount, healthyCount, warningCount, lastUpdated, zoomNamespace, onOpenEditSheet } = props
  const metrics = useDashboardMetricAnimation({
    average,
    used: average === null ? null : Math.max(0, 100 - average),
    accounts: accountCount,
    healthy: healthyCount,
    warning: warningCount,
  })
  const displayedAverage = metrics.value("average")
  const averageText = average === null ? "—" : `${Math.round(displayedAverage)}%`
  const accountCountText = localize(`${Math.round(metrics.value("accounts"))} 个`)
  const usedText = localize(`平均已消耗 ${Math.round(metrics.value("used"))}% 周期额度`)
  const healthy = Math.round(metrics.value("healthy"))
  const warning = Math.round(metrics.value("warning"))
  const healthText = localize(average === null
    ? "暂无可计算的周期配额"
    : warningCount > 0 || warning > 0
      ? `${healthy} 正常 · ${warning} 预警`
      : `全部 ${healthy} 个配额健康`)
  const quotaGradient = overviewQuotaGradient(average, displayedAverage)
  const arcs = useMemo(() => <OverviewArcs />, [])
  return (
    <Button
      {...overviewRowProps()}
      {...metrics.lifecycle}
      buttonStyle="plain"
      accessibilityHint={localize("编辑账号卡片")}
      matchedTransitionSource={zoomNamespace
        ? { id: "overview-edit-accounts", namespace: zoomNamespace }
        : undefined}
      action={() => onOpenEditSheet?.()}
    >
      <VStack
        alignment="leading"
        spacing={7}
        padding={14}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        contentShape="rect"
        {...glassCardSurface(quotaGradient, 20, arcs, metrics.animate("average"))}
      >
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label">
          {localize("平均剩余配额")}
        </Text>
        <HStack alignment="center" spacing={8}>
          <Text font="largeTitle" fontWeight="bold" monospacedDigit={true} foregroundStyle="label" layoutPriority={1}
            {...metrics.rollingText("average", averageText)}
          >
            {averageText}
          </Text>
          <Spacer minLength={0} />
          <VStack alignment="trailing" spacing={3}>
            <HStack spacing={3}>
              <Text font="caption" fontWeight="semibold" foregroundStyle="label" multilineTextAlignment="trailing"
                fixedSize={{ horizontal: false, vertical: true }}
                {...metrics.rollingText("accounts", accountCountText)}
              >
                {accountCountText}
              </Text>
              <Image systemName="chevron.right" font="caption2" foregroundStyle="label" />
            </HStack>
            <Text font="caption2" foregroundStyle="secondaryLabel" multilineTextAlignment="trailing"
              fixedSize={{ horizontal: false, vertical: true }}
              {...metrics.rollingText("healthy", healthText)}
            >
              {healthText}
            </Text>
          </VStack>
        </HStack>
        {average !== null || lastUpdated ? (
          <HStack alignment="top" spacing={5}>
            {average !== null ? (
              <Text font="caption2" foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}
                {...metrics.rollingText("used", usedText)}
              >
                {usedText}
              </Text>
            ) : null}
            <Spacer minLength={0} />
            {lastUpdated ? (
              <Text font="caption2" foregroundStyle="secondaryLabel" multilineTextAlignment="trailing"
                fixedSize={{ horizontal: false, vertical: true }}
              >
                {localize(`更新于 ${lastUpdated}`)}
              </Text>
            ) : null}
          </HStack>
        ) : null}
      </VStack>
    </Button>
  )
}

function overviewRowProps() {
  return {
    listRowInsets: 0,
    listRowSeparator: "hidden",
    listRowBackground: <Rectangle fill="clear" />,
  } as const
}

interface WalletOverviewProps {
  currency: WalletCurrency
  balance: number
  granted: number
}

function WalletOverview(props: WalletOverviewProps) {
  const { currency, balance, granted } = props
  const isCNY = currency === "CNY"
  const metrics = useDashboardMetricAnimation({ balance }, "palette", { paletteKey: walletPalette[currency] })
  const backgroundGradient = overviewCardGradient(walletAccent(currency, metrics.value("balance")))
  const amounts = useMemo(() => (
    <WalletOverviewAmounts currency={currency} balance={balance} granted={granted} />
  ), [currency, balance, granted, getDashboardLanguage()])
  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={10}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      {...glassCardSurface(backgroundGradient, 14, undefined, metrics.animate("balance"))}
      {...metrics.lifecycle}
    >
      <HStack spacing={4}>
        <Image systemName={isCNY ? "yensign.circle" : "dollarsign.circle"} font="caption" foregroundStyle="label" />
        <Text font="caption" foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}>
          {localize(isCNY ? "人民币钱包池" : "美元钱包池")}
        </Text>
      </HStack>
      {amounts}
    </VStack>
  )
}

function WalletOverviewAmounts({ currency, balance, granted }: WalletOverviewProps) {
  const metrics = useDashboardMetricAnimation({ balance, granted }, "wallet")
  const displayedBalance = metrics.value("balance")
  const displayedGrant = metrics.value("granted")
  return (
    <>
      <Text {...metrics.lifecycle} font="title3" fontWeight="semibold" monospacedDigit={true} foregroundStyle="label" fixedSize={{ horizontal: false, vertical: true }}>
        {formatMoney(displayedBalance, currency)}
      </Text>
      <Text font="caption2" foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}>
        {granted > 0 || displayedGrant > 0
          ? localize(`含赠送金 ${formatMoney(displayedGrant, currency)}`)
          : localize(currency === "CNY" ? "API 预充值可用余额" : "国际平台与网关合计")}
      </Text>
    </>
  )
}

const plotHeight = 95
const valueHeadroom = 18
const iconSize = 22
const columnSpacing = 4
const columnHeight = valueHeadroom + plotHeight + 1 + iconSize + columnSpacing
const axisWidth = 32
const columnWidth = 50
const ticks = [100, 50, 0]
const quotaScale: Color[] = ["#FF3B30", ...[15, 40, 60, 100].map((v) => remainingQuotaColor(v))]

function AccountQuotaChart(props: {
  items: QuotaChartItem[]
  average: number | null
  protectAccountIdentity?: boolean
  zoomNamespace?: DashboardOverviewSectionProps["zoomNamespace"]
  onSelectAccount: (account: SubscriptionAccount) => void
}) {
  const { average, items, protectAccountIdentity, zoomNamespace, onSelectAccount } = props
  const metrics = useDashboardMetricAnimation({ average })
  const backgroundGradient = overviewQuotaGradient(average, metrics.value("average"))
  const chart = useMemo(() => (
    <QuotaChartContent
      items={items}
      protectAccountIdentity={protectAccountIdentity}
      zoomNamespace={zoomNamespace}
      onSelectAccount={onSelectAccount}
    />
  ), [items, protectAccountIdentity, zoomNamespace, onSelectAccount, getDashboardLanguage()])
  return (
    <VStack
      alignment="leading"
      spacing={7}
      padding={10}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...overviewRowProps()}
      {...glassCardSurface(backgroundGradient, 16, undefined, metrics.animate("average"))}
      {...metrics.lifecycle}
    >
      {chart}
    </VStack>
  )
}

function QuotaChartContent(props: Pick<DashboardOverviewSectionProps,
  "protectAccountIdentity" | "zoomNamespace" | "onSelectAccount"
> & { items: QuotaChartItem[] }) {
  return (
    <>
      <HStack spacing={6}>
        <Image systemName="chart.bar.xaxis" font="caption" foregroundStyle="label" />
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" layoutPriority={1}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          {localize("账号剩余额度")}
        </Text>
        <Spacer minLength={0} />
        <Text font="caption2" foregroundStyle="secondaryLabel" multilineTextAlignment="trailing" fixedSize={{ horizontal: false, vertical: true }}>
          {localize("左右滑动 · 点击图标查看")}
        </Text>
      </HStack>

      <HStack alignment="top" spacing={4} frame={{ height: columnHeight, alignment: "topLeading" }}>
        <ZStack frame={{ width: axisWidth, height: valueHeadroom + plotHeight + 8 }} accessibilityHidden={true}>
          {ticks.map((tick) => (
            <Text
              key={tick}
              font={10}
              foregroundStyle="secondaryLabel"
              monospacedDigit={true}
              frame={{ width: axisWidth, alignment: "trailing" }}
              position={{ x: axisWidth / 2, y: valueHeadroom + plotHeight * (100 - tick) / 100 }}
            >
              {`${tick}%`}
            </Text>
          ))}
        </ZStack>
        <GeometryReader>
          {(proxy) => <QuotaChartViewport {...props} width={proxy.size.width} />}
        </GeometryReader>
      </HStack>

      <HStack spacing={5} frame={{ maxWidth: "infinity" }}>
        <Capsule fill="systemGray" frame={{ width: 9, height: 4 }} />
        <Text font="caption2" foregroundStyle="secondaryLabel">{localize("额度耗尽")}</Text>
        <Spacer minLength={3} />
        <Text font="caption2" foregroundStyle="secondaryLabel">{localize("额度告急")}</Text>
        <Capsule fill={{ colors: quotaScale, startPoint: "leading", endPoint: "trailing" }} frame={{ width: 52, height: 4 }} />
        <Text font="caption2" foregroundStyle="secondaryLabel">{localize("余量充足")}</Text>
      </HStack>
    </>
  )
}

function QuotaChartViewport(props: Parameters<typeof QuotaChartContent>[0] & { width: number }) {
  const initialEnd = Math.ceil(props.width / columnWidth)
  const [range, setRange] = useState<{ first: number; end: number } | null>(null)
  const lastRange = useRef(range)
  const { first = 0, end = initialEnd } = range ?? {}
  const supportsScrollGeometry = Number.parseInt(Device.systemVersion, 10) >= 18
  const { items, protectAccountIdentity, zoomNamespace, onSelectAccount } = props
  const columns = useMemo(
    () => items.map(({ account, remainingPercent, isExhausted }, index) => {
      const provider = getProviderMeta(account.provider).displayName
      const displayName = localizeAccountName(account.provider, account.displayName || provider)
      const name = protectAccountIdentity && displayName !== localize(provider)
        ? maskIdentity(displayName)
        : displayName
      return (
        <QuotaChartColumn
          key={account.id}
          account={account}
          name={name}
          remainingPercent={remainingPercent}
          isExhausted={isExhausted}
          inViewport={index >= first && index < end}
          animateOnMount={range === null}
          zoomNamespace={zoomNamespace}
          onSelectAccount={onSelectAccount}
        />
      )
    }),
    [items, protectAccountIdentity, zoomNamespace, onSelectAccount, first, end, range === null, getDashboardLanguage()]
  )
  return (
    <ScrollView
      axes="horizontal"
      onScrollGeometryChange={supportsScrollGeometry ? {
        of: "visibleRect",
        onChanged: (_, rect) => {
          if (rect.width <= 0) return
          const left = Math.max(0, Math.min(rect.x, items.length * columnWidth - rect.width))
          const first = Math.floor(left / columnWidth)
          const end = Math.ceil((left + rect.width) / columnWidth)
          const previous = lastRange.current
          if (first === (previous?.first ?? 0) && end === (previous?.end ?? initialEnd)) return
          const next = { first, end }
          lastRange.current = next
          setRange(next)
        },
      } : undefined}
      frame={{ height: columnHeight }}
      scrollBounceBehavior={{ behavior: "basedOnSize", axes: "horizontal" }}
      scrollIndicator="hidden"
      background={
        <ZStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
          allowsHitTesting={false}
          accessibilityHidden={true}
        >
          <VStack spacing={0} frame={{ height: plotHeight + 1 }} padding={{ top: valueHeadroom }}>
            <Rectangle fill="separator" frame={{ height: 1 }} />
            <Spacer minLength={0} />
            <Rectangle fill="separator" frame={{ height: 1 }} />
            <Spacer minLength={0} />
            <Rectangle fill="separator" frame={{ height: 1 }} />
          </VStack>
        </ZStack>
      }
    >
      <LazyHStack alignment="top" spacing={0}>
        {columns}
      </LazyHStack>
    </ScrollView>
  )
}

type QuotaChartMotion = { inViewport: boolean; animateOnMount: boolean }

function QuotaChartColumn(props: QuotaChartItem & QuotaChartMotion & {
  name: string
  zoomNamespace?: DashboardOverviewSectionProps["zoomNamespace"]
  onSelectAccount: (account: SubscriptionAccount) => void
}) {
  const { account, name, remainingPercent, isExhausted, zoomNamespace, onSelectAccount, inViewport, animateOnMount } = props
  return (
    <Button
      buttonStyle="plain"
      accessibilityLabel={name}
      accessibilityValue={`${remainingPercent}%`}
      matchedTransitionSource={zoomNamespace
        ? { id: `overview-account-${account.id}`, namespace: zoomNamespace }
        : undefined}
      action={() => onSelectAccount(account)}
    >
      <VStack spacing={columnSpacing} frame={{ width: columnWidth }} contentShape="rect">
        <QuotaChartBar
          remainingPercent={remainingPercent}
          isExhausted={isExhausted}
          inViewport={inViewport}
          animateOnMount={animateOnMount}
        />
        <ProviderIconView provider={account.provider} size={iconSize} />
      </VStack>
    </Button>
  )
}

function QuotaChartBar({ remainingPercent, isExhausted, inViewport, animateOnMount }: Pick<QuotaChartItem,
  "remainingPercent" | "isExhausted"
> & QuotaChartMotion) {
  const metrics = useDashboardMetricAnimation({ remaining: remainingPercent }, "native", { inViewport, animateOnMount })
  const remaining = metrics.value("remaining")
  const showExhaustedMarker = remaining === 0 && remainingPercent === 0
  const height = showExhaustedMarker ? 2 : plotHeight * remaining / 100
  const animation = metrics.animate("remaining")
  const label = useMemo(() => (
    <QuotaChartPercent remainingPercent={remainingPercent} inViewport={inViewport} animateOnMount={animateOnMount} />
  ), [remainingPercent, inViewport, animateOnMount])

  return (
    <ZStack
      alignment="bottom"
      frame={{ width: columnWidth, height: valueHeadroom + plotHeight + 1, alignment: "bottom" }}
    >
      <RoundedRectangle
        cornerRadius={3}
        fill={dashboardQuotaColor(remaining, remainingPercent, isExhausted)}
        frame={{ width: showExhaustedMarker ? 16 : 28, height: plotHeight }}
        scaleEffect={{ x: 1, y: height / plotHeight, anchor: "bottom" }}
        contentTransition="interpolate"
        animation={animation}
      />
      <VStack spacing={0} offset={{ x: 0, y: -height - 2 }} animation={animation}>
        {label}
      </VStack>
    </ZStack>
  )
}

function QuotaChartPercent({ remainingPercent, inViewport, animateOnMount }: Pick<QuotaChartItem,
  "remainingPercent"
> & QuotaChartMotion) {
  const metrics = useDashboardMetricAnimation({ remaining: remainingPercent }, "wholeNumber", { inViewport, animateOnMount })
  return (
    <Text font={10} fontWeight="semibold" monospacedDigit={true} foregroundStyle="label">
      {`${metrics.value("remaining")}%`}
    </Text>
  )
}
