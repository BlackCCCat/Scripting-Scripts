import {
  Button,
  Capsule,
  Circle,
  type Color,
  type DynamicShapeStyle,
  EmptyView,
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
  VStack,
  ZStack,
} from "scripting"
import type { AccountQuotaState, SubscriptionAccount } from "../models/types"
import { getDashboardLanguage, localize } from "../utils/localization"
import { formatMoney, formatShortDateTime } from "../utils/quota_formatting"
import { getProviderMeta, localizeAccountName } from "../utils/providers_catalog"
import { computeAccountOverallQuota, maskIdentity, remainingQuotaColor } from "../utils/theme"
import { glassCardSurface } from "./GlassCardSurface"
import { ProviderIconView } from "./ProviderIconView"

const neutralCardAccent = "#8E8E93"
const cardSecondaryText = "rgba(255,255,255,0.88)"
const chartGridColor = "rgba(255,255,255,0.22)"

function overviewCardPalette(accent: Color) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(accent.slice(offset, offset + 2), 16))
  // Keep the accent hue while providing contrast for the white title and captions.
  const shade = (strength: number): Color => {
    const [red, green, blue] = channels.map((channel) => Math.round(18 + (channel - 18) * strength))
    return `rgb(${red},${green},${blue})`
  }

  const fill: DynamicShapeStyle = {
    light: gradient("linear", {
      colors: [shade(0.26), shade(0.43)],
      startPoint: "topLeading",
      endPoint: "bottomTrailing",
    }),
    dark: gradient("linear", {
      colors: [shade(0.20), shade(0.37)],
      startPoint: "topLeading",
      endPoint: "bottomTrailing",
    }),
  }
  return { fill, tint: shade(0.36) }
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

function OverviewArcs() {
  return (
    <GeometryReader>
      {(proxy) => (
        <RoundedRectangle
          cornerRadius={20}
          style="continuous"
          fill={gradient("radial", {
            stops: [
              { color: "clear", location: 0 },
              { color: "clear", location: 0.70 },
              { color: "rgba(255,255,255,0.10)", location: 0.70 },
              { color: "rgba(255,255,255,0.08)", location: 0.78 },
              { color: "rgba(255,255,255,0.05)", location: 0.78 },
              { color: "rgba(255,255,255,0.03)", location: 0.92 },
              { color: "clear", location: 0.92 },
              { color: "clear", location: 1 },
            ],
            center: { x: 1.02, y: 0.35 },
            startRadius: 0,
            endRadius: proxy.size.width * 0.76,
          })}
        />
      )}
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

  const average = stats.avgRemainingPercent
  const quotaPalette = overviewCardPalette(
    average === null || average === 0 ? neutralCardAccent : remainingQuotaColor(average)
  )
  const lastUpdated = stats.lastUpdated
    ? formatShortDateTime(new Date(stats.lastUpdated).toISOString())
    : null

  const cards = (
    <VStack
      alignment="leading"
      spacing={9}
      listRowInsets={0}
      listRowSeparator="hidden"
      listRowBackground={<EmptyView />}
    >
      <Button
        buttonStyle="plain"
        accessibilityHint={localize("编辑账号卡片")}
        matchedTransitionSource={props.zoomNamespace
          ? { id: "overview-edit-accounts", namespace: props.zoomNamespace }
          : undefined}
        action={() => onOpenEditSheet?.()}
      >
        <VStack
          alignment="leading"
          spacing={7}
          padding={14}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          contentShape="rect"
          {...glassCardSurface(quotaPalette.fill, 20, { decoration: <OverviewArcs />, tint: quotaPalette.tint })}
        >
          <Text font="subheadline" fontWeight="semibold" foregroundStyle="white">
            {localize("平均剩余配额")}
          </Text>
          <HStack alignment="center" spacing={8}>
            <Text font="largeTitle" fontWeight="bold" monospacedDigit={true} foregroundStyle="white" layoutPriority={1}>
              {average === null ? "—" : `${average}%`}
            </Text>
            <Spacer minLength={0} />
            <VStack alignment="trailing" spacing={3}>
              <HStack spacing={3}>
                <Text font="caption" fontWeight="semibold" foregroundStyle="white" multilineTextAlignment="trailing"
                  fixedSize={{ horizontal: false, vertical: true }}
                >
                  {localize(`${accounts.length} 个`)}
                </Text>
                <Image systemName="chevron.right" font="caption2" foregroundStyle="white" />
              </HStack>
              <Text font="caption2" foregroundStyle={cardSecondaryText} multilineTextAlignment="trailing"
                fixedSize={{ horizontal: false, vertical: true }}
              >
                {localize(average === null
                  ? "暂无可计算的周期配额"
                  : stats.warningCount > 0
                    ? `${stats.healthyCount} 正常 · ${stats.warningCount} 预警`
                    : `全部 ${stats.healthyCount} 个配额健康`)}
              </Text>
            </VStack>
          </HStack>
          {average !== null || lastUpdated ? (
            <HStack alignment="top" spacing={5}>
              {average !== null ? (
                <Text font="caption2" foregroundStyle={cardSecondaryText} fixedSize={{ horizontal: false, vertical: true }}>
                  {localize(`平均已消耗 ${Math.max(0, 100 - average)}% 周期额度`)}
                </Text>
              ) : null}
              <Spacer minLength={0} />
              {lastUpdated ? (
                <Text font="caption2" foregroundStyle={cardSecondaryText} multilineTextAlignment="trailing"
                  fixedSize={{ horizontal: false, vertical: true }}
                >
                  {localize(`更新于 ${lastUpdated}`)}
                </Text>
              ) : null}
            </HStack>
          ) : null}
        </VStack>
      </Button>

      <LazyVGrid columns={[
        { size: { type: "flexible", min: 0 }, spacing: 8 },
        { size: { type: "flexible", min: 0 }, spacing: 8 },
      ]} spacing={8}>
        <WalletOverview currency="CNY" balance={stats.totalCny} granted={stats.grantedCny} />
        <WalletOverview currency="USD" balance={stats.totalUsd} granted={stats.grantedUsd} />
      </LazyVGrid>

      {stats.chartItems.length > 0 ? (
        <AccountQuotaChart
          items={stats.chartItems}
          palette={quotaPalette}
          protectAccountIdentity={protectAccountIdentity}
          zoomNamespace={props.zoomNamespace}
          onSelectAccount={onSelectAccount}
        />
      ) : null}
    </VStack>
  )

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
    >
      {cards}
    </Section>
  )
}

function WalletOverview(props: { currency: WalletCurrency; balance: number; granted: number }) {
  const { currency, balance, granted } = props
  const isCNY = currency === "CNY"
  const note = Number.isFinite(balance)
    ? banknoteAccents[currency].find(([denomination]) => balance >= denomination)
    : undefined
  const { fill, tint } = overviewCardPalette(note?.[1] ?? neutralCardAccent)
  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={10}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      {...glassCardSurface(fill, 14, { tint })}
    >
      <HStack spacing={4}>
        <Image systemName={isCNY ? "yensign.circle" : "dollarsign.circle"} font="caption" foregroundStyle="white" />
        <Text font="caption" foregroundStyle={cardSecondaryText} fixedSize={{ horizontal: false, vertical: true }}>
          {localize(isCNY ? "人民币钱包池" : "美元钱包池")}
        </Text>
      </HStack>
      <Text font="title3" fontWeight="semibold" monospacedDigit={true} foregroundStyle="white" fixedSize={{ horizontal: false, vertical: true }}>
        {formatMoney(balance, currency)}
      </Text>
      <Text font="caption2" foregroundStyle={cardSecondaryText} fixedSize={{ horizontal: false, vertical: true }}>
        {granted > 0
          ? localize(`含赠送金 ${formatMoney(granted, currency)}`)
          : localize(isCNY ? "API 预充值可用余额" : "国际平台与网关合计")}
      </Text>
    </VStack>
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
  palette: ReturnType<typeof overviewCardPalette>
  protectAccountIdentity?: boolean
  zoomNamespace?: DashboardOverviewSectionProps["zoomNamespace"]
  onSelectAccount: (account: SubscriptionAccount) => void
}) {
  const { items, palette, protectAccountIdentity, zoomNamespace, onSelectAccount } = props
  const columns = useMemo(
    () => items.map(({ account, remainingPercent, isExhausted }) => {
      const provider = getProviderMeta(account.provider).displayName
      const displayName = localizeAccountName(account.provider, account.displayName || provider)
      const name = protectAccountIdentity && displayName !== localize(provider)
        ? maskIdentity(displayName)
        : displayName
      return { account, remainingPercent, isExhausted, name }
    }),
    [items, protectAccountIdentity, getDashboardLanguage()]
  )
  return (
    <VStack
      alignment="leading"
      spacing={7}
      padding={10}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...glassCardSurface(palette.fill, 16, { tint: palette.tint })}
    >
      <HStack spacing={6}>
        <Image systemName="chart.bar.xaxis" font="caption" foregroundStyle="white" />
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="white" layoutPriority={1}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          {localize("账号剩余额度")}
        </Text>
        <Spacer minLength={0} />
        <Text font="caption2" foregroundStyle={cardSecondaryText} multilineTextAlignment="trailing" fixedSize={{ horizontal: false, vertical: true }}>
          {localize("左右滑动 · 点击图标查看")}
        </Text>
      </HStack>

      <HStack alignment="top" spacing={4}>
        <ZStack frame={{ width: axisWidth, height: valueHeadroom + plotHeight + 8 }} accessibilityHidden={true}>
          {ticks.map((tick) => (
            <Text
              key={tick}
              font={10}
              foregroundStyle={cardSecondaryText}
              monospacedDigit={true}
              frame={{ width: axisWidth, alignment: "trailing" }}
              position={{ x: axisWidth / 2, y: valueHeadroom + plotHeight * (100 - tick) / 100 }}
            >
              {`${tick}%`}
            </Text>
          ))}
        </ZStack>
        <ScrollView
          axes="horizontal"
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
                <Rectangle fill={chartGridColor} frame={{ height: 1 }} />
                <Spacer minLength={0} />
                <Rectangle fill={chartGridColor} frame={{ height: 1 }} />
                <Spacer minLength={0} />
                <Rectangle fill={chartGridColor} frame={{ height: 1 }} />
              </VStack>
            </ZStack>
          }
        >
          <LazyHStack alignment="top" spacing={0}>
            {columns.map(({ account, name, remainingPercent, isExhausted }) => (
              <Button
                key={account.id}
                buttonStyle="plain"
                accessibilityLabel={name}
                accessibilityValue={`${remainingPercent}%`}
                matchedTransitionSource={zoomNamespace
                  ? { id: `overview-account-${account.id}`, namespace: zoomNamespace }
                  : undefined}
                action={() => onSelectAccount(account)}
              >
                <VStack spacing={columnSpacing} frame={{ width: columnWidth }} contentShape="rect">
                  <VStack spacing={2} frame={{ height: valueHeadroom + plotHeight + 1, alignment: "bottom" }}>
                    <Text font={10} fontWeight="semibold" monospacedDigit={true} foregroundStyle="white">
                      {`${remainingPercent}%`}
                    </Text>
                    <RoundedRectangle
                      cornerRadius={3}
                      fill={remainingQuotaColor(remainingPercent, isExhausted)}
                      frame={{
                        width: remainingPercent === 0 ? 16 : 28,
                        height: Math.max(2, plotHeight * remainingPercent / 100),
                      }}
                    />
                  </VStack>
                  <ProviderIconView provider={account.provider} size={iconSize} />
                </VStack>
              </Button>
            ))}
          </LazyHStack>
        </ScrollView>
      </HStack>

      <HStack spacing={5} frame={{ maxWidth: "infinity" }}>
        <Capsule fill="systemGray" frame={{ width: 9, height: 4 }} />
        <Text font="caption2" foregroundStyle={cardSecondaryText}>{localize("额度耗尽")}</Text>
        <Spacer minLength={3} />
        <Text font="caption2" foregroundStyle={cardSecondaryText}>{localize("额度告急")}</Text>
        <Capsule fill={{ colors: quotaScale, startPoint: "leading", endPoint: "trailing" }} frame={{ width: 52, height: 4 }} />
        <Text font="caption2" foregroundStyle={cardSecondaryText}>{localize("余量充足")}</Text>
      </HStack>
    </VStack>
  )
}
