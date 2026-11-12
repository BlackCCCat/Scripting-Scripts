import { AppEvents, Button, GeometryReader, Image, Rectangle, RoundedRectangle, ZStack, useEffect, useMemo, useRef } from "scripting"
import type { Rect, VirtualNode } from "scripting"
import { getDockModel, type DockModel, type DockAppearance, type DockMode, type LiquidDockController } from "./controller"
import type { DockMotion } from "./DockMotion"
import { DockInteraction } from "./interaction"
import { DockRebound, DockGlyphPose, MovingDockLens } from "./DockMotionView"
import { dockGeometry, dockMetrics, minimumDockWidth } from "./geometry"
import { selectionDockAnimation } from "./animation"
import { createStateSource, selectStateSource } from "../../shared/EventBus"
import { useBusState } from "../../hooks/useBusState"
import { useStableAction } from "../../hooks/useStableAction"
import { resolveDockAppearance } from "./appearance"
const direct=(change:()=>void):void=>change()
const yes=createStateSource(true),no=createStateSource(false)
export type LiquidDockProps={controller:LiquidDockController;appearance?:Partial<DockAppearance>;width?:number;interactive?:boolean;decorated?:boolean}

// Mode is low frequency. Motion samples, current selection and item availability belong to leaves.
export const LiquidDock=({controller,appearance:inputAppearance,width,interactive=true,decorated=true}:LiquidDockProps):VirtualNode=>{
 const appearance=useMemo(()=>resolveDockAppearance(inputAppearance),[inputAppearance])
 const model=useMemo(()=>getDockModel(controller),[controller])
 const modeId=useBusState(model.options.mode,direct),mode=model.mode(modeId)
 const actualWidth=Math.max(minimumDockWidth(mode.slots.length),width??mode.width)
 const origin=useRef<Rect|null>(null)
 const interaction=useMemo(()=>new DockInteraction(controller,actualWidth,()=>{
   const frame=origin.current;return frame?{frame,current:()=>origin.current??frame}:null
 }),[controller])
 useEffect(()=>{
   const stop=interaction.connect(),playback=model.connectPlayback()
   const scene=(phase:string)=>{if(phase!=="active")interaction.cancel()}
   AppEvents.scenePhase.addListener(scene)
   return()=>{AppEvents.scenePhase.removeListener(scene);stop();playback()}
 },[interaction,controller])
 useEffect(()=>interaction.update(actualWidth,modeId,interactive),[interaction,actualWidth,modeId,interactive])
 return <DockFrame controller={model} mode={mode} width={actualWidth} appearance={appearance} interactive={interactive} decorated={decorated} origin={origin} interaction={interaction}/>
}
// A readonly presentation has no input owner, subscription to scene events, playback clock or Motion.
// Width follows the moving confirmation card; unlike a live bar it must not impose minimum geometry.
export const LiquidDockPreview=({controller,appearance,width,modeId,decorated=false}:Omit<LiquidDockProps,"interactive">&{modeId?:string}):VirtualNode=>
 <DockFrame controller={getDockModel(controller)} mode={getDockModel(controller).mode(modeId)} width={width??getDockModel(controller).mode(modeId).width} appearance={resolveDockAppearance(appearance)} interactive={false} decorated={decorated}/>

type FrameProps={controller:DockModel;mode:DockMode;width:number;appearance:DockAppearance;interactive:boolean;decorated:boolean;origin?:{current:Rect|null};interaction?:DockInteraction}
export const DockSurface=({appearance,radius=dockMetrics.height/2}:{appearance:DockAppearance;radius?:number}):VirtualNode=>{
 const glass=parseInt(Device.systemVersion,10)>=26
 // Glass samples the content below the rail. A second filled surface would
 // obscure that content before refraction and compound the same tint twice.
 return <RoundedRectangle cornerRadius={radius} fill={glass?"clear":appearance.surface} allowsHitTesting={false}
   glassEffect={glass?{glass:UIGlass.clear().tint(appearance.surface),shape:{type:"rect",cornerRadius:radius}}:false}
   stroke={appearance.border}/>
}
const DockFrame=({controller,mode,width,appearance,interactive,decorated,origin,interaction}:FrameProps):VirtualNode=>{
 const motion=interaction?.motion
 return <ZStack alignment="leading" frame={{width,height:dockMetrics.height,alignment:"leading"}} animation={{animation:selectionDockAnimation(),value:mode.id}}
   overlay={origin?{alignment:"leading",content:<GeometryReader coordinateSpaces={["global"]} allowsHitTesting={false}>{g=>{origin.current=g.frame("global");return <Rectangle fill="clear" allowsHitTesting={false}/>}}</GeometryReader>}:undefined}>
   <DockRebound motion={motion}><ZStack alignment="leading" frame={{width,height:dockMetrics.height,alignment:"leading"}}
     background={decorated?<DockSurface appearance={appearance}/>:undefined} shadow={decorated?{color:appearance.shadow,radius:14,y:6}:undefined}>
     <DockSymbols controller={controller} mode={mode} width={width} appearance={appearance} motion={motion}/>
     <DockLens controller={controller} mode={mode} width={width} appearance={appearance} motion={motion} zIndex={1}/>
   </ZStack></DockRebound>
   {interaction?<DockButtons controller={controller} mode={mode} width={width} interactive={interactive} interaction={interaction} zIndex={2}/>:null}
   {interaction?<DockTouchSurface interaction={interaction} width={width} interactive={interactive} zIndex={3}/>:null}
 </ZStack>
}
const slotLayout=(controller:DockModel,mode:DockMode,width:number,key:string)=>{
 const index=mode.slots.findIndex(slot=>slot.key===key),visible=index>=0
 const fallback=controller.fallback(key)
 const value=visible?mode.slots[index].value:fallback
 const g=dockGeometry(width,mode.slots.length),left=g.left(visible?index:Math.min(controller.slots.indexOf(key),mode.slots.length-1))
 return {visible,value,index,left,item:g.item}
}
const DockSymbols=({controller,mode,width,appearance,motion,highlighted=false}:{controller:DockModel;mode:DockMode;width:number;appearance:DockAppearance;motion?:DockMotion;highlighted?:boolean}):VirtualNode=>
 <ZStack alignment="leading" frame={{width,height:dockMetrics.height,alignment:"leading"}} allowsHitTesting={false} accessibilityHidden>
   {controller.slots.map(key=><DockSlot key={key} slotKey={key} controller={controller} mode={mode} width={width} appearance={appearance} motion={motion} highlighted={highlighted}/>)}
 </ZStack>
const DockSlot=({slotKey,controller,mode,width,appearance,motion,highlighted}:{slotKey:string;controller:DockModel;mode:DockMode;width:number;appearance:DockAppearance;motion?:DockMotion;highlighted:boolean}):VirtualNode=>{
 const {visible,value,left,item}=slotLayout(controller,mode,width,slotKey)
 const glyph=useMemo(()=>{
   const entry=controller.item(value),color=highlighted?appearance.selectedForeground:appearance.foreground
   return entry.icon?entry.icon({value,modeId:mode.id,color,highlighted,playback:controller.playback.get(value)!}):<Image systemName={entry.systemImage!} font={22} foregroundStyle={color}/>
 },[controller,value,mode.id,appearance,highlighted])
 return <ZStack frame={{width:item,height:dockMetrics.lensHeight}} offset={{x:left,y:0}} opacity={visible?1:0} scaleEffect={visible?1:.55}>
   <DockGlyphPose motion={motion} center={left+item/2} width={item} editing={mode.interaction==="actions"}>
     <DockAvailability controller={controller} value={value}>{glyph}</DockAvailability>
   </DockGlyphPose>
 </ZStack>
}
const DockAvailability=({controller,value,children}:{controller:DockModel;value:string;children:VirtualNode}):VirtualNode=>{
 const enabled=useBusState(controller.item(value).enabled??yes,direct)
 return <ZStack opacity={enabled?1:.35}>{children}</ZStack>
}
const DockLens=({controller,mode,width,appearance,motion}:{controller:DockModel;mode:DockMode;width:number;appearance:DockAppearance;motion?:DockMotion}):VirtualNode=>{
 const selected=useBusState(controller.options.selection,direct),g=dockGeometry(width,mode.slots.length)
 const index=Math.max(0,mode.slots.findIndex(slot=>slot.value===selected)),x=g.left(index)
 const glyphs=useMemo(()=><DockSymbols controller={controller} mode={mode} width={width} appearance={appearance} motion={motion} highlighted/>,[controller,mode,width,appearance,motion])
 if(motion)return <MovingDockLens motion={motion} width={width} editing={mode.interaction==="actions"} count={mode.slots.length} modeId={mode.id} targetX={x} appearance={appearance}>{glyphs}</MovingDockLens>
 const frame={width:g.item,height:dockMetrics.lensHeight},offset={x,y:0}
 return <ZStack alignment="leading" frame={{width,height:dockMetrics.height,alignment:"leading"}} allowsHitTesting={false} accessibilityHidden animation={{animation:selectionDockAnimation(),value:selected}}>
   <ZStack frame={frame} offset={offset}>
     <RoundedRectangle cornerRadius={dockMetrics.lensHeight/2} fill={appearance.selectedSurface}/>
     {parseInt(Device.systemVersion,10)>=26?<RoundedRectangle cornerRadius={dockMetrics.lensHeight/2} fill="clear" glassEffect={{glass:UIGlass.regular().tint(appearance.selectedSurface),shape:{type:"rect",cornerRadius:dockMetrics.lensHeight/2}}}/>:null}
     <RoundedRectangle cornerRadius={dockMetrics.lensHeight/2} fill="clear" stroke={appearance.border}/>
   </ZStack>
   <ZStack frame={{width,height:dockMetrics.height,alignment:"leading"}} mask={{alignment:"leading",content:<RoundedRectangle cornerRadius={dockMetrics.lensHeight/2} fill="white" frame={frame} offset={offset}/>}}>{glyphs}</ZStack>
 </ZStack>
}
const DockButtons=({controller,mode,width,interactive,interaction}:{controller:DockModel;mode:DockMode;width:number;interactive:boolean;interaction:DockInteraction}):VirtualNode=>
 <ZStack alignment="leading" frame={{width,height:dockMetrics.height,alignment:"leading"}}>{controller.slots.map(key=><DockButton key={key} slotKey={key} controller={controller} mode={mode} width={width} interactive={interactive} interaction={interaction}/>)}</ZStack>
const DockButton=({slotKey,controller,mode,width,interactive,interaction}:{slotKey:string;controller:DockModel;mode:DockMode;width:number;interactive:boolean;interaction:DockInteraction}):VirtualNode=>{
 const {visible,value,index,left,item}=slotLayout(controller,mode,width,slotKey),entry=controller.item(value)
 const enabled=useBusState(entry.enabled??yes,direct),blocked=useBusState(controller.options.blocked??no,direct)
 const labelSource=useMemo(()=>typeof entry.title==="string"?createStateSource(entry.title):entry.title,[entry.title])
 const label=useBusState(labelSource,direct)
 const selectedSource=useMemo(()=>selectStateSource(controller.options.selection,current=>current===value),[controller,value])
 const selected=useBusState(selectedSource,direct),disabled=!interactive||!visible||!enabled||blocked
 const action=useStableAction(()=>interaction.activate(index)),more=useStableAction(()=>interaction.activate(index,true))
 const hasMenu=visible&&mode.interaction==="navigation"&&!!controller.options.onMenu
 return <Button action={action} buttonStyle="plain" disabled={disabled} accessibilityLabel={label}
   accessibilityActions={hasMenu?[{name:"更多操作",action:more}]:undefined}
   onLongPressGesture={hasMenu&&parseInt(Device.systemVersion,10)<18?{minDuration:450,perform:more}:undefined}
   accessibilityAddTraits={selected?"isSelected":undefined} opacity={visible?1:0} accessibilityHidden={disabled}
   allowsHitTesting={!disabled&&parseInt(Device.systemVersion,10)<18}
   frame={{width:item,height:dockMetrics.lensHeight}} offset={{x:left,y:0}}><Rectangle fill="clear" frame={{width:item,height:dockMetrics.lensHeight}} contentShape="capsule"/></Button>
}
export const DockTouchSurface=({interaction,width,interactive}:{interaction:DockInteraction;width:number;interactive:boolean}):VirtualNode=>{
 const blocked=useBusState(interaction.controller.options.blocked??no,direct)
 const touch=useMemo(()=>({onEvent:interaction.receive}),[interaction])
 return <Rectangle fill="clear" frame={{width,height:dockMetrics.height}} contentShape="capsule" accessibilityHidden
   allowsHitTesting={interactive&&!blocked&&parseInt(Device.systemVersion,10)>=18} onTouchGesture={touch}/>
}
