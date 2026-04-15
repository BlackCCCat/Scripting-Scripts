import { Text, VStack } from "scripting"
import type { RegexItem } from "../utils/library"

function oneLine(text: string, max = 68) {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!compact) return "(空)"
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

export function RegexListRow(props: { item: RegexItem }) {
  return (
    <VStack
      spacing={4}
      padding={{ top: 8, bottom: 8 }}
      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
    >
      <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {props.item.name || "Untitled"}
      </Text>
      <Text
        font="subheadline"
        foregroundStyle="secondaryLabel"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        lineLimit={2}
      >
        {oneLine(props.item.pattern, 120)}
      </Text>
    </VStack>
  )
}
