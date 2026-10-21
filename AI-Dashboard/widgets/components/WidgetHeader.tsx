import {
  Capsule,
  HStack,
  Spacer,
  Text,
} from "scripting"
import type { WidgetAccountData } from "../types"
import { getQuotaStatusColor } from "../utils"
import { WidgetQuotaStatusDot } from "./WidgetQuotaStatusDot"

export function WidgetHeader(props: {
  account: WidgetAccountData
  size?: "small" | "medium" | "large"
  showIcon?: boolean
  showCountdown?: boolean
  adaptTransparent?: boolean
}) {
  const { account, size = "small", showCountdown = false, adaptTransparent = false } = props
  const statusColor = account.statusColor ?? getQuotaStatusColor(account.worstUsedPercentage)
  const isCompact = size === "small"

  return (
    <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
      {/* 标题与套餐：已在背景使用大水印展示，顶栏不再重复展示小图标，保证无省略号挤压 */}
      <HStack alignment="center" spacing={5}>
        <Text
          font={isCompact ? 13 : 14}
          fontWeight="bold"
          foregroundStyle="label"
          lineLimit={1}
        >
          {account.displayName}
        </Text>

        {account.planName ? (
          <Text
            font={8}
            fontWeight="bold"
            foregroundStyle="secondaryLabel"
            padding={{ horizontal: 5, vertical: 1 }}
            background={<Capsule fill="quaternarySystemFill" />}
            lineLimit={1}
          >
            {account.planName}
          </Text>
        ) : null}

        {/* 如果有 Codex 重置卡，在头部醒目显示 */}
        {account.codexResetCardsCount !== undefined ? (
          <Text
            font={7.5}
            fontWeight="bold"
            foregroundStyle="systemIndigo"
            padding={{ horizontal: 4, vertical: 1 }}
            background={<Capsule fill="quaternarySystemFill" />}
            lineLimit={1}
          >
            {`🎟️ x${account.codexResetCardsCount}`}
          </Text>
        ) : null}
      </HStack>

      <Spacer />

      {/* 右侧：健康状态圆点与可选倒计时 */}
      <HStack alignment="center" spacing={4}>
        {showCountdown && account.earliestResetCountdown ? (
          <Text font={8} foregroundStyle="secondaryLabel" lineLimit={1}>
            {account.earliestResetCountdown}
          </Text>
        ) : null}
        <WidgetQuotaStatusDot
          usedPercentage={account.worstUsedPercentage}
          overallStatus={account.overallStatus}
          statusColor={statusColor}
          adaptTransparent={adaptTransparent}
          isCompact={isCompact}
          baseSize={isCompact ? 5.5 : 6}
        />
      </HStack>
    </HStack>
  )
}
