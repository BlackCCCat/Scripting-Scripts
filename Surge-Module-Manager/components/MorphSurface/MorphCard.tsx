import { GeometryReader, ZStack, useEffect, useMemo, useState } from "scripting"
import type { Rect, Size, VirtualNode } from "scripting"
import { MeasuredSource, type MeasuredOrigin } from "../MeasuredSource"
import { createMorphSession } from "./presentation"
import { useBusState } from "../../hooks/useBusState"
import { scheduleUI } from "../../hooks/scheduleUI"
import { MorphSurface, type MorphSurfaceStyle } from "./MorphSurface"

export type MorphCardProps = {
  source: VirtualNode
  content: (close: () => void) => VirtualNode
  label?: string
  size?: Partial<Size>
  surface?: MorphSurfaceStyle
  layout?: (source: VirtualNode) => VirtualNode
}

const defaultSurface: MorphSurfaceStyle = {
  fill: "secondarySystemBackground", border: "separator",
  shadow: { color: "#00000020", radius: 18, y: 6 },
}
const commit = (change: () => void): void => change()
let nextSpace = 0

// Internal session: callers do not bind closing functions, hide sources or own geometry.
const createSession = () => {
  const morph = createMorphSession<MeasuredOrigin>()
  const space = `morph-card-${++nextSpace}`
  let active = true, pending = false, task: ReturnType<typeof setTimeout> | undefined
  return {
    state: morph.state, space,
    open(origin: MeasuredOrigin): void {
      if (!active || pending || morph.state.read()) return
      pending = true
      task = scheduleUI(() => { pending = false; if (active) morph.open(origin) })
    },
    dispose(): void { active = false; clearTimeout(task); morph.dispose() },
  }
}
type Session = ReturnType<typeof createSession>

const CardSource = ({ session, source, label }: { session: Session; source: VirtualNode; label: string }): VirtualNode => {
  const origin = useBusState(session.state, commit)
  return <MeasuredSource space={session.space} label={label} hidden={origin !== null} onActivate={session.open}>
    {source}
  </MeasuredSource>
}

const CardOverlay = ({ session, viewport, source, size, surface, content }: {
  session: Session; viewport: Rect; source: VirtualNode; size?: Partial<Size>
  surface: MorphSurfaceStyle; content: MorphCardProps["content"]
}): VirtualNode | null => {
  const presentation = useBusState(session.state, commit)
  const body = useMemo(() => presentation ? content(presentation.close) : null, [presentation, content])
  if (!presentation) return null
  const origin = presentation.value
  const width = Math.min(size?.width ?? 420, Math.max(0, viewport.width - 32))
  const height = Math.min(size?.height ?? 320, Math.max(0, viewport.height - 32))
  const frame = { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height }
  return <MorphSurface key={presentation.id} origin={origin} target={{ frame, surface }} viewport={viewport} preview={source}
    bindClose={presentation.bind} onClosed={presentation.finish}>
    {body!}
  </MorphSurface>
}

// The host lays out once; only the trigger and overlay subscribe to opening/closing.
export const MorphCard = ({ source, content, label = "打开详情", size, surface = defaultSurface, layout }: MorphCardProps): VirtualNode => {
  const [session] = useState(createSession)
  useEffect(() => () => session.dispose(), [session])
  const trigger = <CardSource session={session} source={source} label={label} />
  return <GeometryReader>{geometry => <ZStack coordinateSpace={session.space} frame={geometry.size}>
    {layout ? layout(trigger) : trigger}
    <CardOverlay session={session} viewport={{ ...geometry.size, x: 0, y: 0 }} source={source}
      size={size} surface={surface} content={content} />
  </ZStack>}</GeometryReader>
}
