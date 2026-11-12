import type { Rect } from "scripting"
export const dockMetrics = { height:64, lensHeight:52, inset:6, gap:6, minimumItem:44 } as const
export const minimumDockWidth = (count:number):number => dockMetrics.inset*2 + dockMetrics.minimumItem*count + dockMetrics.gap*(count-1)
export const dockGeometry = (width:number,count:number) => {
 if(!Number.isInteger(count)||count<1||!Number.isFinite(width)||width<=dockMetrics.inset*2+dockMetrics.gap*(count-1))throw new Error("Invalid LiquidDock geometry")
 const item=(width-dockMetrics.inset*2-dockMetrics.gap*(count-1))/count,step=item+dockMetrics.gap
 return {item,step,left:(index:number)=>dockMetrics.inset+index*step,center:(index:number)=>dockMetrics.inset+item/2+index*step}
}
export const dockAnchor = (rail:Rect,center:number,count:number):Rect => {
 const {item}=dockGeometry(rail.width,count)
 return {x:rail.x+center-item/2,y:rail.y+dockMetrics.inset,width:item,height:dockMetrics.lensHeight}
}
