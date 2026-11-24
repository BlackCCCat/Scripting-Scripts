import { RoundedRectangle, Text, useMemo, VStack } from "scripting"
import type { QuotaSnapshot } from "../models/types"
import { useDashboardMetricAnimation } from "../utils/dashboard_metric_animation"
import { localize } from "../utils/localization"
import { formatAmountNumber } from "../utils/quota_formatting"
import { DashboardQuotaProgress } from "./DashboardQuotaProgress"

const labelAmounts = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g

export function MuseAdditionalQuotaCard(props: { tokens: NonNullable<QuotaSnapshot["museAdditionalTokens"]> }) {
  const { value, remainingPercentage } = props.tokens
  const label = localize(value)
  const { targets, precision, percentKey } = useMemo(() => {
    const targets: Record<string, number | undefined> = {}
    const precision: Record<string, number> = {}
    let percentKey: string | undefined
    let index = 0
    for (const match of label.matchAll(labelAmounts)) {
      const key = `label${index++}`
      const digits = match[0]
      const suffix = label.slice(match.index + digits.length)
      targets[key] = Number(digits.replace(/,/g, ""))
      const compact = /^[KMBT]\b/i.test(suffix)
      precision[key] = Math.min(10, Math.max(digits.split(".")[1]?.length ?? 0, compact ? 2 : 0))
      if (/^\s*%/.test(suffix)) percentKey ??= key
    }
    return { targets, precision, percentKey }
  }, [label])
  const metrics = useDashboardMetricAnimation(targets)
  let index = 0
  const text = label.replace(labelAmounts, (original: string) => {
    const key = `label${index++}`
    const target = targets[key]
    const displayed = metrics.value(key)
    if (displayed === target || !Number.isFinite(target)) return original
    return formatAmountNumber(displayed, precision[key])
  })
  const animatedKey = percentKey ?? (targets.label0 === undefined ? undefined : "label0")

  return (
    <VStack
      {...metrics.lifecycle}
      alignment="leading"
      spacing={7}
      padding={12}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={<RoundedRectangle cornerRadius={12} style="continuous" fill="quaternarySystemFill" />}
    >
      <Text font="caption2" fontWeight="semibold" foregroundStyle="accentColor">
        {localize("额外 Tokens")}
      </Text>
      {remainingPercentage !== undefined ? (
        <DashboardQuotaProgress fraction={remainingPercentage / 100} remainingPercent={remainingPercentage} />
      ) : null}
      <Text font="subheadline" fontWeight="medium" foregroundStyle="label" lineLimit={2}
        {...(animatedKey ? metrics.rollingText(animatedKey, text) : {})}
      >
        {text}
      </Text>
    </VStack>
  )
}
