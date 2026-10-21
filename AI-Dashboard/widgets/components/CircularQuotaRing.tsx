import {
  Circle,
  HStack,
  Text,
  VStack,
  ZStack,
} from "scripting"
import type { WidgetQuotaItem } from "../types"
import { remainingQuotaColor } from "../../utils/theme"

export function CircularQuotaRing(props: {
  item: WidgetQuotaItem
  size?: number
  strokeWidth?: number
  showLabel?: boolean
  labelFont?: number
  valueFont?: number
}) {
  const {
    item,
    size = 30,
    strokeWidth = 2.8,
    showLabel = true,
    labelFont: customLabelFont,
    valueFont: customValueFont,
  } = props
  // 联动主脚本：计算剩余比例与过渡色彩
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
  const fraction = isExhausted ? 0 : Math.min(1, Math.max(0, remPct / 100))
  const ringColor = remainingQuotaColor(remPct, isExhausted)

  const valFont = customValueFont ?? (size >= 48 ? 15 : size >= 32 ? 9.5 : 7.5)
  const lblFont = customLabelFont ?? (size >= 48 ? 10 : size <= 26 ? 6.8 : 7.5)
  const lblHeight = size >= 48 ? 22 : 18

  // 纯余额/积分类型：使用微型胶囊标识
  const isBalance =
    item.isBalanceOnly ||
    item.unit === "Credits" ||
    (item.period === undefined && !item.totalCount && item.remainingCount !== undefined)

  if (isBalance) {
    const bal =
      item.balanceText || `${item.remainingCount ?? 0} ${item.unit || ""}`.trim()
    return (
      <VStack alignment="center" spacing={2} frame={{ minWidth: size + 10 }}>
        <HStack
          alignment="center"
          padding={{ horizontal: 5, vertical: 3 }}
          background={<Circle fill="quaternarySystemFill" />}
        >
          <Text font={size >= 48 ? 12 : 8} fontWeight="bold" foregroundStyle="systemGreen" monospaced={true}>
            {bal}
          </Text>
        </HStack>
        {showLabel ? (
          <Text
            font={lblFont}
            fontWeight="semibold"
            foregroundStyle="label"
            multilineTextAlignment="center"
            lineLimit={2}
            frame={{ width: size + 16, height: lblHeight }}
          >
            {item.name}
          </Text>
        ) : null}
      </VStack>
    )
  }

  return (
    <VStack alignment="center" spacing={2} frame={{ minWidth: size + 6 }}>
      <ZStack frame={{ width: size, height: size }}>
        {/* 背景底槽环 */}
        <Circle
          stroke={{
            shapeStyle: "quaternarySystemFill",
            strokeStyle: { lineWidth: strokeWidth },
          }}
          frame={{ width: size, height: size }}
        />

        {/* 动态剩余前景环 (-90 度正上方顺时针绘制剩余量) */}
        {fraction > 0 ? (
          <Circle
            trim={{ from: 0, to: fraction }}
            stroke={{
              shapeStyle: ringColor,
              strokeStyle: { lineWidth: strokeWidth, lineCap: "round" },
            }}
            rotationEffect={-90}
            frame={{ width: size, height: size }}
          />
        ) : null}

        {/* 中心剩余数值与积分情况 */}
        {size >= 48 ? (
          <VStack alignment="center" spacing={1}>
            <Text
              font={valFont}
              fontWeight="heavy"
              foregroundStyle={ringColor}
              monospaced={true}
              lineLimit={1}
            >
              {isExhausted ? "0%" : `${Math.round(remPct)}%`}
            </Text>
            {item.remainingCount !== undefined &&
            item.unit !== "%" &&
            !(item.totalCount === 100 && (item.unit === "%" || !item.unit)) ? (
              <Text
                font={Math.max(8.5, valFont * 0.38)}
                fontWeight="bold"
                foregroundStyle="secondaryLabel"
                monospaced={true}
                lineLimit={1}
              >
                {item.totalCount !== undefined
                  ? `${item.remainingCount}/${item.totalCount}`
                  : `${item.remainingCount} ${item.unit || "积分"}`.trim()}
              </Text>
            ) : null}
          </VStack>
        ) : (
          <Text
            font={valFont}
            fontWeight="heavy"
            foregroundStyle={ringColor}
            monospaced={true}
            lineLimit={1}
          >
            {isExhausted ? "0" : `${Math.round(remPct)}`}
          </Text>
        )}
      </ZStack>

      {/* 环形图下方的子模型名称：允许两行折行居中展示，彻底杜绝省略号截断 */}
      {showLabel ? (
        <Text
          font={lblFont}
          fontWeight="semibold"
          foregroundStyle="label"
          multilineTextAlignment="center"
          lineLimit={2}
          frame={{ width: size + (size >= 48 ? 20 : 14), height: lblHeight }}
        >
          {item.name}
        </Text>
      ) : null}
    </VStack>
  )
}
