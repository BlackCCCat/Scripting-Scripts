import { Button, Device, DragGesture, GeometryReader, HStack, ScrollView, Text, useRef, VStack, ZStack } from "scripting"
import type { CaisToken } from "../utils/tokenize"

type TokenHitTarget = {
  token: CaisToken
  x: number
  y: number
  width: number
  height: number
}

type TokenRow = {
  y: number
  tokens: Array<{ token: CaisToken; width: number }>
  targets: TokenHitTarget[]
}

function estimatedTokenWidth(text: string, compact: boolean): number {
  let width = compact ? 28 : 34
  for (const char of Array.from(text)) {
    if (/[\u3400-\u9fff]/.test(char)) {
      width += compact ? 16 : 19
    } else if (/[A-Z0-9]/.test(char)) {
      width += compact ? 10 : 12
    } else if (/[a-z]/.test(char)) {
      width += compact ? 9 : 11
    } else {
      width += compact ? 12 : 14
    }
  }
  return Math.max(compact ? 32 : 40, width)
}

function layoutTokens(tokens: CaisToken[], width: number, compact: boolean) {
  const spacing = 8
  const rowHeight = compact ? 32 : 40
  const maxWidth = Math.max(120, width)
  const maxTokenWidth = Math.max(80, Math.min(maxWidth, compact ? 180 : 240))
  const rows: TokenRow[] = []
  let current: TokenRow = { y: 0, tokens: [], targets: [] }
  let x = 0

  for (const token of tokens) {
    const tokenWidth = Math.min(maxTokenWidth, estimatedTokenWidth(token.text, compact))
    if (current.tokens.length && x + tokenWidth > maxWidth) {
      rows.push(current)
      current = { y: rows.length * (rowHeight + spacing), tokens: [], targets: [] }
      x = 0
    }
    current.tokens.push({ token, width: tokenWidth })
    current.targets.push({ token, x, y: current.y, width: tokenWidth, height: rowHeight })
    x += tokenWidth + spacing
  }
  if (current.tokens.length) rows.push(current)
  return { rows, rowHeight, spacing }
}

function hitToken(targets: TokenHitTarget[], x: number, y: number): CaisToken | null {
  for (const target of targets) {
    if (
      x >= target.x &&
      x <= target.x + target.width &&
      y >= target.y &&
      y <= target.y + target.height
    ) {
      return target.token
    }
  }
  return null
}

function pointNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : -1
}

export function TokenSelectionPanel(props: {
  tokens: CaisToken[]
  selectedIds: string[]
  selectedText: string
  emptyText?: string
  compact?: boolean
  minHeight?: number
  onToggle: (token: CaisToken) => void
}) {
  const suppressTapAfterDragRef = useRef(false)
  const draggedTokenIdsRef = useRef<Set<string>>(new Set())
  const tokenFont = props.compact ? "subheadline" : "body"
  const tokenPadding = props.compact
    ? { top: 6, bottom: 6, leading: 10, trailing: 10 }
    : { top: 8, bottom: 8, leading: 12, trailing: 12 }
  const panelFrame = {
    ...(props.minHeight ? { minHeight: props.minHeight } : {}),
    maxWidth: "infinity" as any,
    maxHeight: "infinity" as any,
    alignment: "topLeading" as any,
  }
  return (
    <ZStack
      alignment="topLeading"
      frame={panelFrame}
      glassEffect={{ type: "rect", cornerRadius: 12 } as any}
      clipShape={{ type: "rect", cornerRadius: 12 } as any}
    >
      <Button
        action={() => {}}
        buttonStyle="glass"
        buttonBorderShape={{ roundedRectangleRadius: 12 }}
        controlSize="mini"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        allowsHitTesting={false}
      >
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
      </Button>
      <VStack
        spacing={10}
        frame={panelFrame}
        padding={12}
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
        <GeometryReader>
          {(proxy) => {
            const fallbackWidth = Math.max(120, Device.screen.width - (props.compact ? 48 : 56))
            const contentWidth = proxy.size.width > 40 ? proxy.size.width : fallbackWidth
            const layout = layoutTokens(props.tokens, contentWidth, Boolean(props.compact))
            const targets = layout.rows.flatMap((row) => row.targets)
            const toggleHitToken = (x: number, y: number) => {
              const token = hitToken(targets, x, y)
              if (!token || draggedTokenIdsRef.current.has(token.id)) return
              suppressTapAfterDragRef.current = true
              draggedTokenIdsRef.current.add(token.id)
              props.onToggle(token)
            }
            const selectGesture = DragGesture({ minDistance: 24, coordinateSpace: "local" })
              .onChanged((gesture) => {
                const dx = Math.abs(Number(gesture.translation?.width ?? 0))
                const dy = Math.abs(Number(gesture.translation?.height ?? 0))
                if (dx <= dy * 1.8) return
                toggleHitToken(pointNumber(gesture.startLocation?.x), pointNumber(gesture.startLocation?.y))
                toggleHitToken(pointNumber(gesture.location?.x), pointNumber(gesture.location?.y))
              })
              .onEnded(() => {
                draggedTokenIdsRef.current.clear()
                ;(globalThis as any).setTimeout?.(() => {
                  suppressTapAfterDragRef.current = false
                }, 120)
              })
            return (
              <ScrollView axes="vertical" scrollIndicator="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                {props.tokens.length ? (
                  <VStack
                    spacing={layout.spacing}
                    frame={{ width: contentWidth, alignment: "topLeading" as any }}
                    simultaneousGesture={selectGesture}
                  >
                    {layout.rows.map((row) => {
                      return (
                        <HStack
                          key={`row-${row.y}`}
                          spacing={layout.spacing}
                          frame={{ width: contentWidth, height: layout.rowHeight, alignment: "leading" as any }}
                        >
                          {row.tokens.map(({ token, width }) => {
                            const selected = props.selectedIds.includes(token.id)
                            const chipFrame = { width, height: layout.rowHeight }
                            return (
                              <ZStack
                                key={token.id}
                                frame={chipFrame}
                                background={selected ? { style: "systemBlue", shape: { type: "rect", cornerRadius: 8 } } : "clear"}
                                glassEffect={{ type: "rect", cornerRadius: 8 } as any}
                                clipShape={{ type: "rect", cornerRadius: 8 } as any}
                              >
                                <Button
                                  buttonStyle="glass"
                                  buttonBorderShape={{ roundedRectangleRadius: 8 }}
                                  controlSize="mini"
                                  frame={chipFrame}
                                  action={() => {
                                    if (suppressTapAfterDragRef.current) return
                                    props.onToggle(token)
                                  }}
                                >
                                  <VStack frame={chipFrame} />
                                </Button>
                                <Text
                                  font={tokenFont as any}
                                  foregroundStyle={selected ? "white" : "label"}
                                  padding={tokenPadding}
                                  allowsTightening
                                  frame={{ width, height: layout.rowHeight, alignment: "center" as any }}
                                  allowsHitTesting={false}
                                >
                                  {token.text}
                                </Text>
                              </ZStack>
                            )
                          })}
                        </HStack>
                      )
                    })}
                  </VStack>
                ) : (
                  <Text foregroundStyle="secondaryLabel">{props.emptyText ?? "没有可用的分词结果"}</Text>
                )}
              </ScrollView>
            )
          }}
        </GeometryReader>
      </VStack>
    </ZStack>
  )
}
