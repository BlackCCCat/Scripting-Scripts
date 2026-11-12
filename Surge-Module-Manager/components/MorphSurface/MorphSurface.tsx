import { ZStack, VStack, RoundedRectangle, Rectangle, useEffect, useRef, useState } from "scripting"
import type { Color, CommonViewProps, Rect, VirtualNode } from "scripting"
import { scheduleUI } from "../../hooks/scheduleUI"
import { useStableAction } from "../../hooks/useStableAction"
import { surfaceMorphAnimation } from "./animation"

export type MorphSurfaceStyle = { fill: Color; border: Color; shadow: { color: Color; radius: number; y: number }; glass?: boolean; content?: VirtualNode }
export type MorphOrigin = { frame: Rect; current: () => Rect; radius?: number; surface?: MorphSurfaceStyle }
export type MorphTarget = { frame: Rect; radius?: number; surface: MorphSurfaceStyle }
export type MorphSurfaceProps = {
  origin: MorphOrigin; target: MorphTarget; viewport: Rect; children: VirtualNode
  preview: VirtualNode | ((returning: boolean, frame: Rect) => VirtualNode)
  onClosed: () => void; bindClose: (close: () => void) => void
  onChange?: (expanded: boolean) => void; onReopen?: () => void
  motion?: () => Animation; reversible?: boolean; start?: "effect" | "appear"
  modal?: boolean; fadeHost?: boolean; closingOpacity?: number
  rotation3DEffect?: CommonViewProps["rotation3DEffect"]
}
// Native interpolation owns per-frame work. Only this surface owns open/return state.
export const MorphSurface = ({ origin, target: destination, viewport, children, preview: summary,
  onClosed, bindClose, onChange: onExpandedChange, onReopen, motion: animation = surfaceMorphAnimation,
  reversible: reopenOnReturn = true, start = "effect", modal = false, fadeHost = false, closingOpacity = 1, rotation3DEffect }: MorphSurfaceProps): VirtualNode => {
  const source = origin.frame, getSource = origin.current, target = destination.frame
  const sourceRadius = origin.radius ?? 24, targetRadius = destination.radius ?? 28
  const targetStyle = destination.surface, sourceStyle = origin.surface ?? targetStyle
  const targetSurface = targetStyle.content, topOffset = viewport.y, leftOffset = viewport.x
  // 阶段与完整返回矩形是同一个几何快照，一次提交位置、尺寸和内容交接。
  const [{ expanded, returnFrame }, setPose] = useState({ expanded: false, returnFrame: source })
  const phase = useRef<"opening" | "open" | "closing">("opening"), alive = useRef(true)
  const generation = useRef(0)
  const started = useRef(false), openingTask = useRef<ReturnType<typeof setTimeout> | undefined>()
  const close = (): void => {
    if (!alive.current || phase.current === "closing") return
    phase.current = "closing"
    const ticket = ++generation.current
    clearTimeout(openingTask.current)
    void withAnimation(animation(), "removed", () => { setPose({ expanded: false, returnFrame: getSource() }); onExpandedChange?.(false) }).then(() => Thread.runInMain(() => {
      if (alive.current && ticket === generation.current && phase.current === "closing") onClosed()
    }))
  }
  bindClose(close)
  const expand = (ticket: number): void => {
    if (!alive.current || ticket !== generation.current || phase.current !== "opening") return
    void withAnimation(animation(), "removed", () => { setPose(previous => ({ ...previous, expanded: true })); onExpandedChange?.(true) }).then(() => {
      if (alive.current && ticket === generation.current && phase.current === "opening") phase.current = "open"
    })
  }
  // 手势始终挂载，避免回缩时增删原生 modifier 截断几何动画；阶段只控制动作。
  // 回缩中的纸面接收第一次点击并原地反向，不等卸载交接。
  const reopen = useStableAction((): void => {
    if (!alive.current || !reopenOnReturn || phase.current !== "closing") return
    phase.current = "opening"
    const ticket = ++generation.current
    clearTimeout(openingTask.current)
    onReopen?.()
    openingTask.current = scheduleUI(() => expand(ticket))
  })
  const startOpening = (): void => {
    if (started.current || !alive.current || phase.current !== "opening") return
    started.current = true
    const ticket = ++generation.current
    openingTask.current = setTimeout(() => Thread.runInMain(() => expand(ticket)), 16)
  }
  useEffect(() => {
    alive.current = true
    if (start !== "appear") startOpening()
    return () => { alive.current = false; clearTimeout(openingTask.current) }
  }, [])
  const frame = expanded ? target : returnFrame
  const returning = phase.current === "closing"
  const surfaceOpacity = returning ? closingOpacity : 1
  const paper = <ZStack alignment="topLeading" frame={{ width: frame.width, height: frame.height, alignment: "topLeading" }} transition={Transition.identity()}
      rotation3DEffect={rotation3DEffect}
      contentShape="rect" onTapGesture={reopen}
      clipShape={{ type: "rect", cornerRadius: expanded ? targetRadius : sourceRadius }}
      shadow={{ color: returning && closingOpacity === 0 ? "clear" : (expanded ? targetStyle : sourceStyle).shadow.color, radius: (expanded ? targetStyle : sourceStyle).shadow.radius, y: (expanded ? targetStyle : sourceStyle).shadow.y }} offset={{ x: frame.x, y: frame.y }} zIndex={100}>
      <VStack spacing={0} frame={{ width: frame.width, height: frame.height, alignment: "topLeading" }}
        background={targetSurface ? <ZStack frame={{ width: frame.width, height: frame.height }} allowsHitTesting={false}>
          <Rectangle fill={expanded ? targetStyle.fill : sourceStyle.fill}
            overlay={sourceStyle.glass ? <RoundedRectangle cornerRadius={expanded ? targetRadius : sourceRadius} fill="clear"
              opacity={expanded ? 0 : surfaceOpacity} allowsHitTesting={false}
              glassEffect={{ glass: UIGlass.regular().tint(sourceStyle.fill), shape: { type: "rect", cornerRadius: expanded ? targetRadius : sourceRadius } }} /> : undefined} />
          {/* 背景节点全程常驻，跟随同一纸面尺寸与透明度；切换颜色/视图会生成独立退场快照。 */}
          <VStack spacing={0} frame={{ width: frame.width, height: frame.height }} opacity={expanded ? 1 : 0}>{targetSurface}</VStack>
        </ZStack> : sourceStyle.glass ? <ZStack frame={{ width: frame.width, height: frame.height }} opacity={surfaceOpacity} allowsHitTesting={false}>
          <RoundedRectangle cornerRadius={expanded ? targetRadius : sourceRadius} fill={sourceStyle.fill} />
          <RoundedRectangle cornerRadius={expanded ? targetRadius : sourceRadius} fill="clear"
            glassEffect={{ glass: UIGlass.regular().tint(sourceStyle.fill), shape: { type: "rect", cornerRadius: expanded ? targetRadius : sourceRadius } }} />
          <RoundedRectangle cornerRadius={expanded ? targetRadius : sourceRadius} fill={targetStyle.fill} opacity={expanded ? 1 : 0} />
        </ZStack> : expanded ? targetStyle.fill : sourceStyle.fill}
        overlay={{ alignment: "topLeading", content: <ZStack alignment="topLeading" frame={{ width: frame.width, height: frame.height, alignment: "topLeading" }}>
          <VStack spacing={0} frame={{ width: returnFrame.width, height: returnFrame.height }}
            scaleEffect={{ x: expanded ? 1.025 : 1, y: expanded ? 1.025 : 1, anchor: "topLeading" }}
            opacity={expanded ? 0 : 1} allowsHitTesting={false} accessibilityHidden>
            {typeof summary === "function" ? summary(phase.current === "closing", returnFrame) : summary}
          </VStack>
          <VStack spacing={0} frame={{ width: target.width, height: target.height }}
            scaleEffect={{ x: expanded ? 1 : 0.985, y: expanded ? 1 : 0.985, anchor: "topLeading" }}
            blur={{ radius: expanded ? 0 : 3, opaque: false }}
            opacity={expanded ? 1 : 0} allowsHitTesting={expanded} accessibilityHidden={!expanded}>
            {children}
          </VStack>
        </ZStack> }} />
      <RoundedRectangle cornerRadius={expanded ? targetRadius : sourceRadius} stroke={expanded ? targetStyle.border : sourceStyle.border}
        frame={{ width: frame.width, height: frame.height }} opacity={expanded && targetSurface ? 0 : surfaceOpacity} allowsHitTesting={false} />
    </ZStack>
  return <ZStack transition={fadeHost ? Transition.opacity() : Transition.identity()} alignment="topLeading" frame={{ width: viewport.width, height: viewport.height }} offset={{ x: leftOffset, y: topOffset }} ignoresSafeArea
    zIndex={100} accessibilityAddTraits={modal ? "isModal" : undefined} onAppear={start === "appear" ? startOpening : undefined}>
    {/* 固定局部坐标尺寸，避免纸面缩放时 ZStack 按内容重新居中；不接收输入。 */}
    <Rectangle fill="clear" frame={{ width: viewport.width, height: viewport.height }} allowsHitTesting={false} />
    {/* 外层只负责几何；内容放到内层纸面 overlay，避免固定内容宽度撑住形变。 */}
    {paper}
  </ZStack>
}
