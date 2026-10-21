import {
  Capsule,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { ProviderIconView } from "../../components/ProviderIconView"
import { CircularQuotaRing } from "../components/CircularQuotaRing"
import { CodexForecastPill } from "../components/CodexForecastPill"
import { MultiQuotaAdaptiveList } from "../components/MultiQuotaAdaptiveList"
import { QuotaProgressBar } from "../components/QuotaProgressBar"
import { WidgetHeader } from "../components/WidgetHeader"
import type { WidgetAccountData } from "../types"
import { formatCurrencyAmount } from "../utils"

export function SmallWidgetView(props: {
  account?: WidgetAccountData
  allAccounts?: WidgetAccountData[]
  lastUpdatedAt?: string
  adaptTransparent?: boolean
  onSelectProvider?: (providerId: string) => void
}) {
  const { account, lastUpdatedAt, adaptTransparent } = props

  if (!account) {
    return (
      <VStack
        alignment="leading"
        spacing={8}
        padding={14}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Image
          systemName="chart.bar.doc.horizontal.fill"
          font={20}
          foregroundStyle="accentColor"
        />
        <Text font="headline" fontWeight="bold">
          AI 额度看板
        </Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="secondaryLabel">
          请在小组件参数中指定供应商（如 codex）或在应用内添加账号
        </Text>
      </VStack>
    )
  }

  const isWallet = account.isWallet && Boolean(account.wallet)
  const hasCodexForecast = Boolean(
    account.codexResetForecast?.scheduledText || account.codexResetForecast?.probabilityText
  )
  const quotaCount = account.quotas.length

  return (
    <ZStack
      alignment="center"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={{ top: 10, leading: 12, bottom: 8, trailing: 12 }}
      widgetURL={`ai-dashboard://account/${account.id}`}
    >
      {/* 背景半透明纯图标大水印 (清晰显眼，无任何多余色块底盒) */}
      <HStack
        alignment="bottom"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Spacer />
        <ProviderIconView
          provider={account.provider}
          size={110}
          rawEmblemOnly={true}
          dimmed={true}
          opacity={0.46}
        />
      </HStack>

      {/* 前景内容：按 Codex 小组件的优雅通透排版，最大化占满屏幕空间 */}
      <VStack
        alignment="leading"
        spacing={3}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      >
        {/* 头部：展示供应商名称、套餐徽标、状态圆点 */}
        <WidgetHeader
          account={account}
          size="small"
          showCountdown={false}
          adaptTransparent={adaptTransparent}
        />

        <Spacer />

        {/* 核心数据展现：即使单个数据也尽可能撑满空间 */}
        {isWallet ? (
          /* 单金额类型供应商（如 DeepSeek）：巨幅数值撑满卡片，配可用状态胶囊 */
          <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
            <HStack alignment="center" spacing={4}>
              <Text font={10.5} fontWeight="bold" foregroundStyle="secondaryLabel">
                可用账户余额
              </Text>
              <Text
                font={8}
                fontWeight="bold"
                foregroundStyle="systemGreen"
                padding={{ horizontal: 4.5, vertical: 1 }}
                background={<Capsule fill="quaternarySystemFill" />}
              >
                充足
              </Text>
            </HStack>

            <Text
              font={34}
              fontWeight="heavy"
              monospaced={true}
              foregroundStyle="label"
              lineLimit={1}
            >
              {formatCurrencyAmount(account.wallet?.total ?? 0, account.wallet?.currency)}
            </Text>

            {account.wallet?.toppedUp !== undefined || account.wallet?.granted !== undefined ? (
              <Text font={8} foregroundStyle="secondaryLabel" lineLimit={1}>
                {`${account.wallet?.toppedUp !== undefined ? `充值 ¥${account.wallet.toppedUp.toFixed(0)} ` : ""}${account.wallet?.granted !== undefined ? `· 赠金 ¥${account.wallet.granted.toFixed(0)}` : ""}`.trim()}
              </Text>
            ) : (
              <Text font={8} foregroundStyle="secondaryLabel">
                实时直连结算 · 预付费账户
              </Text>
            )}
          </VStack>
        ) : quotaCount === 1 ? (
          /* 单进度数据供应商（如 WorkBuddy）：84pt 超大号仪表环居中，数字醒目，占满卡片核心 */
          <VStack alignment="center" spacing={3} frame={{ maxWidth: "infinity" }}>
            <CircularQuotaRing
              item={account.quotas[0]}
              size={82}
              strokeWidth={8}
              showLabel={true}
              valueFont={24}
              labelFont={9.5}
            />
          </VStack>
        ) : quotaCount <= 3 ? (
          /* 2-3 个进度指标（如 Codex 5h+周额度+Credits，或 WorkBuddy 同供应商合并双账号）：饱满加粗进度条，铺满小组件全宽 */
          <VStack alignment="leading" spacing={quotaCount <= 2 ? 5 : 3.5} frame={{ maxWidth: "infinity" }}>
            {account.quotas.map((q) => (
              <QuotaProgressBar
                key={q.id}
                item={q}
                inline={false}
                compact={true}
                showCountdown={true}
                barHeight={quotaCount <= 2 ? 8.5 : 7}
                titleFont={quotaCount <= 2 ? 11 : 9.5}
                valueFont={quotaCount <= 2 ? 11 : 9.5}
              />
            ))}
          </VStack>
        ) : (
          /* 多数据供应商（如 Antigravity 5 窗口）：标题在上方、进度条在下方铺满全宽 */
          <VStack
            alignment="leading"
            spacing={quotaCount >= 5 ? 2 : 3}
            frame={{ maxWidth: "infinity" }}
          >
            <MultiQuotaAdaptiveList
              quotas={account.quotas}
              compact={true}
              forceInline={false}
              showCountdown={true}
              barHeight={quotaCount >= 5 ? 4 : 5.5}
            />
          </VStack>
        )}

        <Spacer />

        {/* 底部信息栏：Codex 重置预测与小组件刷新时间 */}
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          {hasCodexForecast ? (
            <CodexForecastPill
              forecast={account.codexResetForecast}
              compact={true}
            />
          ) : null}
          <Spacer />
          {lastUpdatedAt ? (
            <Text font={7.5} foregroundStyle="tertiaryLabel">
              {`更新于 ${lastUpdatedAt}`}
            </Text>
          ) : null}
        </HStack>
      </VStack>
    </ZStack>
  )
}
