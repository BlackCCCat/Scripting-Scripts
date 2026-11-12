import { Image, useMemo } from "scripting"
import type { VirtualNode } from "scripting"
import { useBusState } from "../../hooks/useBusState"
import type { DockIconContext, DockItem } from "./controller"
import type { LiquidTabPage, LiquidTabAction, TabIconContext, LiquidTabIconAnimation } from "./tabsController"
const direct = (change: () => void): void => change()
// Native Image sources share one fitted canvas; callers never measure their intrinsic pixels.
const renderImage = (item: LiquidTabPage | LiquidTabAction, color: TabIconContext["color"]): VirtualNode =>
 item.image ? <Image {...item.image} resizable scaleToFit frame={{ width: 22, height: 22 }} foregroundStyle={color}/>
  : <Image systemName={item.systemImage!} font={22} foregroundStyle={color}/>
export const tabDockItem = (item: LiquidTabPage | LiquidTabAction): DockItem => {
 const base = { value: item.value, title: item.title, enabled: item.enabled }
 if (item.iconAnimation) return { ...base, playbackDuration: item.iconAnimation.duration, icon: context => <TabGlyph item={item} context={context}/> }
 if (item.icon) return { ...base, playbackDuration: 0, icon: context => item.icon!({ value: context.value, color: context.color, highlighted: context.highlighted }) }
 if (item.image) return { ...base, playbackDuration: 0, icon: context => renderImage(item, context.color) }
 return { ...base, systemImage: item.systemImage }
}
const TabGlyph = ({ item, context }: { item: LiquidTabPage | LiquidTabAction; context: DockIconContext }): VirtualNode => {
 const props: TabIconContext = { value: context.value, color: context.color, highlighted: context.highlighted }
 const icon = useMemo(() => item.icon ? item.icon(props) : renderImage(item, context.color), [item, context.color, context.highlighted])
 return item.iconAnimation ? <AnimatedGlyph definition={item.iconAnimation} context={context} icon={icon}/> : icon
}
const AnimatedGlyph = ({ definition, context, icon }: { definition: LiquidTabIconAnimation; context: DockIconContext; icon: VirtualNode }): VirtualNode => {
 const active = useBusState(context.playback, direct)
 return definition.render({ value: context.value, color: context.color, highlighted: context.highlighted, active, icon })
}
