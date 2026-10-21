import {
  Capsule,
  GeometryReader,
  HStack,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import type { WidgetQuotaItem } from "../types"
import { formatWidgetCountdown, getProgressBarTrackColor } from "../utils"
import { remainingQuotaColor } from "../../utils/theme"

export function QuotaProgressBar(props: {
  item: WidgetQuotaItem
  compact?: boolean
  inline?: boolean
  barHeight?: number
  hideLabel?: boolean
  showCountdown?: boolean
  titleFont?: number
  valueFont?: number
}) {
  const {
    item,
    compact = false,
    inline = false,
    barHeight: customBarHeight,
    hideLabel = false,
    showCountdown = true,
    titleFont: customTitleFont,
    valueFont: customValueFont,
  } = props

  // 联动主脚本：计算剩余额度比例与颜色
  let remPct = Math.min(100, Math.max(0, item.remainingPercentage))
  if (
    item.totalCount !== undefined &&
    item.remainingCount !== undefined &&
    item.remainingCount < item.totalCount &&
    remPct >= 99.5
  ) {
    remPct = 99
  }
  if (item.remainingCount !== undefined && item.remainingCount > 0 && remPct <= 0.5) {
    remPct = 1
  }
  const isExhausted = item.isExhausted || remPct <= 0
  const barColor = remainingQuotaColor(remPct, isExhausted)

  // 各额度刷新时间（直接显示在标题后面）
  const countdownText =
    showCountdown && (item.resetCountdownText || (item.resetsAt ? formatWidgetCountdown(item.resetsAt) : null))

  // 进度条高度可配置，默认更粗更饱满
  const barHeight = customBarHeight ?? (inline ? (compact ? 5 : 7) : compact ? 6.5 : 10)

  // 标题与数值字号统一解析
  const titleFontSize = customTitleFont ?? (compact ? 9.5 : 12)
  const valueFontSize = customValueFont ?? (compact ? 9.5 : 12)
  const countdownFontSize = customTitleFont ? Math.max(7.5, customTitleFont - 3) : (compact ? 7.5 : 9)

  // 提取剩余积分/配额/次数数值展示（过滤掉纯百分比类型或以 100 为总量的伪计数，防止出现多余的 100/100）
  const hasCount =
    item.remainingCount !== undefined &&
    item.unit !== "%" &&
    !(item.totalCount === 100 && (item.unit === "%" || !item.unit))

  const countStr = hasCount
    ? item.totalCount !== undefined
      ? `${item.remainingCount}/${item.totalCount}${compact ? "" : ` ${item.unit || "积分"}`}`
      : `${item.remainingCount} ${item.unit || "积分"}`.trim()
    : null

  // 纯余额/积分类型（例如 Codex Credits 余额、Token 钱包）：直接展示数值，不渲染伪进度条
  const isBalance =
    item.isBalanceOnly ||
    item.unit === "Credits" ||
    (item.period === undefined && !item.totalCount && item.remainingCount !== undefined)

  if (isBalance) {
    const balText =
      item.balanceText || `${item.remainingCount ?? 0} ${item.unit || ""}`.trim()

    if (inline) {
      return (
        <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity", height: barHeight + 6 }}>
          {!hideLabel ? (
            <Text
              font={titleFontSize}
              fontWeight="bold"
              foregroundStyle="label"
              lineLimit={1}
            >
              {item.name}
            </Text>
          ) : null}
          <Spacer />
          <Text
            font={valueFontSize}
            fontWeight="heavy"
            foregroundStyle="systemGreen"
            monospaced={true}
            lineLimit={1}
          >
            {balText}
          </Text>
        </HStack>
      )
    }

    return (
      <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
        {!hideLabel ? (
          <Text
            font={titleFontSize}
            fontWeight="bold"
            foregroundStyle="label"
            lineLimit={1}
          >
            {item.name}
          </Text>
        ) : null}
        <Spacer />
        <Text
          font={valueFontSize}
          fontWeight="heavy"
          foregroundStyle="systemGreen"
          monospaced={true}
          lineLimit={1}
        >
          {balText}
        </Text>
      </HStack>
    )
  }

  // 单行排版：[模型名称(可选)] [==== 剩余进度条 ====] [剩余百分比]
  if (inline) {
    return (
      <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity", height: barHeight + 8 }}>
        {!hideLabel ? (
          <Text
            font={titleFontSize}
            fontWeight="bold"
            foregroundStyle="label"
            lineLimit={1}
            frame={{ width: 68, alignment: "leading" }}
          >
            {item.name}
          </Text>
        ) : null}

        <GeometryReader frame={{ height: barHeight }}>
          {(proxy) => {
            const totalWidth = proxy.size.width || 60
            const fillWidth = isExhausted
              ? 0
              : Math.max(barHeight, Math.min(totalWidth, (totalWidth * remPct) / 100))

            return (
              <ZStack
                alignment="leading"
                frame={{ width: totalWidth, height: barHeight }}
              >
                <Capsule
                  fill={getProgressBarTrackColor()}
                  frame={{ width: totalWidth, height: barHeight }}
                />
                {fillWidth > 0 ? (
                  <Capsule
                    fill={barColor}
                    frame={{ width: fillWidth, height: barHeight }}
                  />
                ) : null}
              </ZStack>
            )
          }}
        </GeometryReader>

        <HStack alignment="center" spacing={3} frame={{ width: countStr ? 78 : 44, alignment: "trailing" }}>
          {countStr ? (
            <Text
              font={Math.max(7.5, valueFontSize * 0.85)}
              fontWeight="bold"
              foregroundStyle="secondaryLabel"
              monospaced={true}
              lineLimit={1}
            >
              {item.remainingCount ?? ""}
            </Text>
          ) : null}
          <Text
            font={valueFontSize}
            fontWeight="heavy"
            foregroundStyle={barColor}
            monospaced={true}
            lineLimit={1}
          >
            {isExhausted ? "0%" : `${Math.round(remPct)}%`}
          </Text>
        </HStack>
      </HStack>
    )
  }

  // 双行标准排版：上方名称+刷新时间与剩余数值，下方加粗剩余进度条（铺满卡片全宽）

  return (
    <VStack alignment="leading" spacing={compact ? 2 : 4} frame={{ maxWidth: "infinity" }}>
      <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
        {!hideLabel ? (
          <HStack alignment="center" spacing={4}>
            <Text
              font={titleFontSize}
              fontWeight="bold"
              foregroundStyle="label"
              lineLimit={1}
            >
              {item.name}
            </Text>
            {countdownText ? (
              <Text
                font={countdownFontSize}
                fontWeight="medium"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
              >
                {`⏱️ ${countdownText}`}
              </Text>
            ) : null}
          </HStack>
        ) : null}
        <Spacer />
        <HStack alignment="center" spacing={4}>
          {countStr ? (
            <Text
              font={compact ? Math.max(8, valueFontSize * 0.88) : Math.max(9.5, valueFontSize * 0.88)}
              fontWeight="bold"
              foregroundStyle="secondaryLabel"
              monospaced={true}
              lineLimit={1}
            >
              {countStr}
            </Text>
          ) : null}
          <Text
            font={valueFontSize}
            fontWeight="heavy"
            foregroundStyle={barColor}
            monospaced={true}
            lineLimit={1}
          >
            {isExhausted
              ? "0%"
              : countStr
                ? compact
                  ? `${Math.round(remPct)}%`
                  : `(${Math.round(remPct)}%)`
                : compact
                  ? `${Math.round(remPct)}%`
                  : `剩余 ${Math.round(remPct)}%`}
          </Text>
        </HStack>
      </HStack>

      <GeometryReader frame={{ height: barHeight }}>
        {(proxy) => {
          const totalWidth = proxy.size.width || 100
          const fillWidth = isExhausted
            ? 0
            : Math.max(barHeight, Math.min(totalWidth, (totalWidth * remPct) / 100))

          return (
            <ZStack
              alignment="leading"
              frame={{ width: totalWidth, height: barHeight }}
            >
              <Capsule
                fill={getProgressBarTrackColor()}
                frame={{ width: totalWidth, height: barHeight }}
              />
              {fillWidth > 0 ? (
                <Capsule
                  fill={barColor}
                  frame={{ width: fillWidth, height: barHeight }}
                />
              ) : null}
            </ZStack>
          )
        }}
      </GeometryReader>
    </VStack>
  )
}
