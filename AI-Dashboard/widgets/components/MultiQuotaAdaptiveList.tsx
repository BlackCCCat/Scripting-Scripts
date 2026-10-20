import { Text, VStack } from "scripting"
import type { WidgetQuotaItem } from "../types"
import { QuotaProgressBar } from "./QuotaProgressBar"

export function MultiQuotaAdaptiveList(props: {
  quotas: WidgetQuotaItem[]
  compact?: boolean
  forceInline?: boolean
  barHeight?: number
  showCountdown?: boolean
  titleFont?: number
  valueFont?: number
}) {
  const {
    quotas,
    compact = false,
    forceInline,
    barHeight,
    showCountdown = true,
    titleFont,
    valueFont,
  } = props

  if (!quotas || quotas.length === 0) {
    return (
      <VStack alignment="leading" spacing={2}>
        <Text font={10} foregroundStyle="secondaryLabel">
          暂无配额数据
        </Text>
      </VStack>
    )
  }

  // 默认采用标题在进度条上方、进度条铺满全宽的标准排版；仅当显式指定 forceInline 时启用单行
  const shouldUseInline = forceInline === true

  return (
    <VStack
      alignment="leading"
      spacing={shouldUseInline ? 3 : compact ? 3.5 : 5}
      frame={{ maxWidth: "infinity" }}
    >
      {quotas.map((q) => (
        <QuotaProgressBar
          key={q.id}
          item={q}
          compact={compact || shouldUseInline}
          inline={shouldUseInline}
          barHeight={barHeight}
          showCountdown={showCountdown}
          titleFont={titleFont}
          valueFont={valueFont}
        />
      ))}
    </VStack>
  )
}
