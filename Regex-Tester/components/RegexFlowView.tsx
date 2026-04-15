import { NavigationStack, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { buildPatternPreviewStyledText } from "../utils/pattern_highlight"
import { buildFlowTree, type FlowNode } from "../utils/flow"
import { RegexFlowSection } from "./RegexFlowSection"

export function RegexFlowView(props: { pattern: string; onDismissHint?: () => void | Promise<void> }) {
  const pattern = String(props.pattern ?? "")
  const trimmedPattern = pattern.trim()
  const [tree, setTree] = useState<FlowNode[] | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(trimmedPattern))
  const dismissNotifiedRef = useRef(false)

  useEffect(() => {
    if (!trimmedPattern) {
      setTree([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setTree(null)

    let cancelled = false
    const timer = setTimeout(() => {
      const nextTree = buildFlowTree(pattern)
      if (cancelled) return
      setTree(nextTree)
      setIsLoading(false)
    }, 16)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pattern, trimmedPattern])

  return (
    <NavigationStack>
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
        onDisappear={() => {
          if (dismissNotifiedRef.current) return
          dismissNotifiedRef.current = true
          void props.onDismissHint?.()
        }}
      >
        <VStack
          navigationTitle="流程图"
          navigationBarTitleDisplayMode="inline"
          spacing={0}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
        >
          <VStack
            spacing={8}
            padding={{ top: 16, bottom: 12, leading: 16, trailing: 16 }}
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
          >
            <Text font="headline">正则表达式</Text>
            <ScrollView axes="horizontal" frame={{ maxWidth: "infinity" }}>
              <VStack
                padding={14}
                frame={{ alignment: "topLeading" as any }}
                background={{
                  style: "secondarySystemBackground",
                  shape: { type: "rect", cornerRadius: 16 },
                }}
              >
                {trimmedPattern ? (
                  <Text
                    multilineTextAlignment="leading"
                    styledText={buildPatternPreviewStyledText(pattern)}
                  />
                ) : (
                  <Text foregroundStyle="secondaryLabel">暂无正则表达式</Text>
                )}
              </VStack>
            </ScrollView>
          </VStack>

          <ScrollView axes="vertical" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <VStack
              spacing={12}
              padding={{ top: 4, bottom: 20, leading: 16, trailing: 16 }}
              frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            >
              <Text font="headline">流程图</Text>
              {isLoading ? (
                <VStack
                  spacing={12}
                  padding={20}
                  frame={{ maxWidth: "infinity", minHeight: 260, alignment: "center" as any }}
                  background={{
                    style: "secondarySystemBackground",
                    shape: { type: "rect", cornerRadius: 22 },
                  }}
                >
                  <ProgressView progressViewStyle="circular" />
                  <Text foregroundStyle="secondaryLabel">正在生成流程图...</Text>
                </VStack>
              ) : (
                <RegexFlowSection tree={tree ?? []} />
              )}
            </VStack>
          </ScrollView>
        </VStack>
      </ZStack>
    </NavigationStack>
  )
}
