import { Button, Text, VStack } from "scripting"
import { buildPatternPreviewStyledText } from "../utils/pattern_highlight"

export function PatternHighlightPreview(props: { pattern: string; onPress?: () => void | Promise<void> }) {
  const value = String(props.pattern ?? "")
  const hasValue = value.length > 0

  return (
    <Button
      buttonStyle="plain"
      action={() => {
        void props.onPress?.()
      }}
    >
      <VStack
        frame={{ maxWidth: "infinity", minHeight: 62, alignment: "topLeading" as any }}
        padding
        background={{
          style: "secondarySystemBackground",
          shape: { type: "rect", cornerRadius: 8 },
        }}
      >
        {hasValue ? (
          <Text
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            multilineTextAlignment="leading"
            styledText={buildPatternPreviewStyledText(value)}
          />
        ) : (
          <Text
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            multilineTextAlignment="leading"
            foregroundStyle="secondaryLabel"
          >
            点击编辑正则表达式
          </Text>
        )}
      </VStack>
    </Button>
  )
}
