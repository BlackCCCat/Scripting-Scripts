import { Button, GeometryReader, Rectangle, VStack, useRef } from "scripting"
import type { Rect, VirtualNode } from "scripting"
import { useStableAction } from "../../hooks/useStableAction"

export type MeasuredOrigin = { frame: Rect; current: () => Rect }
// 相对父工作区测量；只保留最新坐标快照，不按滚动距离手算起点。
export type MeasuredSourceProps = {
  children: VirtualNode; space?: string; label?: string
  onActivate: (origin: MeasuredOrigin) => void
  hidden?: boolean; disabled?: boolean; accessibilityValue?: string; onFrame?: (frame: Rect) => void
}
export const MeasuredSource = ({ children, space, hidden = false, label = "打开详情", onActivate,
  disabled = false, accessibilityValue, onFrame }: MeasuredSourceProps): VirtualNode => {
  const latest = useRef<{ space: string | undefined; frame: Rect } | null>(null)
  const epoch = useRef({ space })
  if (epoch.current.space !== space) { epoch.current = { space }; latest.current = null }
  const identity = epoch.current
  const activate = useStableAction((): void => {
    if (hidden || disabled) return
    const measurement = latest.current
    if (!measurement || measurement.space !== space) return
    const frame = measurement.frame
    onActivate({ frame, current: () => { const value = latest.current; return epoch.current === identity && value && value.space === space ? value.frame : frame } })
  })
  return <VStack spacing={0} transition={Transition.opacity()} background={<GeometryReader coordinateSpaces={[space === undefined ? "global" : { named: space }]}>{geometry => {
    if (epoch.current !== identity) return <Rectangle fill="clear" allowsHitTesting={false} />
    const frame = geometry.frame(space === undefined ? "global" : { named: space })
    if ([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0) {
      latest.current = { space, frame }; onFrame?.(frame)
    } else latest.current = null
    return <Rectangle fill="clear" allowsHitTesting={false} />
  }}</GeometryReader>}>
    <Button buttonStyle="plain" accessibilityLabel={label} accessibilityHidden={hidden} allowsHitTesting={!hidden} disabled={disabled}
      accessibilityValue={accessibilityValue} action={activate}>
      <VStack spacing={0} opacity={hidden ? 0 : 1} contentShape="rect">{children}</VStack>
    </Button>
  </VStack>
}
