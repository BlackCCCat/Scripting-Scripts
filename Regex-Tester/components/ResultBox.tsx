import { Button, Text, VStack } from "scripting"
import { type RegexOutputLine } from "../utils/regex"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

export function ResultBox(props: {
  text: string
  lines?: RegexOutputLine[]
  placeholder?: string
  onPress: () => void | Promise<void>
}) {
  const content = props.text.trim()
  const lines = props.lines ?? []
  const placeholder = props.placeholder ?? "点击开始匹配"

  return (
    <Button
      action={withHaptic(props.onPress)}
      buttonStyle="plain"
      frame={{ maxWidth: "infinity", minHeight: 220 }}
      background={{
        style: "secondarySystemBackground",
        shape: { type: "rect", cornerRadius: 10 },
      }}
    >
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
        padding
        spacing={8}
      >
        {content ? (
          <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={2}>
            {lines.length ? (
              lines.map((line, idx) => (
                <Text
                  key={`${idx}-${line.text}`}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  multilineTextAlignment="leading"
                  styledText={{
                    content: line.parts.map((part) => {
                      if (part.matched) {
                        return { content: part.text, foregroundColor: "#34C759" }
                      }
                      return { content: part.text }
                    }),
                  }}
                />
              ))
            ) : (
              <Text frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">
                {props.text}
              </Text>
            )}
          </VStack>
        ) : (
          <Text
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            multilineTextAlignment="leading"
            foregroundStyle="secondaryLabel"
          >
            {placeholder}
          </Text>
        )}
      </VStack>
    </Button>
  )
}
