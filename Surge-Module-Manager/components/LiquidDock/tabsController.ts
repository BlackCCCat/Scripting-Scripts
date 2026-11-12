import type { Color, ImageProps, VirtualNode } from "scripting"
import { createStateSource, type StateSource } from "../../shared/EventBus"
import { createLiquidDock, getDockModel } from "./controller"
import { createTabSurfaces, type LiquidTabSurface } from "./tabSurfaces"
import { tabDockItem } from "./TabGlyph"
import { dockMetrics, minimumDockWidth } from "./geometry"

export type TabIconContext = { value: string; color: Color; highlighted: boolean }
type TabIcon =
 | { systemImage: string; image?: never; icon?: never }
 | { image: ImageProps; systemImage?: never; icon?: never }
 | { icon: (context: TabIconContext) => VirtualNode; systemImage?: never; image?: never }
export type LiquidTabIconAnimation = { duration?: number; render: (context: TabIconContext & { active: boolean; icon: VirtualNode }) => VirtualNode }
type TabItem = TabIcon & { iconAnimation?: LiquidTabIconAnimation; value: string; title: string | StateSource<string>; enabled?: StateSource<boolean> }
export type LiquidTabPage = TabItem & { content: VirtualNode }
export type LiquidTabAction = TabItem & { onPress: (context: { tabs: LiquidTabsController }) => void }
export type LiquidTabBarDefinition = { value: string; items: readonly string[]; width?: number }
export type LiquidTabsOptions = {
 pages: readonly LiquidTabPage[]
 surfaces?: readonly LiquidTabSurface[]
 actions?: readonly LiquidTabAction[]
 bars?: readonly LiquidTabBarDefinition[]
 initialSelection?: string
 initialBar?: string
 selection?: Observable<string>
 onSelectionChanged?: (value: string) => void
 blocked?: StateSource<boolean>
}
export type LiquidTabsController = {
 readonly selection: StateSource<string>
 readonly bar: StateSource<string>
 select: (value: string) => void
 present: (value: string) => boolean
 close: () => void
 showBar: (value: string) => void
}
const readonly = <T,>(source: StateSource<T>): StateSource<T> => ({ read: source.read, subscribe: source.subscribe })
const fail = (message: string): never => { throw new Error("LiquidTabs: " + message) }
const createTabsModel = (input: LiquidTabsOptions) => {
 const copy = <T extends LiquidTabPage | LiquidTabAction>(item: T): T => ({ ...item, image: item.image ? { ...item.image } : undefined, iconAnimation: item.iconAnimation ? { ...item.iconAnimation } : undefined })
 const pages = input.pages.map(copy), actions = (input.actions ?? []).map(copy)
 if (!pages.length) fail("at least one page is required")
 const entries = new Map<string, LiquidTabPage | LiquidTabAction>()
 for (const item of [...pages, ...actions]) {
  if (!item.value || entries.has(item.value)) fail("duplicate or empty item ID")
  if (item.iconAnimation?.duration !== undefined && (!Number.isFinite(item.iconAnimation.duration) || item.iconAnimation.duration <= 0)) fail("invalid icon animation duration")
  if ([item.icon, item.systemImage, item.image].filter(Boolean).length !== 1) fail("register exactly one icon for " + item.value)
  if (item.image && [item.image.systemName, item.image.filePath, item.image.imageUrl, item.image.image].filter(Boolean).length !== 1) fail("register exactly one image source for " + item.value)
  entries.set(item.value, item)
 }
 const pageIDs = new Set(pages.map(page => page.value))
 const checkPage = (value: string): string => pageIDs.has(value) ? value : fail("Unknown page: " + value)
 const bars = (input.bars ?? [{ value: "main", items: pages.map(page => page.value) }]).map(bar => ({ ...bar, items: [...bar.items] }))
 const modes = new Map<string, typeof bars[number]>()
 for (const bar of bars) {
  if (!bar.value || modes.has(bar.value) || !bar.items.length || new Set(bar.items).size !== bar.items.length) fail("invalid bar")
  if (bar.items.some(value => !entries.has(value))) fail("Unknown item in bar: " + bar.value)
  bar.width ??= Math.max(174, dockMetrics.inset * 2 + 64 * bar.items.length + dockMetrics.gap * (bar.items.length - 1))
  if (!Number.isFinite(bar.width) || bar.width < minimumDockWidth(bar.items.length)) fail("bar items require at least 44pt")
  modes.set(bar.value, bar)
 }
 const initialBar = input.initialBar ?? bars[0]?.value
 if (!initialBar || !modes.has(initialBar)) fail("Unknown initial bar")
 const localSelection = createStateSource(checkPage(input.selection?.value ?? input.initialSelection ?? pages[0].value))
 const selection: StateSource<string> = input.selection ? {
  read: () => checkPage(input.selection!.value),
  subscribe: notify => { const changed = (): void => { checkPage(input.selection!.value); notify() }; input.selection!.subscribe(changed); return () => input.selection!.unsubscribe(changed) },
 } : readonly(localSelection)
 const bar = createStateSource(initialBar)
 const actionFocus = createStateSource("")
 const focus: StateSource<string> = {
  read: () => {
   const items = modes.get(bar.read())!.items, selected = selection.read()
   return items.includes(actionFocus.read()) && actionFocus.read() ? actionFocus.read() : items.includes(selected) ? selected : items[0]
  },
  subscribe: notify => {
   let previous = focus.read()
   const changed = (): void => { const next = focus.read(); if (next !== previous) { previous = next; notify() } }
   const stops = [selection.subscribe(changed), bar.subscribe(changed), actionFocus.subscribe(changed)]
   return () => stops.forEach(stop => stop())
  },
 }
 const surfaces = input.surfaces?.length ? createTabSurfaces(input.surfaces) : undefined
 const controller: LiquidTabsController = {
  present: value => input.blocked?.read() ? false : surfaces ? surfaces.present(value) : fail("Unknown surface: " + value), close: () => surfaces?.close(),
  selection, bar: readonly(bar),
  select: value => {
   checkPage(value)
   if (value === selection.read() || input.blocked?.read() || entries.get(value)!.enabled?.read() === false) return
   if (input.selection) input.selection.setValue(value); else localSelection.write(value)
   input.onSelectionChanged?.(value)
  },
  showBar: value => { if (!modes.has(value)) fail("Unknown bar: " + value); bar.write(value) },
 }
 const blocked: StateSource<boolean> | undefined = surfaces ? {
  read: () => !!input.blocked?.read() || surfaces.presentation.read() !== null,
  subscribe: notify => { const stops = [surfaces.presentation.subscribe(notify), input.blocked?.subscribe(notify)]; return () => stops.forEach(stop => stop?.()) },
 } : input.blocked
 const dock = createLiquidDock({
  items: [...entries.values()].map(tabDockItem), selection: focus, mode: readonly(bar), blocked,
  modes: bars.map(value => ({ id: value.value, interaction: value.items.every(id => pageIDs.has(id)) ? "navigation" : "actions", width: value.width!,
   slots: value.items.map((id, index) => ({ value: id, key: index === 0 ? "leading" : index === value.items.length - 1 ? "trailing" : "middle-" + index })) })),
  onSelectionChanged: controller.select,
  onAction: value => {
   if (input.blocked?.read() || entries.get(value)?.enabled?.read() === false) return
   if (pageIDs.has(value)) {
    controller.select(value)
    actionFocus.write("")
   } else {
    actionFocus.write(value)
    if (entries.get(value)?.iconAnimation) getDockModel(dock).play(value)
    const action = entries.get(value) as LiquidTabAction
    action?.onPress?.({ tabs: controller })
    setTimeout(() => actionFocus.write(""), 280)
   }
  },
 })
 return { controller, dock, pages, surfaces, barDefinition: (value: string) => modes.get(value)! }
}
type TabsModel = ReturnType<typeof createTabsModel>
const models = new WeakMap<LiquidTabsController, TabsModel>()
export const createLiquidTabs = (options: LiquidTabsOptions): LiquidTabsController => {
 const model = createTabsModel(options); models.set(model.controller, model); return model.controller
}
export const getTabsModel = (controller: LiquidTabsController): TabsModel => models.get(controller) ?? fail("invalid controller")
