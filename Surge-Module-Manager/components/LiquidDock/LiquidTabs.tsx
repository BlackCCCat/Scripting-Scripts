import { GeometryReader, Rectangle, Spacer, VStack, ZStack, useEffect, useMemo, useRef, useState } from "scripting"
import type { Rect, VirtualNode } from "scripting"
import { useBusState } from "../../hooks/useBusState"
import { selectStateSource } from "../../shared/EventBus"
import type { TabSurfacePresentation as MovingSurface } from "./tabSurfaces"
import { getTabsModel, type LiquidTabsController } from "./tabsController"
import { MorphSurface, type MorphSurfaceStyle } from "../MorphSurface"
import { selectionDockAnimation } from "./animation"
import { dockMetrics } from "./geometry"
import { LiquidDock, LiquidDockPreview } from "./LiquidDock"
import { resolveDockAppearance } from "./appearance"
import type { DockAppearance } from "./controller"

const direct = (change: () => void): void => change()
export type LiquidTabsProps = { controller: LiquidTabsController; appearance?: Partial<DockAppearance> }
export const LiquidTabPages = ({ controller }: Pick<LiquidTabsProps, "controller">): VirtualNode => {
 const model = getTabsModel(controller)
 const hosts = useMemo(() => model.pages.map(page => <TabPageHost key={page.value} controller={controller} value={page.value}>{page.content}</TabPageHost>), [controller])
 return <ZStack alignment="topLeading" frame={{ maxWidth: Infinity, maxHeight: Infinity }}>{hosts}</ZStack>
}
const TabPageHost = ({ controller, value, children }: { controller: LiquidTabsController; value: string; children: VirtualNode }): VirtualNode => {
 const source = useMemo(() => selectStateSource(controller.selection, selected => selected === value), [controller, value])
 const active = useBusState(source, direct)
 return <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }} opacity={active ? 1 : 0}
  allowsHitTesting={active} accessibilityHidden={!active} animation={{ animation: Animation.smooth({ duration: 0.25 }), value: active }}>{children}</VStack>
}
export const LiquidTabBar = ({ controller, appearance }: LiquidTabsProps): VirtualNode => {
 const model = getTabsModel(controller)
 return model.surfaces ? <MorphingTabBar controller={controller} appearance={appearance}/> : <LiquidDock controller={model.dock} appearance={appearance}/>
}
const MorphingTabBar = ({ controller, appearance }: LiquidTabsProps): VirtualNode => {
 const model = getTabsModel(controller), surfaces = model.surfaces!, owner = useRef({})
 const bar = useBusState(controller.bar, direct)
 const visibleSource = useMemo(() => selectStateSource(surfaces.presentation, value => value === null), [controller])
 const visible = useBusState(visibleSource, direct)
 useEffect(() => () => surfaces.releaseBar(owner.current), [controller])
 return <ZStack frame={{ width: model.barDefinition(bar).width, height: dockMetrics.height }} animation={{ animation: selectionDockAnimation(), value: bar }} opacity={visible ? 1 : 0} allowsHitTesting={visible}
  overlay={<GeometryReader coordinateSpaces={["global"]} allowsHitTesting={false}>{g => {
   surfaces.measure(owner.current, g.frame("global")); return <Rectangle fill="clear" allowsHitTesting={false}/>
  }}</GeometryReader>}>
  <LiquidDock controller={model.dock} appearance={appearance} interactive={visible}/>
 </ZStack>
}
export const LiquidTabOverlay = ({ controller, appearance }: LiquidTabsProps): VirtualNode | null => {
 const surfaces = getTabsModel(controller).surfaces
 return surfaces ? <MorphingTabOverlay controller={controller} appearance={appearance}/> : null
}
const MorphingTabOverlay = ({ controller, appearance: inputAppearance }: LiquidTabsProps): VirtualNode => {
 const surfaces = getTabsModel(controller).surfaces!
 const appearance = useMemo(() => resolveDockAppearance(inputAppearance), [inputAppearance])
 const moving = useBusState(surfaces.presentation, direct)
 useEffect(() => surfaces.connectOverlay(), [controller])
 return <GeometryReader coordinateSpaces={["global"]}>{g => {
  if (!moving) return <Rectangle fill="clear" allowsHitTesting={false}/>
  const viewport = g.frame("global")
  const local = (rect: Rect): Rect => ({ ...rect, x: rect.x - viewport.x, y: rect.y - viewport.y })
  const size = { width: Math.min(moving.value.definition.size.width, Math.max(1, g.size.width - 32)), height: Math.min(moving.value.definition.size.height, Math.max(1, g.size.height - 32)) }
  const style = { fill: appearance.surface, border: appearance.border, glass: true, shadow: { color: appearance.shadow, radius: 14, y: 6 } }
  return <TabSurfacePresentation key={moving.id} controller={controller} appearance={appearance} moving={moving} viewport={g.size} local={local} size={size} style={style}/>

 }}</GeometryReader>
}


const TabSurfacePresentation = ({ controller, appearance, moving, viewport, local, size, style }: {
 controller: LiquidTabsController; appearance: DockAppearance; moving: MovingSurface; viewport: { width: number; height: number }
 local: (rect: Rect) => Rect; size: { width: number; height: number }; style: MorphSurfaceStyle
}): VirtualNode => {
 const [expanded, setExpanded] = useState(false)
 const content = useMemo(() => moving.value.definition.content({ close: moving.close, tabs: controller }), [moving, controller])
 return <ZStack alignment="topLeading" frame={viewport}>
  <Rectangle fill="black" opacity={expanded ? 0.14 : 0} allowsHitTesting={expanded} onTapGesture={controller.close}/>
  <MorphSurface origin={{ frame: local(moving.value.frame), current: () => local(moving.value.current()), radius: dockMetrics.height / 2, surface: style }}
   target={{ frame: { x: (viewport.width - size.width) / 2, y: (viewport.height - size.height) / 2, ...size }, surface: moving.value.definition.surface ?? style }}
   viewport={{ x: 0, y: 0, ...viewport }} reversible={false} modal onChange={setExpanded}
   bindClose={moving.bind} onClosed={moving.finish}
   preview={(_returning, frame) => <LiquidDockPreview controller={getTabsModel(controller).dock} appearance={appearance} modeId={controller.bar.read()} width={frame.width} decorated/>}>
   {content}
  </MorphSurface>
 </ZStack>
}

// Split hosts share the same registry/controller; a page never consumes drag or bar-mode samples.
export const LiquidTabs = ({ controller, appearance }: LiquidTabsProps): VirtualNode =>
 <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
  <VStack padding={{ bottom: dockMetrics.height + 16 }}><LiquidTabPages controller={controller}/></VStack>
  <VStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}><Spacer/><LiquidTabBar controller={controller} appearance={appearance}/></VStack>
  {getTabsModel(controller).surfaces ? <LiquidTabOverlay controller={controller} appearance={appearance}/> : null}
 </ZStack>
