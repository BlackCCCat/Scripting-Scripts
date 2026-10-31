import {
  BarChart,
  Button,
  Chart,
  HStack,
  Image,
  LazyVGrid,
  RoundedRectangle,
  ScrollView,
  Section,
  Spacer,
  Text,
  VStack,
  useMemo,
} from "scripting"
import {
  AccountQuotaState,
  SubscriptionAccount,
} from "../models/types"
import {
  formatMoney,
} from "../utils/quota_formatting"
import {
  adaptiveSecondaryButtonStyle,
  computeAccountOverallQuota,
  remainingQuotaColor,
} from "../utils/theme"
import { ProviderIconView } from "./ProviderIconView"

interface QuotaChartItem {
  accountId: string
  provider: SubscriptionAccount["provider"]
  usedPercent: number
  remainingPercent: number
  isExhausted?: boolean
}

export function DashboardOverviewSection(props: {
  accounts: SubscriptionAccount[]
  accountStates: Record<string, AccountQuotaState>
  isDemoMode: boolean
  zoomNamespace?: any
  onToggleDemoMode: (val: boolean) => void
  onSelectAccount: (acc: SubscriptionAccount) => void
  onOpenEditSheet?: () => void
}) {
  const {
    accounts,
    accountStates,
    isDemoMode,
    onToggleDemoMode,
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

      if (!overall.isWalletOnly) {
        chartItems.push({
          accountId: acc.id,
          provider: acc.provider,
          usedPercent: overall.usedPercent,
          remainingPercent: overall.remainingPercent,
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
        : 100

    return {
      totalCny,
      grantedCny,
      totalUsd,
      grantedUsd,
      healthyCount,
      warningCount,
      avgRemainingPercent,
      chartItems,
    }
  }, [accounts, accountStates])

  const avgUsedPercent = Math.max(0, 100 - stats.avgRemainingPercent)
  const avgHealthColor = remainingQuotaColor(stats.avgRemainingPercent, false)
  const chartContentWidth = Math.max(310, stats.chartItems.length * 54)

  return (
    <Section
      header={
        <HStack alignment="center">
          <Image
            systemName="gauge.with.dots.needle.67percent"
            font="caption"
            foregroundStyle="accentColor"
          />
          <Text>全局额度与资产总览</Text>
          <Spacer />
          <Text
            font="caption2"
            foregroundStyle={isDemoMode ? "systemOrange" : "systemGreen"}
          >
            {isDemoMode ? "● 演示数据" : "● 实时直连"}
          </Text>
        </HStack>
      }
    >
      <VStack alignment="leading" spacing={14} padding={{ vertical: 4 }}>
        {/* 顶部模式说明与快速切换栏 */}
        <HStack
          alignment="center"
          spacing={10}
          padding={{ horizontal: 12, vertical: 10 }}
          background={
            <RoundedRectangle
              cornerRadius={12}
              style="continuous"
              fill="quaternarySystemFill"
            />
          }
        >
          <Image
            systemName={
              isDemoMode
                ? "sparkles.rectangle.stack.fill"
                : "lock.shield.fill"
            }
            font="title3"
            foregroundStyle={isDemoMode ? "systemOrange" : "systemGreen"}
          />
          <VStack alignment="leading" spacing={2}>
            <Text font="subheadline" fontWeight="semibold">
              {isDemoMode ? "演示数据模式" : "真实直连模式"}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {isDemoMode
                ? "展示订阅配额进度与钱包余额样例"
                : "本机钥匙串直连各平台官方接口"}
            </Text>
          </VStack>
          <Spacer />
          <Button
            title={isDemoMode ? "切换真实" : "查看演示"}
            buttonStyle={adaptiveSecondaryButtonStyle()}
            controlSize="small"
            action={() => onToggleDemoMode(!isDemoMode)}
          />
        </HStack>

        {/* 2x2 核心 KPI 指标卡片网格 */}
        <LazyVGrid
          columns={[
            { size: { type: "flexible" }, spacing: 10 },
            { size: { type: "flexible" }, spacing: 10 },
          ]}
          spacing={10}
        >
          {/* KPI 1: 监控服务数（点击进入编辑排序页面） */}
          <Button
            buttonStyle="plain"
            frame={{ maxWidth: "infinity" }}
            matchedTransitionSource={
              props.zoomNamespace
                ? {
                    id: "overview-edit-accounts",
                    namespace: props.zoomNamespace,
                  }
                : undefined
            }
            action={() => {
              if (onOpenEditSheet) onOpenEditSheet()
            }}
          >
            <VStack
              alignment="leading"
              spacing={6}
              padding={12}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              background={
                <RoundedRectangle
                  cornerRadius={14}
                  style="continuous"
                  fill="quaternarySystemFill"
                />
              }
            >
              <HStack spacing={6}>
                <Image
                  systemName="square.stack.3d.up.fill"
                  font="caption"
                  foregroundStyle="systemBlue"
                />
                <Text font="caption" foregroundStyle="secondaryLabel">
                  监控 AI 账号
                </Text>
                <Spacer />
                <Image
                  systemName="chevron.right"
                  font="caption2"
                  foregroundStyle="tertiaryLabel"
                />
              </HStack>
              <Text font="title2" fontWeight="bold" monospacedDigit={true}>
                {`${accounts.length} 个`}
              </Text>
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                {stats.warningCount > 0
                  ? `${stats.healthyCount} 正常 · ${stats.warningCount} 预警`
                  : `全部 ${stats.healthyCount} 个配额健康`}
              </Text>
            </VStack>
          </Button>

          {/* KPI 2: 平均剩余配额 */}
          <VStack
            alignment="leading"
            spacing={6}
            padding={12}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            background={
              <RoundedRectangle
                cornerRadius={14}
                style="continuous"
                fill="quaternarySystemFill"
              />
            }
          >
            <HStack spacing={6}>
              <Image
                systemName="chart.pie.fill"
                font="caption"
                foregroundStyle={avgHealthColor}
              />
              <Text font="caption" foregroundStyle="secondaryLabel">
                平均剩余配额
              </Text>
              <Spacer />
            </HStack>
            <Text
              font="title2"
              fontWeight="bold"
              monospacedDigit={true}
              foregroundStyle={avgHealthColor}
              lineLimit={1}
            >
              {`${stats.avgRemainingPercent}%`}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {`平均已消耗 ${avgUsedPercent}% 周期额度`}
            </Text>
          </VStack>

          {/* KPI 3: 人民币钱包总额 */}
          <VStack
            alignment="leading"
            spacing={6}
            padding={12}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            background={
              <RoundedRectangle
                cornerRadius={14}
                style="continuous"
                fill="quaternarySystemFill"
              />
            }
          >
            <HStack spacing={6}>
              <Image
                systemName="yensign.circle.fill"
                font="caption"
                foregroundStyle="systemOrange"
              />
              <Text font="caption" foregroundStyle="secondaryLabel">
                人民币钱包池
              </Text>
              <Spacer />
            </HStack>
            <Text font="title2" fontWeight="bold" monospacedDigit={true} lineLimit={1}>
              {formatMoney(stats.totalCny, "CNY")}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {stats.grantedCny > 0
                ? `含赠送金 ${formatMoney(stats.grantedCny, "CNY")}`
                : "API 预充值可用余额"}
            </Text>
          </VStack>

          {/* KPI 4: 美元钱包总额 */}
          <VStack
            alignment="leading"
            spacing={6}
            padding={12}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            background={
              <RoundedRectangle
                cornerRadius={14}
                style="continuous"
                fill="quaternarySystemFill"
              />
            }
          >
            <HStack spacing={6}>
              <Image
                systemName="dollarsign.circle.fill"
                font="caption"
                foregroundStyle="systemIndigo"
              />
              <Text font="caption" foregroundStyle="secondaryLabel">
                美元钱包池
              </Text>
              <Spacer />
            </HStack>
            <Text font="title2" fontWeight="bold" monospacedDigit={true} lineLimit={1}>
              {formatMoney(stats.totalUsd, "USD")}
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {stats.grantedUsd > 0
                ? `含赠送金 ${formatMoney(stats.grantedUsd, "USD")}`
                : "国际平台与网关合计"}
            </Text>
          </VStack>
        </LazyVGrid>

        {/* 订阅配额柱状对比图（顺序跟随下方卡片，支持左右滑动查看更多，颜色随剩余量由绿向红平滑过渡） */}
        {stats.chartItems.length > 0 ? (
          <VStack
            alignment="leading"
            spacing={10}
            padding={12}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            background={
              <RoundedRectangle
                cornerRadius={14}
                style="continuous"
                fill="quaternarySystemFill"
              />
            }
          >
            <HStack alignment="center">
              <Image
                systemName="chart.bar.xaxis"
                font="caption"
                foregroundStyle="accentColor"
              />
              <Text font="subheadline" fontWeight="semibold">
                各平台周期配额剩余比例
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle="secondaryLabel">
                左右滑动 · 点击图标查看
              </Text>
            </HStack>

            <ScrollView axes="horizontal" scrollIndicator="hidden">
              <VStack
                spacing={6}
                frame={{ width: chartContentWidth, alignment: "leading" }}
              >
                <Chart
                  chartXAxis="hidden"
                  chartYAxis="hidden"
                  chartYScale={{ from: 0, to: 118 }}
                  frame={{ width: chartContentWidth, height: 120 }}
                >
                  <BarChart
                    marks={stats.chartItems.map((item) => ({
                      label: item.accountId,
                      value: item.remainingPercent,
                      cornerRadius: 6,
                      foregroundStyle: remainingQuotaColor(
                        item.remainingPercent,
                        item.isExhausted
                      ),
                      annotation: {
                        position: "top",
                        alignment: "center",
                        spacing: 3,
                        content: (
                          <Text
                            font="caption2"
                            fontWeight="semibold"
                            monospacedDigit={true}
                            foregroundStyle="secondaryLabel"
                          >
                            {`${item.remainingPercent}%`}
                          </Text>
                        ),
                      },
                    }))}
                  />
                </Chart>

                <RoundedRectangle
                  cornerRadius={0.5}
                  fill="separator"
                  frame={{ width: chartContentWidth, height: 1 }}
                />

                {/* 横坐标：与柱状图等宽列对齐的供应商图标栏 */}
                <HStack
                  spacing={0}
                  frame={{ width: chartContentWidth }}
                >
                  {stats.chartItems.map((item) => {
                    const targetAcc = accounts.find(
                      (a) => a.id === item.accountId
                    )
                    return (
                      <Button
                        key={item.accountId}
                        buttonStyle="borderless"
                        frame={{ maxWidth: "infinity" }}
                        matchedTransitionSource={
                          props.zoomNamespace
                            ? {
                                id: `overview-account-${item.accountId}`,
                                namespace: props.zoomNamespace,
                              }
                            : undefined
                        }
                        action={() => {
                          if (targetAcc) onSelectAccount(targetAcc)
                        }}
                      >
                        <VStack alignment="center" padding={{ top: 2 }}>
                          <ProviderIconView
                            provider={item.provider}
                            size={28}
                          />
                        </VStack>
                      </Button>
                    )
                  })}
                </HStack>
              </VStack>
            </ScrollView>
          </VStack>
        ) : null}
      </VStack>
    </Section>
  )
}
