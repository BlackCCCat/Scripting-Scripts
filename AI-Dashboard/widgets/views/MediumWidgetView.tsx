import {
  Capsule,
  Circle,
  Divider,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { ProviderIconView } from "../../components/ProviderIconView"
import { remainingQuotaColor } from "../../utils/theme"
import { CircularQuotaRing } from "../components/CircularQuotaRing"
import { CodexForecastPill } from "../components/CodexForecastPill"
import { MultiQuotaAdaptiveList } from "../components/MultiQuotaAdaptiveList"
import type { WidgetAccountData } from "../types"
import {
  formatCurrencyAmount,
  getProgressBarTrackColor,
  getQuotaStatusColor,
} from "../utils"

export function MediumAccountCard(props: {
  account: WidgetAccountData
  lastUpdatedAt?: string
  heightMode?: "normal" | "compact"
  showUpdatedAt?: boolean
}) {
  const { account, lastUpdatedAt, heightMode = "normal", showUpdatedAt = false } = props
  const isCompact = heightMode === "compact"
  const statusColor = getQuotaStatusColor(account.worstUsedPercentage)
  const isWallet = account.isWallet && Boolean(account.wallet)
  const quotaCount = account.quotas.length

  // 根据不同容器高度自适应调整进度条高度与字号
  const barHeight = isCompact
    ? quotaCount <= 3 ? 6.5 : quotaCount === 4 ? 5.5 : 4.5
    : quotaCount <= 3 ? 10 : quotaCount === 4 ? 7.5 : 5.5

  const titleFont = isCompact
    ? quotaCount <= 3 ? 11.5 : quotaCount === 4 ? 10 : 8.5
    : quotaCount <= 3 ? 14.5 : quotaCount === 4 ? 11.5 : 9.5

  const valueFont = titleFont
  const watermarkSize = isCompact ? 95 : 145

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={
        isCompact
          ? { top: 6, leading: 11, bottom: 6, trailing: 11 }
          : { top: 9, leading: 13, bottom: 9, trailing: 13 }
      }
      widgetURL={`ai-dashboard://account/${account.id}`}
    >
      {/* 背景大水印 (尺寸自适应，透明度 0.48) */}
      <HStack
        alignment="bottom"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Spacer />
        <ProviderIconView
          provider={account.provider}
          size={watermarkSize}
          rawEmblemOnly={true}
          dimmed={true}
          opacity={0.48}
        />
      </HStack>

      {/* 前景内容：单卡通栏垂直排布，进度条宽度适应卡片全宽 */}
      <VStack
        alignment="leading"
        spacing={isCompact ? 3 : quotaCount <= 3 ? 5 : 4}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      >
        {/* 顶部标题栏：供应商名称、重置预测、套餐、重置卡、更新时间与健康状态 */}
        <HStack alignment="center" spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text font={isCompact ? 13 : 15} fontWeight="heavy" lineLimit={1}>
            {account.displayName}
          </Text>

          {/* 重置预测直接显示在标题后 */}
          {account.codexResetForecast?.scheduledText || account.codexResetForecast?.probabilityText ? (
            <HStack
              alignment="center"
              spacing={2.5}
              padding={{ horizontal: 4.5, vertical: 1.2 }}
              background={<Capsule fill="quaternarySystemFill" />}
            >
              <Image systemName="sparkles" font={isCompact ? 7.5 : 8.5} foregroundStyle="systemIndigo" />
              <Text font={isCompact ? 7.5 : 8.5} fontWeight="bold" foregroundStyle="systemIndigo" lineLimit={1}>
                {`⚡️${account.codexResetForecast.scheduledText || account.codexResetForecast.probabilityText}`}
              </Text>
            </HStack>
          ) : null}

          {account.planName ? (
            <Text
              font={isCompact ? 7 : 7.5}
              fontWeight="bold"
              foregroundStyle="secondaryLabel"
              padding={{ horizontal: 3.5, vertical: 0.8 }}
              background={<Capsule fill="quaternarySystemFill" />}
              lineLimit={1}
            >
              {account.planName}
            </Text>
          ) : null}

          {account.codexResetCardsCount !== undefined ? (
            <Text
              font={isCompact ? 7 : 7.5}
              fontWeight="bold"
              foregroundStyle="systemIndigo"
              padding={{ horizontal: 3.5, vertical: 0.8 }}
              background={<Capsule fill="quaternarySystemFill" />}
              lineLimit={1}
            >
              {`🎟️ x${account.codexResetCardsCount}`}
            </Text>
          ) : null}

          <Spacer />

          {/* 小组件更新时间 */}
          {showUpdatedAt && lastUpdatedAt ? (
            <Text font={isCompact ? 7 : 8} foregroundStyle="secondaryLabel" lineLimit={1}>
              {`更新于 ${lastUpdatedAt}`}
            </Text>
          ) : null}

          <Circle fill={statusColor} frame={{ width: isCompact ? 5 : 5.5, height: isCompact ? 5 : 5.5 }} />
        </HStack>

        <Divider />

        {/* 核心数据呈现 */}
        {isWallet ? (
          <VStack alignment="leading" spacing={isCompact ? 3 : 5} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <Spacer />
            <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={isCompact ? 2 : 3.5}>
                <HStack alignment="center" spacing={4}>
                  <Text font={isCompact ? 10 : 11.5} fontWeight="bold" foregroundStyle="secondaryLabel">
                    账户可用资金池 (预付费)
                  </Text>
                  <Text
                    font={isCompact ? 7.5 : 8}
                    fontWeight="bold"
                    foregroundStyle="systemGreen"
                    padding={{ horizontal: 4, vertical: 1 }}
                    background={<Capsule fill="quaternarySystemFill" />}
                  >
                    资金充足
                  </Text>
                </HStack>
                <Text font={isCompact ? 26 : 34} fontWeight="heavy" monospaced={true} foregroundStyle="label">
                  {formatCurrencyAmount(account.wallet?.total ?? 0, account.wallet?.currency)}
                </Text>
                {account.wallet?.toppedUp !== undefined || account.wallet?.granted !== undefined ? (
                  <Text font={isCompact ? 8 : 9} foregroundStyle="secondaryLabel">
                    {`${account.wallet?.toppedUp !== undefined ? `充值 ¥${account.wallet.toppedUp.toFixed(2)} ` : ""}${account.wallet?.granted !== undefined ? `· 赠金 ¥${account.wallet.granted.toFixed(2)}` : ""}`.trim()}
                  </Text>
                ) : null}
              </VStack>
              <Spacer />
            </HStack>
            <Spacer />
          </VStack>
        ) : quotaCount <= 5 ? (
          <VStack
            alignment="leading"
            spacing={isCompact ? 2.5 : quotaCount <= 3 ? 3.5 : 2.5}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <MultiQuotaAdaptiveList
              quotas={account.quotas}
              compact={isCompact || quotaCount >= 4}
              forceInline={false}
              showCountdown={true}
              barHeight={barHeight}
              titleFont={titleFont}
              valueFont={valueFont}
            />
          </VStack>
        ) : quotaCount <= 8 ? (
          <HStack alignment="center" spacing={5} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <Spacer />
            {account.quotas.map((q) => (
              <CircularQuotaRing
                key={q.id}
                item={q}
                size={isCompact ? 24 : 28}
                strokeWidth={2.6}
                showLabel={true}
              />
            ))}
            <Spacer />
          </HStack>
        ) : (
          /* 柱状图模式 */
          <HStack alignment="bottom" spacing={3.5} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <Spacer />
            {account.quotas.map((q) => {
              const remPct = Math.min(100, Math.max(0, q.remainingPercentage))
              const barH = Math.max(4, Math.round((remPct / 100) * (isCompact ? 40 : 52)))
              const colColor = remainingQuotaColor(remPct, q.isExhausted)
              return (
                <VStack key={q.id} alignment="center" spacing={2}>
                  <Text font={6.5} fontWeight="heavy" foregroundStyle={colColor} monospaced={true}>
                    {Math.round(remPct)}
                  </Text>
                  <ZStack alignment="bottom" frame={{ width: 12, height: isCompact ? 40 : 52 }}>
                    <Capsule fill={getProgressBarTrackColor()} frame={{ width: 12, height: isCompact ? 40 : 52 }} />
                    <Capsule fill={colColor} frame={{ width: 12, height: barH }} />
                  </ZStack>
                  <Text font={6} fontWeight="medium" foregroundStyle="label" lineLimit={1} frame={{ width: 20 }}>
                    {q.name}
                  </Text>
                </VStack>
              )
            })}
            <Spacer />
          </HStack>
        )}
      </VStack>
    </ZStack>
  )
}

export function MediumWidgetView(props: {
  accounts: WidgetAccountData[]
  lastUpdatedAt?: string
}) {
  const { accounts, lastUpdatedAt } = props

  if (!accounts || accounts.length === 0) {
    return (
      <VStack
        alignment="leading"
        spacing={8}
        padding={16}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Image
          systemName="chart.bar.doc.horizontal.fill"
          font={22}
          foregroundStyle="accentColor"
        />
        <Text font="headline" fontWeight="bold">
          AI 额度看板
        </Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          暂未配置监控账号，请打开应用添加供应商
        </Text>
      </VStack>
    )
  }

  return (
    <MediumAccountCard
      account={accounts[0]}
      lastUpdatedAt={lastUpdatedAt}
      heightMode="normal"
      showUpdatedAt={true}
    />
  )
}
