import type { Color, Rect, VirtualNode } from "scripting"
import { createStateSource, type StateSource } from "../../shared/EventBus"
import { dockMetrics, minimumDockWidth } from "./geometry"

export type DockOrigin = { frame:Rect; current:()=>Rect }
export type DockAppearance = { surface:Color; foreground:Color; selectedSurface:Color; selectedForeground:Color; border:Color; shadow:Color }
export type DockIconContext = { value:string; modeId:string; color:Color; highlighted:boolean; playback:StateSource<boolean> }
export type DockItem = {
 value:string
 title:string|StateSource<string>
 // 0 disables playback for a static custom icon; omitted custom-icon duration keeps 170ms.
 playbackDuration?:number
 systemImage?:string
 enabled?:StateSource<boolean>
 // Called in an isolated glyph leaf; return a component to subscribe to business decoration.
 icon?:(context:DockIconContext)=>VirtualNode
}
export type DockMode = {
 id:string
 interaction:"navigation"|"actions"
 width:number
 // key identifies a persistent native slot; value is its current command/navigation identity.
 slots:readonly {key:string;value:string}[]
}
export type DockMenuRequest = { value:string; origin:DockOrigin; anchor:Rect; presented:()=>void }
export type LiquidDockOptions = {
 modes?:readonly DockMode[]
 items:readonly DockItem[]
 mode?:StateSource<string>
 selection:StateSource<string>|Observable<string>
 blocked?:StateSource<boolean>
 // Navigation must synchronously write the authoritative selection if accepted. Actions use a separate callback.
 onSelectionChanged?:(value:string)=>void
 onAction?:(value:string,origin:DockOrigin|null)=>void
 // accepted holds pressure until presented(); rejected immediately releases it.
 onMenu?:(request:DockMenuRequest)=>"accepted"|"rejected"
}

const createDockModel = (input:LiquidDockOptions) => {
 const observable="read" in input.selection?undefined:input.selection
 const selection:StateSource<string>="read" in input.selection?input.selection:{
   read:()=>observable!.value,
   subscribe:notify=>{const listener=()=>notify();observable!.subscribe(listener);return()=>observable!.unsubscribe(listener)},
 }
 const options={...input,selection,onSelectionChanged:input.onSelectionChanged??(observable?(value:string)=>observable.setValue(value):undefined),mode:input.mode??createStateSource("default"),modes:input.modes??[{
   id:"default",interaction:"navigation" as const,width:Math.max(174,dockMetrics.inset*2+input.items.length*dockMetrics.height+dockMetrics.gap*(input.items.length-1)),
   slots:input.items.map(item=>({key:item.value,value:item.value})),
 }]}

 const modes=new Map<string,DockMode>(),items=new Map<string,DockItem>(),slots:string[]=[],fallbacks=new Map<string,string>()
 for(const item of options.items){if(!item.value||items.has(item.value)||(!item.icon&&!item.systemImage))throw new Error("Duplicate or empty LiquidDock item ID");items.set(item.value,{...item})}
 for(const mode of options.modes){
   if(!mode.id||modes.has(mode.id)||!mode.slots.length)throw new Error("Invalid LiquidDock mode")
   if(!Number.isFinite(mode.width)||mode.width<minimumDockWidth(mode.slots.length))throw new Error("LiquidDock items need at least 44pt")
   const keys=new Set<string>(),ids=new Set<string>()
   for(const slot of mode.slots){
     if(!slot.key||keys.has(slot.key)||ids.has(slot.value)||!items.has(slot.value))throw new Error("Invalid LiquidDock slot")
     keys.add(slot.key);ids.add(slot.value);if(!fallbacks.has(slot.key)){slots.push(slot.key);fallbacks.set(slot.key,slot.value)}
   }
   modes.set(mode.id,{...mode,slots:mode.slots.map(slot=>({...slot}))})
 }
 options.modes=[...modes.values()];options.items=[...items.values()]
 const mode=(id=options.mode.read()):DockMode=>{const value=modes.get(id);if(!value)throw new Error("Unknown LiquidDock mode: "+id);return value}
 const index=(value=mode()):number=>Math.max(0,value.slots.findIndex(slot=>slot.value===options.selection.read()))
 const enabled=(value:string):boolean=>!options.blocked?.read()&&items.get(value)?.enabled?.read()!==false
 const playback=new Map([...items.keys()].map(id=>[id,createStateSource(false)]))
 let play=(value:string):void=>{}
 const connectPlayback=():()=>void=>{
   const animated=(value:string):boolean=>!!items.get(value)?.icon&&items.get(value)?.playbackDuration!==0
   if(![...items.keys()].some(animated))return()=>{}
   let current=options.selection.read(),timer:ReturnType<typeof setTimeout>|undefined,active=true
   const reset=():void=>{clearTimeout(timer);timer=undefined;playback.forEach(source=>source.write(false))}
   const pulse=(value:string):void=>{
     reset();const source=playback.get(value);if(!source||!animated(value))return
     source.write(true);timer=setTimeout(()=>{timer=undefined;if(active)source.write(false)},items.get(value)?.playbackDuration??170)
   }
   play=pulse
   const changed=():void=>{
     const next=options.selection.read();if(next===current)return
     current=next;reset()
     if(mode().interaction!=="navigation")return
     pulse(next)
   }
   const stopFocus=options.selection.subscribe(changed),stopMode=options.mode.subscribe(()=>{current=options.selection.read();reset()})
   return()=>{active=false;if(play===pulse)play=()=>{};stopFocus();stopMode();reset()}
 }
 mode() // fail early for invalid initial mode; an absent selection deterministically uses the first slot.
 return {options,slots:slots as readonly string[],mode,index,enabled,fallback:(key:string)=>fallbacks.get(key)!,item:(id:string)=>items.get(id)!,playback,connectPlayback,play:(value:string)=>play(value)}
}
export type DockModel = ReturnType<typeof createDockModel>
declare const liquidDockBrand:unique symbol
// Opaque handle: callers own selection/commands, never raw Motion, input or playback clocks.
export type LiquidDockController = {readonly [liquidDockBrand]:true}
const models=new WeakMap<LiquidDockController,DockModel>()
export const createLiquidDock=(options:LiquidDockOptions):LiquidDockController=>{
 const controller={} as LiquidDockController
 models.set(controller,createDockModel(options));return controller
}
export const getDockModel=(controller:LiquidDockController):DockModel=>{
 const model=models.get(controller);if(!model)throw new Error("Invalid LiquidDock controller")
 return model
}
