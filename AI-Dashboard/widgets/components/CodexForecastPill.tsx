import {
  Capsule,
  HStack,
  Image,
  Spacer,
  Text,
} from "scripting"
import type { WidgetAccountData } from "../types"

export function CodexForecastPill(props: {
  forecast?: WidgetAccountData["codexResetForecast"]
  compact?: boolean
}) {
  const { forecast, compact = false } = props
  if (!forecast) return null

  const text =
    forecast.scheduledText || forecast.probabilityText || "Codex 预测就绪"

  return (
    <HStack
      alignment="center"
      spacing={3.5}
      padding={{ horizontal: 5.5, vertical: 2 }}
      background={<Capsule fill="quaternarySystemFill" />}
    >
      <Image
        systemName="sparkles"
        font={compact ? 8 : 9}
        foregroundStyle="systemIndigo"
      />
      <Text
        font={compact ? 8.5 : 9.5}
        fontWeight="bold"
        foregroundStyle="systemIndigo"
        lineLimit={1}
      >
        {text}
      </Text>
    </HStack>
  )
}
