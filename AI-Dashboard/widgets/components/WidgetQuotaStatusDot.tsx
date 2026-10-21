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
  baseSize?: number
}) {
  const {
    usedPercentage,
    overallStatus,
    statusColor,
    adaptTransparent = false,
    isCompact = false,
    baseSize: customBaseSize,
  } = props

  const baseSize = customBaseSize ?? (isCompact ? 5 : 5.5)
  const isExhausted = overallStatus === "exhausted" || usedPercentage >= 100
  const dotColor: Color = isExhausted ? "systemGray" : statusColor

  // 1. 未开启适配透明模式时：圆点大小始终不变（恒等于 baseSize），仅颜色随额度变化（耗尽时为灰色）
  if (!adaptTransparent) {
    return (
      <ZStack alignment="center" frame={{ width: baseSize, height: baseSize }}>
        <Circle fill={dotColor} frame={{ width: baseSize, height: baseSize }} />
      </ZStack>
    )
  }

  // 2. 开启适配透明模式时：圆点大小随用量改变，且最大圆点（余量充足 61%~100%）与未开启开关时的圆点完全一样大（baseSize）
  // 0% 额度耗尽：空心圆环 (○)，外径与 baseSize 相同，颜色为灰色
  if (isExhausted) {
    return (
      <ZStack alignment="center" frame={{ width: baseSize, height: baseSize }}>
        <Circle
          stroke={{
            shapeStyle: dotColor,
            strokeStyle: { lineWidth: 1.2 },
          }}
          frame={{ width: baseSize, height: baseSize }}
        />
      </ZStack>
    )
  }

  // 1% ~ 15% 额度告急：微型细圆点 (used >= 85%)
  if (usedPercentage >= 85) {
    const dotSize = Math.max(1.8, Math.round(baseSize * 0.35 * 10) / 10)
    return (
      <ZStack alignment="center" frame={{ width: baseSize, height: baseSize }}>
        <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
      </ZStack>
    )
  }

  // 16% ~ 40% 余量偏低：小型圆点 (used >= 60%)
  if (usedPercentage >= 60) {
    const dotSize = Math.max(2.8, Math.round(baseSize * 0.55 * 10) / 10)
    return (
      <ZStack alignment="center" frame={{ width: baseSize, height: baseSize }}>
        <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
      </ZStack>
    )
  }

  // 41% ~ 60% 余量适中：中型圆点 (used >= 40%)
  if (usedPercentage >= 40) {
    const dotSize = Math.max(3.8, Math.round(baseSize * 0.75 * 10) / 10)
    return (
      <ZStack alignment="center" frame={{ width: baseSize, height: baseSize }}>
        <Circle fill={statusColor} frame={{ width: dotSize, height: dotSize }} />
      </ZStack>
    )
  }

  // 61% ~ 100% 余量充足：最大圆点（大小与未开启开关的圆点完全一致，恒等于 baseSize）
  return (
    <ZStack alignment="center" frame={{ width: baseSize, height: baseSize }}>
      <Circle fill={statusColor} frame={{ width: baseSize, height: baseSize }} />
    </ZStack>
  )
}
