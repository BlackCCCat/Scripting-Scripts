import { ProgressView } from "scripting"
import { dashboardQuotaColor, useDashboardMetricAnimation } from "../utils/dashboard_metric_animation"
import { remainingQuotaColor } from "../utils/theme"

export function DashboardQuotaProgress(props: {
  fraction: number
  remainingPercent?: number | null
  isExhausted?: boolean
}) {
  const { fraction, remainingPercent = fraction * 100, isExhausted } = props
  const metrics = useDashboardMetricAnimation({ fraction }, "progress")
  const displayed = metrics.value("fraction")
  const tint = displayed === fraction
    ? remainingQuotaColor(remainingPercent, isExhausted)
    : dashboardQuotaColor(displayed * 100, fraction * 100)

  return (
    <ProgressView
      {...metrics.lifecycle}
      value={displayed}
      total={1}
      progressViewStyle="linear"
      tint={tint}
      animation={metrics.animate("fraction")}
    />
  )
}
