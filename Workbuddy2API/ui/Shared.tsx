import { Button, Circle, HStack, Image, ProgressView, Rectangle, Text, VStack, gradient, type Color, type DynamicShapeStyle, type VStackProps } from "scripting"
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export const glass = Number.parseInt(Device.systemVersion, 10) >= 26
// List/Form 行内的 glass 按钮在真机上会遮挡后续行的点击，改用普通原生样式。
export const primaryButton = "borderedProminent"

export const pageBackground: DynamicShapeStyle = { light: "#F4F3F8", dark: "#121218" }
export const pageMargins = { edges: "vertical", insets: 0, placement: "scrollContent" } as const
export const hideTopSeparator = { visibility: "hidden", edges: "top" } as const
export const panelSurface: DynamicShapeStyle = { light: "secondarySystemGroupedBackground", dark: "#1C1C25" }
export const insetSurface: DynamicShapeStyle = { light: "#EEEBF8", dark: "#282833" }
export const accent: DynamicShapeStyle = { light: "#6446C8", dark: "#A190FA" }
export const heroSurface: DynamicShapeStyle = {
  light: gradient("linear", { colors: ["#E7DFFF", "#FFFFFF"], startPoint: "topTrailing", endPoint: "bottomLeading" }),
  dark: gradient("linear", { colors: ["#453659", "#262434", "#1C1C25"], startPoint: "topTrailing", endPoint: "bottomLeading" }),
}
export const barFill: DynamicShapeStyle = {
  light: gradient("linear", { colors: ["#8C70F2", "#6246CA"], startPoint: "top", endPoint: "bottom" }),
  dark: gradient("linear", { colors: ["#A990FF", "#8060E8"], startPoint: "top", endPoint: "bottom" }),
}

export function PageBackdrop() {
  return <Rectangle fill={pageBackground} ignoresSafeArea={{ regions: "container", edges: "vertical" }} />
}

export function Panel({ children, hero = false }: { children: VStackProps["children"]; hero?: boolean }) {
  return <VStack alignment="leading" spacing={12} padding={16} frame={{ maxWidth: "infinity", alignment: "leading" }}
    background={{ style: hero ? heroSurface : panelSurface, shape: { type: "rect", cornerRadius: 20 } }}>
    {children}
  </VStack>
}

export function Metric({ label, value, compact = false, valueFirst = false }: {
  label: string; value: string; compact?: boolean; valueFirst?: boolean
}) {
  const caption = <Text font="caption" foregroundStyle="secondaryLabel">{label}</Text>
  return <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
    {!valueFirst && caption}
    <Text font={compact ? "title3" : "title2"} fontWeight="semibold" monospacedDigit>{value}</Text>
    {valueFirst && caption}
  </VStack>
}

export function SymbolTile({ symbol }: { symbol: string }) {
  return <Image systemName={symbol} font="body" foregroundStyle={accent} frame={{ width: 36, height: 36 }}
    background={{ style: insetSurface, shape: { type: "rect", cornerRadius: 10 } }} accessibilityHidden />
}

export function StatusDot({ color }: { color: Color | DynamicShapeStyle }) {
  return <Circle fill={color} frame={{ width: 7, height: 7 }} accessibilityHidden />
}

export function Hint({ children }: { children: string }) { return <Text font="footnote" foregroundStyle="secondaryLabel">{children}</Text> }
export function Busy({ text = "正在加载…" }: { text?: string }) { return <HStack spacing={8}><ProgressView /><Hint>{text}</Hint></HStack> }
export function Failure({ error, retry }: { error: string; retry?: () => void }) {
  return <VStack alignment="leading" spacing={8}><Text foregroundStyle="systemRed">{error}</Text>{retry && <Button title="重试" systemImage="arrow.clockwise" action={retry} />}</VStack>
}
export async function alertError(error: unknown) { await Dialog.alert({ message: message(error) }) }
