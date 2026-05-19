import { Button, FlowLayout, ScrollView, Text, useColorScheme, VStack } from "scripting"
import type { CaisToken } from "../utils/tokenize"

export function TokenSelectionPanel(props: {
  tokens: CaisToken[]
  selectedIds: string[]
  selectedText: string
  emptyText?: string
  compact?: boolean
  onToggle: (token: CaisToken) => void
  onSelect: (token: CaisToken) => void
}) {
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"
  const tokenFont = props.compact ? "subheadline" : "body"
  const tokenPadding = props.compact
    ? { top: 6, bottom: 6, leading: 10, trailing: 10 }
    : { top: 8, bottom: 8, leading: 12, trailing: 12 }
  return (
    <VStack
      spacing={10}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
      padding={12}
      background={{ style: cardFill, shape: { type: "rect", cornerRadius: 12 } }}
    >
      <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text font="caption" foregroundStyle="secondaryLabel">已选择</Text>
        <Text
          font="subheadline"
          lineLimit={3}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
        >
          {props.selectedText || "点击分词结果进行选择"}
        </Text>
      </VStack>
      <ScrollView axes="vertical" scrollIndicator="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {props.tokens.length ? (
          <FlowLayout spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {props.tokens.map((token) => {
              const selected = props.selectedIds.includes(token.id)
              return (
                <Button
                  key={token.id}
                  buttonStyle="plain"
                  action={() => props.onToggle(token)}
                  onDragGesture={{
                    minDistance: 0,
                    onChanged: () => props.onSelect(token),
                  }}
                >
                  <Text
                    font={tokenFont as any}
                    foregroundStyle={selected ? "white" : "label"}
                    padding={tokenPadding}
                    background={{
                      style: selected ? "systemBlue" : "tertiarySystemFill",
                      shape: { type: "rect", cornerRadius: 8 },
                    }}
                  >
                    {token.text}
                  </Text>
                </Button>
              )
            })}
          </FlowLayout>
        ) : (
          <Text foregroundStyle="secondaryLabel">{props.emptyText ?? "没有可用的分词结果"}</Text>
        )}
      </ScrollView>
    </VStack>
  )
}
