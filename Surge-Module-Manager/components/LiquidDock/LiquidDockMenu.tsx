import type { VirtualNode } from "scripting"
import { AnchoredMenu, type MenuPresentation } from "../AnchoredMenu"
import type { DockAppearance } from "./controller"
import { resolveDockAppearance } from "./appearance"
import { DockSurface } from "./LiquidDock"
export type DockMenuPresentation = MenuPresentation
export const LiquidDockMenu = ({ presentation, appearance, onDismiss }: {
  presentation: DockMenuPresentation | null; appearance?: Partial<DockAppearance>; onDismiss: () => void
}): VirtualNode => <AnchoredMenu presentation={presentation} surface={<DockSurface radius={22} appearance={resolveDockAppearance(appearance)}/>} onDismiss={onDismiss}/>
