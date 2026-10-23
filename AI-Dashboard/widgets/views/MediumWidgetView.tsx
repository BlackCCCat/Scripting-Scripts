import {
  Button,
  Capsule,
  Divider,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { RefreshAIDashboardAllIntent } from "../../app_intents"
import { ProviderIconView } from "../../components/ProviderIconView"
import { MultiQuotaAdaptiveList } from "../components/MultiQuotaAdaptiveList"
import { WidgetQuotaStatusDot } from "../components/WidgetQuotaStatusDot"
import type { WidgetAccountData } from "../types"
import {
  formatCurrencyAmount,
  getQuotaStatusColor,
} from "../utils"

export function MediumAccountCard(props: {
  account: WidgetAccountData
  lastUpdatedAt?: string
  heightMode?: "normal" | "compact"
  showUpdatedAt?: boolean
  adaptTransparent?: boolean
}) {
  const { account, lastUpdatedAt, heightMode = "normal", showUpdatedAt = false, adaptTransparent = false } = props
  const isCompact = heightMode === "compact"
  const statusColor = account.statusColor ?? getQuotaStatusColor(account.worstUsedPercentage)
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

          {/* 小组件更新时间与桌面一键刷新 */}
          {showUpdatedAt && (account.updateStatusText || lastUpdatedAt) ? (
            <Button intent={RefreshAIDashboardAllIntent(undefined)} buttonStyle="plain">
              <HStack alignment="center" spacing={3}>
                <Text
                  font={isCompact ? 7 : 8}
                  foregroundStyle={
                    account.updateStatusText === "正在刷新..."
                      ? "systemBlue"
                      : account.isUpdateWarning
                        ? "systemOrange"
                        : "secondaryLabel"
                  }
                  lineLimit={1}
                >
                  {account.updateStatusText || `更新于 ${lastUpdatedAt}`}
                </Text>
                <Image
                  systemName="arrow.triangle.2.circlepath"
                  font={isCompact ? 7 : 8}
                  foregroundStyle={
                    account.updateStatusText === "正在刷新..."
                      ? "systemBlue"
                      : account.isUpdateWarning
                        ? "systemOrange"
                        : "secondaryLabel"
                  }
                />
              </HStack>
            </Button>
          ) : null}

          <WidgetQuotaStatusDot
            usedPercentage={account.worstUsedPercentage}
            overallStatus={account.overallStatus}
            statusColor={statusColor}
            adaptTransparent={adaptTransparent}
            isCompact={isCompact}
            baseSize={isCompact ? 5 : 5.5}
          />
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
        ) : (
          <VStack
            alignment="leading"
            spacing={isCompact ? 2.5 : quotaCount <= 3 ? 3.5 : 2.5}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <MultiQuotaAdaptiveList
              quotas={account.quotas.slice(0, 5)}
              compact={isCompact || quotaCount >= 4}
              forceInline={false}
              showCountdown={true}
              barHeight={barHeight}
              titleFont={titleFont}
              valueFont={valueFont}
            />
          </VStack>
        )}
      </VStack>
    </ZStack>
  )
}

export function MediumWidgetView(props: {
  accounts: WidgetAccountData[]
  lastUpdatedAt?: string
  adaptTransparent?: boolean
}) {
  const { accounts, lastUpdatedAt, adaptTransparent } = props

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
      adaptTransparent={adaptTransparent}
    />
  )
}
