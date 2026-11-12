import type { Rect, VirtualNode } from "scripting"
import { createMorphSession, type MorphPresentation } from "../MorphSurface/presentation"
import type { MorphSurfaceStyle } from "../MorphSurface"
import type { LiquidTabsController } from "./tabsController"
export type LiquidTabSurface = {
 value: string
 size: { width: number; height: number }
 content: (context: { close: () => void; tabs: LiquidTabsController }) => VirtualNode
 surface?: MorphSurfaceStyle
}
export type TabSurfacePresentation = MorphPresentation<{ definition: LiquidTabSurface; frame: Rect; current: () => Rect }>
export const createTabSurfaces = (definitions: readonly LiquidTabSurface[]) => {
 const registry = new Map<string, LiquidTabSurface>()
 for (const entry of definitions) {
  if (!entry.value || registry.has(entry.value) || !Number.isFinite(entry.size.width) || !Number.isFinite(entry.size.height) || entry.size.width <= 0 || entry.size.height <= 0) throw new Error("LiquidTabs: invalid surface")
  registry.set(entry.value, { ...entry, size: { ...entry.size } })
 }
 const session = createMorphSession<TabSurfacePresentation["value"]>()
 let origin: { owner: object; frame: Rect } | null = null, overlays = 0
 return {
  presentation: session.state,
  measure: (owner: object, frame: Rect): void => {
   if ([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0) origin = { owner, frame: { ...frame } }
  },
  releaseBar: (owner: object): void => { if (origin?.owner === owner) { origin = null; session.reset() } },
  connectOverlay: (): (() => void) => { overlays++; return () => { if (--overlays === 0) session.reset() } },
  present: (value: string): boolean => {
   const definition = registry.get(value)
   if (!definition) throw new Error("LiquidTabs: Unknown surface: " + value)
   if (!origin || !overlays || session.state.read()) return false
   const frame = { ...origin.frame }
   return !!session.open({ definition, frame, current: () => origin?.frame ?? frame })
  },
  close: session.close,
 }
}
