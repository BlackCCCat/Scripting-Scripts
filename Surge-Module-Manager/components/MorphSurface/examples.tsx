// Self-contained README example; compiled by project typecheck.
import { Button, GeometryReader, ZStack, Text, useRef, useState } from "scripting"
import { MorphCard, MorphSurface } from "./index"

// Common usage: no open state, coordinates, close binding or source hiding in the caller.
export function SimpleExample() {
  return <MorphCard source={<Text>查看详情</Text>} label="查看详情"
    content={close => <Button title="关闭" action={close} />} />
}

export function Example() {
  const [open, setOpen] = useState(false)
  const close = useRef<() => void>(() => {})
  const surface = { fill: "#FAF7F0" as const, border: "#D4CBBE" as const,
    shadow: { color: "#00000020" as const, radius: 18, y: 6 } }
  return <GeometryReader>{g => {
    // 全部矩形在这个 GeometryReader 的局部坐标中。
    const frame = { x: 24, y: 60, width: 160, height: 52 }
    return <ZStack alignment="topLeading" frame={g.size}>
      <Button title="打开" action={() => setOpen(true)} opacity={open ? 0 : 1}
        disabled={open} frame={{ width: frame.width, height: frame.height }}
        offset={{ x: frame.x, y: frame.y }} />
      {open ? <MorphSurface origin={{ frame, current: () => frame, radius: 26 }}
        target={{ frame: { x: 16, y: 140, width: Math.max(0, g.size.width - 32), height: 220 }, surface }}
        viewport={{ ...g.size, x: 0, y: 0 }} preview={<Text>打开</Text>}
        bindClose={action => { close.current = action }} onClosed={() => setOpen(false)}>
        <Button title="关闭" action={() => close.current()} />
      </MorphSurface> : null}
    </ZStack>
  }}</GeometryReader>
}
