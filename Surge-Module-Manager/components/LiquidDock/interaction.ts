import { getDockModel, type DockModel, type DockOrigin, type LiquidDockController } from "./controller"
import { DockMotion } from "./DockMotion"
import { DockActionInput, DockInput, type DockTouch } from "./DockInput"
import { dockAnchor } from "./geometry"
import { scheduleUI } from "../../hooks/scheduleUI"

// One input owner and one cancellation generation for touch, fallback Buttons, and menus.
// It never knows which page/action is behind a value, nor awaits business requests.
export class DockInteraction {
 readonly motion:DockMotion
 readonly controller:DockModel
 private input:DockInput
 private actions:DockActionInput
 private pending=new Set<ReturnType<typeof setTimeout>>()
 private generation=0
 private alive=false
 private interactive=true
 private committing=false
 private stop:(()=>void)|undefined
 private layout:{width:number;modeId:string}
 constructor(handle:LiquidDockController,width:number,private origin:()=>DockOrigin|null,motion?:DockMotion){
   const controller=this.controller=getDockModel(handle),mode=controller.mode()
   this.layout={width,modeId:mode.id}
   this.motion=motion??new DockMotion(width,mode.slots.length,controller.index(mode))
   this.input=new DockInput(this.motion,i=>this.defer(()=>this.commit(i)),controller.options.onMenu?i=>this.defer(()=>this.menu(i)):undefined)
   this.actions=new DockActionInput(this.motion,i=>this.canUse(i),i=>this.defer(()=>this.commit(i)))
 }
 private canUse(index:number):boolean{
   const item=this.controller.mode().slots[index]
   return this.interactive&&!!item&&this.controller.enabled(item.value)
 }
 private clearPending(){this.generation++;this.pending.forEach(clearTimeout);this.pending.clear()}
 cancel=():void=>{
   this.clearPending();this.input.cancel();this.actions.cancel()
   const mode=this.controller.mode()
   if(this.motion.read().count===mode.slots.length)this.motion.select(this.controller.index(mode))
   this.motion.releasePress()
 }
 private defer(action:()=>void){
   const ticket=this.generation,modeId=this.controller.mode().id
   const timer=scheduleUI(()=>{this.pending.delete(timer);if(this.alive&&ticket===this.generation&&this.interactive&&this.controller.mode().id===modeId&&!this.controller.options.blocked?.read())action()})
   this.pending.add(timer)
 }
 private commit(index:number){
   const mode=this.controller.mode(),slot=mode.slots[index]
   if(!this.canUse(index)){this.motion.select(this.controller.index(mode));return}
   this.committing=true
   try {
     if(mode.interaction==="navigation")this.controller.options.onSelectionChanged?.(slot.value)
     else this.controller.options.onAction?.(slot.value,this.origin())
   }finally{
     this.committing=false
     // Business may reject a route or change modes; never assume the requested value was accepted.
     const current=this.controller.mode()
     if(current.id===mode.id)this.motion.select(this.controller.index(current))
   }
 }
 private menu(index:number,center=this.motion.read().x){
   const mode=this.controller.mode(),slot=mode.slots[index],origin=this.origin(),ticket=this.generation
   let accepted=false
   try {
     if(origin&&slot&&mode.interaction==="navigation"&&this.controller.options.selection.read()===slot.value&&this.canUse(index)){
       accepted=this.controller.options.onMenu?.({value:slot.value,origin,anchor:dockAnchor(origin.frame,center,mode.slots.length),
         presented:()=>{if(this.alive&&ticket===this.generation)this.motion.releasePress()}})==="accepted"
     }
   }finally{if(!accepted)this.motion.releasePress()}
 }
 activate=(index:number,menu=false):void=>{
   if(!this.canUse(index))return
   this.motion.rebound()
   this.defer(()=>{this.commit(index);if(menu)this.menu(index,this.motion.slot(index))})
 }
 receive=(event:DockTouch):boolean=>{
   const mode=this.controller.mode(),layout=this.motion.read()
   if(!this.alive||!this.interactive||this.controller.options.blocked?.read())return false
   if(event.phase==="began"&&(mode.id!==this.layout.modeId||layout.width!==this.layout.width||layout.count!==mode.slots.length))return false
   const accepted=mode.interaction==="actions"?this.actions.receive(event):this.input.receive(event,this.controller.index(mode))
   if(accepted&&mode.interaction==="navigation"){
     if(event.phase==="began")this.clearPending()
     else if(event.phase==="cancelled")this.cancel()
   }
   return accepted
 }
 update(width:number,modeId:string,interactive:boolean){
   const changed=this.layout.width!==width||this.layout.modeId!==modeId||this.interactive!==interactive
   this.layout={width,modeId};this.interactive=interactive
   if(changed){this.cancel();const mode=this.controller.mode(modeId);this.motion.resize(width,mode.slots.length,this.controller.index(mode))}
 }
 connect=():()=>void=>{
   this.alive=true
   const {options}=this.controller
   const sync=()=>{if(!this.committing)this.cancel();if(this.controller.mode().interaction==="navigation")this.motion.select(this.controller.index())}
   const stops=[options.selection.subscribe(sync),options.mode.subscribe(this.cancel)]
   if(options.blocked)stops.push(options.blocked.subscribe(()=>{if(options.blocked?.read())this.cancel()}))
   this.stop=()=>stops.forEach(stop=>stop())
   return()=>this.dispose()
 }
 dispose=():void=>{
   this.alive=false;this.stop?.();this.stop=undefined;this.cancel();this.motion.dispose()
 }
}
