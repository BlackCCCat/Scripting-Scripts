// Self-contained README example; compiled by project typecheck.
import { Text, ZStack } from "scripting"
import { MeasuredSource, type MeasuredOrigin } from "./index"
function Source({ open }: { open: (source: MeasuredOrigin) => void }) {
  return <ZStack coordinateSpace="demo">
    <MeasuredSource space="demo" label="打开详情" onActivate={open}>
      <Text padding={16}>查看详情</Text>
    </MeasuredSource>
  </ZStack>
}

export function GlobalSourceExample({ open }: { open: (source: MeasuredOrigin) => void }) {
 return <MeasuredSource onActivate={open}><Text>查看详情</Text></MeasuredSource>
}
