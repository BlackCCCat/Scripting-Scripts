import {
  Circle,
  ZStack,
} from "scripting"
import type { Color } from "scripting"

export function WidgetQuotaStatusDot(props: {
  usedPercentage: number
  overallStatus?: "normal" | "warning" | "exhausted"
  statusColor: Color
  adaptTransparent?: boolean
  isCompact?: boolean
}) {
  const {
    usedPercentage,
    overallStatus,
    statusColor,
    adaptTransparent = false,
    isCompact = false,
  } = props

  const isExhausted = overallStatus === "exhausted" || usedPercentage >= 100

  if (!adaptTransparent) {
    const size = isCompact ? 5 : 5.5
    return (
      <ZStack alignment="center" frame={{ width: 8, height: 8 }}>
        <Circle fill={statusColor} frame={{ width: size, height: size }} />
      </ZStack>
    )
  }

  // 适配透明模式：用圆点大小来替代颜色变化
  // 1. 0% 额度耗尽：空心环 (○)
  if (isExhausted) {
    const ringSize = isCompact ? 5.5 : 6
    return (
      <ZStack alignment="center" frame={{ width: 8, height: 8 }}>
        <Circle
          stroke={{
            shapeStyle: statusColor,
            strokeStyle: { lineWidth: 1.3 },
          }}
          frame={{ width: ringSize, height: ringSize }}
        />
      </ZStack>
    )
  }

  // 2. 1% ~ 15% 额度告急：微型小点 (used >= 85%)
  if (usedPercentage >= 85) {
    const dotSize = isCompact ? 2.2 : 2.5
    return (
      <ZStack alignment="center" frame={{ width: 8, height: 8 }}>
        <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
      </ZStack>
    )
  }

  // 3. 16% ~ 40% 余量偏低：小圆点 (used >= 60%)
  if (usedPercentage >= 60) {
    const dotSize = isCompact ? 3.6 : 4.0
    return (
      <ZStack alignment="center" frame={{ width: 8, height: 8 }}>
        <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
      </ZStack>
    )
  }

  // 4. 41% ~ 60% 余量适中：中圆点 (used >= 40%)
  if (usedPercentage >= 40) {
    const dotSize = isCompact ? 5.2 : 5.8
    return (
      <ZStack alignment="center" frame={{ width: 8, height: 8 }}>
        <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
      </ZStack>
    )
  }

  // 5. 61% ~ 100% 余量充足：饱满大圆点 (used < 40%)
  const dotSize = isCompact ? 7.0 : 7.6
  return (
    <ZStack alignment="center" frame={{ width: 8, height: 8 }}>
      <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
    </ZStack>
  )
}
