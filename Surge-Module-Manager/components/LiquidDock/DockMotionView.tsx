import { dockGeometry, dockMetrics } from "./geometry"
import type { DockAppearance } from "./controller"
import { GlassEffectContainer, RoundedRectangle, ZStack, useEffect, useMemo } from "scripting"
import type { VirtualNode } from "scripting"
import type { DockMotion } from "./DockMotion"
import { dockPressure } from "./DockTuning"
import { dockPressAnimation, selectionDockAnimation } from "./animation"
import { createStateSource, selectStateSource } from "../../shared/EventBus"
import { useBusState } from "../../hooks/useBusState"
const direct=(change:()=>void):void=>change()
const idleLift=createStateSource(0)
const scaleFor=(width:number,stretch:number,press=1)=>{
 const pressure=(press-1)/.075
 const expansion=dockPressure.expansion*pressure
 return {x:(1+stretch)*(1+expansion/width),y:(1+expansion/dockMetrics.lensHeight)/(1+stretch*.72)}
}

// 仅这个装饰叶与镜片消费逐帧采样；children 保持同一个 CustomShape 节点。
export const DockGlyphPose=({motion,center,width,editing,children}:{motion?:DockMotion;center:number;width:number;editing:boolean;children:VirtualNode}):VirtualNode=>
 motion?<LiveGlyph motion={motion} center={center} width={width} editing={editing}>{children}</LiveGlyph>:children
const LiveGlyph=({motion,center,width,editing,children}:{motion:DockMotion;center:number;width:number;editing:boolean;children:VirtualNode}):VirtualNode=>{
 const source=useMemo(()=>editing?idleLift:selectStateSource(motion,frame=>{
   const half=width*scaleFor(width,frame.stretch,frame.press).x/2
   const x=frame.x+frame.skew*width
   const coverage=Math.max(0,Math.min(1,(Math.min(x+half,center+16)-Math.max(x-half,center-16))/32))
   const lifted=Math.max(0,Math.min(1,(frame.press-1)/.075))
   return coverage*coverage*(3-2*coverage)*lifted
 }),[motion,center,width,editing])
 const lift=useBusState(source,direct)
 return <ZStack scaleEffect={editing?1:1+(dockPressure.iconScale-1)*lift} offset={{x:0,y:-1.5*lift}}>{children}</ZStack>
}
// 普通／编辑始终是同一个镜片和同一组图标 mask。模式变化使用既有原生布局动画，
// 普通态逐帧采样不改变该 animation 的 value；不能替换整棵材质树来切换模式。
export const MovingDockLens=({motion,width,editing=false,targetX=dockMetrics.inset,count,appearance,modeId,children}:{motion:DockMotion;width:number;editing?:boolean;targetX?:number;count:number;appearance:DockAppearance;modeId:string;children:VirtualNode}):VirtualNode=>{
 const pose=useMemo(()=>selectStateSource(motion,({x,stretch,skew,press,width,count})=>({x,stretch,skew,press,width,count}),
   (a,b)=>a.x===b.x&&a.stretch===b.stretch&&a.skew===b.skew&&a.press===b.press&&a.width===b.width&&a.count===b.count),[motion])
 const frame=useBusState(pose,direct),item=dockGeometry(width,count).item
 const index=Math.round((targetX-dockMetrics.inset)/(item+dockMetrics.gap))
 // 普通态路由由输入桥即时同步；其迟到渲染不能 select 并撤销下一次手势。
 useEffect(()=>{motion.resize(width,count,index);if(editing)motion.select(index)},[motion,width,count,index,editing])
 const currentLayout=frame.width===width&&frame.count===count
 const center=currentLayout?frame.x+frame.skew*item:targetX+item/2
 const scale=scaleFor(item,currentLayout?frame.stretch:0,editing||!currentLayout?1:frame.press),geometry={width:item,height:dockMetrics.lensHeight}
 const material=useMemo(()=>{
   const glass=parseInt(Device.systemVersion,10)>=26
   const lens=<RoundedRectangle cornerRadius={dockMetrics.lensHeight/2} fill={appearance.selectedSurface} frame={geometry}
     glassEffect={glass?{glass:UIGlass.clear().interactive(),shape:{type:"rect",cornerRadius:dockMetrics.lensHeight/2}}:false}
     stroke={appearance.border}/>
   return glass?<GlassEffectContainer>{lens}</GlassEffectContainer>:lens
 },[appearance,item])
 const bubble=<RoundedRectangle cornerRadius={dockMetrics.lensHeight/2} fill="white" frame={geometry} scaleEffect={scale} position={{x:center,y:dockMetrics.height/2}}/>
 return <ZStack frame={{width,height:dockMetrics.height}} allowsHitTesting={false} accessibilityHidden
   animation={{animation:selectionDockAnimation(),value:modeId}}>
   <ZStack frame={geometry} position={{x:center,y:dockMetrics.height/2}} scaleEffect={scale}>{material}</ZStack>
   <ZStack frame={{width,height:dockMetrics.height}} mask={<ZStack frame={{width,height:dockMetrics.height}}>{bubble}</ZStack>}>{children}</ZStack>
 </ZStack>
}
// 只缩放绘制层，命中面与全局来源坐标保持原尺寸；children在采样期间保持原身份。
export const DockRebound=({motion,children}:{motion?:DockMotion;children:VirtualNode}):VirtualNode=>
 motion?<LiveRebound motion={motion}>{children}</LiveRebound>:children
const LiveRebound=({motion,children}:{motion:DockMotion;children:VirtualNode}):VirtualNode=>{
 const source=useMemo(()=>selectStateSource(motion,frame=>frame.railScale),[motion])
 const scale=useBusState(source,direct)
 return <ZStack scaleEffect={scale} animation={{animation:dockPressAnimation(),value:scale}} allowsHitTesting={false}>{children}</ZStack>
}
