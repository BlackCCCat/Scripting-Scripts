import { GeometryReader, Rectangle, RoundedRectangle, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import type { Rect, VirtualNode } from "scripting"
import { anchoredMenuAnimation } from "./animation"
import { scheduleUI } from "../../hooks/scheduleUI"
export type MenuPresentation={id?:string|number;anchor:Rect;width:number;height:number;content:VirtualNode;onPresented?:()=>void}
export type AnchoredMenuProps={presentation:MenuPresentation|null;surface?:VirtualNode;onDismiss:()=>void;openMotion?:()=>Animation;closeMotion?:()=>Animation}
type ResolvedMenu = MenuPresentation & { id: string | number }
let nextMenu = 0
const defaultSurface = <RoundedRectangle cornerRadius={22} fill="secondarySystemBackground" stroke="separator" allowsHitTesting={false}/>
export const AnchoredMenu=({presentation,surface=defaultSurface,onDismiss,openMotion=anchoredMenuAnimation,closeMotion=()=>Animation.easeOut(.18)}:AnchoredMenuProps):VirtualNode=>{
 const previous=useRef<ResolvedMenu|null>(null),wasOpen=useRef(false)
 if(presentation)previous.current={...presentation,id:presentation.id??(wasOpen.current?previous.current!.id:`menu-${++nextMenu}`)}
 wasOpen.current=!!presentation
 const last=previous.current
 return <GeometryReader coordinateSpaces={["global"]}>{g=>{
   const local=g.frame("global")
   return <ZStack frame={{width:g.size.width,height:g.size.height}} allowsHitTesting={!!presentation} accessibilityHidden={!presentation}>
     <Rectangle fill="clear" contentShape="rect" onTapGesture={onDismiss}/>
     {last?<AnchoredMenuCard key={last.id} menu={last} open={!!presentation} dismiss={onDismiss} surface={surface} openMotion={openMotion} closeMotion={closeMotion} viewport={{x:local.x,y:local.y,width:g.size.width,height:g.size.height}}/>:null}
   </ZStack>
 }}</GeometryReader>
}
// 首帧先放在气泡顶部，再跨一个事件循环展开；首次弹出也有正确的空间起点。
const AnchoredMenuCard=({menu,open,dismiss,viewport,surface,openMotion,closeMotion}:{menu:ResolvedMenu;open:boolean;dismiss:()=>void;viewport:Rect;surface:VirtualNode;openMotion:()=>Animation;closeMotion:()=>Animation}):VirtualNode=>{
 const [shown,setShown]=useState(false)
 const layout=useRef(viewport)
 useEffect(()=>{
   const previous=layout.current;layout.current=viewport
   if(open&&(previous.width!==viewport.width||previous.height!==viewport.height))dismiss()
 },[open,viewport.width,viewport.height,dismiss])
 useEffect(()=>{
   let active=true
   const timer=scheduleUI(()=>{if(active)setShown(open)})
   return()=>{active=false;clearTimeout(timer)}
 },[open])
 useEffect(()=>{if(shown&&open)menu.onPresented?.()},[shown,open,menu])
 const {width,height}=menu,rect=menu.anchor
 const center=rect.x+rect.width/2-viewport.x
 const x=Math.max(width/2+16,Math.min(viewport.width-width/2-16,center))
 const y=Math.max(height/2+16,Math.min(viewport.height-height/2-16,rect.y-viewport.y-height/2-10))
 const anchor={x:Math.max(0,Math.min(1,(center-x+width/2)/width)),y:1}
 return <VStack spacing={0} frame={{width,height}} background={surface} allowsHitTesting={shown&&open} accessibilityHidden={!shown||!open}
   opacity={shown?1:0} scaleEffect={{x:shown?1:.01,y:shown?1:.01,anchor}}
   position={{x,y:y+(shown?0:16)}}
   animation={{animation:shown?openMotion():closeMotion(),value:shown}}>
   {menu.content}
 </VStack>
}
