import { Button, HStack, Image, ProgressView, Text, VStack, type VStackProps } from "scripting"
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export const glass = Number.parseInt(Device.systemVersion, 10) >= 26
// List/Form 行内的 glass 按钮在真机上会遮挡后续行的点击，改用普通原生样式。
export const primaryButton = "borderedProminent"

export function Card({ title, symbol, children }: { title: string; symbol: string; children: VStackProps["children"] }) {
  const content = Array.isArray(children) ? children.flat(2) : children
  return <VStack alignment="leading" spacing={12} padding={18} frame={{ maxWidth: "infinity", alignment: "leading" }}
    glassEffect={glass ? { type: "rect", cornerRadius: 18 } : undefined}
    background={glass ? undefined : { style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}>
    <HStack spacing={9}><Image systemName={symbol} foregroundStyle="systemPurple" /><Text font="headline">{title}</Text></HStack>
    {content}
  </VStack>
}

export function Hint({ children }: { children: string }) { return <Text font="footnote" foregroundStyle="secondaryLabel">{children}</Text> }
export function Busy({ text = "正在加载…" }: { text?: string }) { return <HStack spacing={8}><ProgressView /><Hint>{text}</Hint></HStack> }
export function Failure({ error, retry }: { error: string; retry?: () => void }) {
  return <VStack alignment="leading" spacing={8}><Text foregroundStyle="systemRed">{error}</Text>{retry && <Button title="重试" systemImage="arrow.clockwise" action={retry} />}</VStack>
}
export async function alertError(error: unknown) { await Dialog.alert({ message: message(error) }) }
