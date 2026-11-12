import type { DockMotion } from "./DockMotion"
import { telegramDock } from "./DockTuning"
export type DockTouch = { touchId:string; phase:"began"|"moved"|"ended"|"cancelled"; location:{x:number;y:number}; velocity?:{width:number;height:number} }
// 只识别输入；调用者把提交／菜单投递到 scheduleUI，不在 UIKit 事件栈内操作业务。
export class DockInput {
 private owner:string|null=null
 private start={x:0,y:0}
 private holdTimer:ReturnType<typeof setTimeout>|undefined
 private held=false
 private axis:"pending"|"horizontal"|"vertical"="pending"
 private disposed=false
 constructor(private motion:DockMotion,private commit:(index:number)=>void,private hold?:(index:number)=>void){}
 private clearHold(){if(this.holdTimer!==undefined)clearTimeout(this.holdTimer);this.holdTimer=undefined}
 receive(event:DockTouch,committedIndex?:number):boolean{
   if(this.disposed)return false
   const {x,y}=event.location
   if(event.phase==="began"){
     if(this.owner!==null||y<0||y>64||this.motion.hit(x)===null)return false
     this.owner=event.touchId;this.start={x,y};this.axis="pending";this.held=false;this.motion.begin(x,committedIndex)
     if(this.hold)this.holdTimer=setTimeout(()=>{
       this.holdTimer=undefined;if(this.owner!==event.touchId)return
       this.held=true;const index=this.motion.hold();this.commit(index);this.hold?.(index)
     },telegramDock.contextHoldMs)
     return true
   }
   if(this.owner!==event.touchId)return false
   if(this.held){
     if(event.phase==="ended"||event.phase==="cancelled"){this.owner=null;this.held=false}
     return true
   }
   if(event.phase==="moved"){
     if(Math.hypot(x-this.start.x,y-this.start.y)>=10){
       this.clearHold()
       if(this.axis==="pending")this.axis=Math.abs(y-this.start.y)>Math.abs(x-this.start.x)?"vertical":"horizontal"
     }
     // 水平手势一旦接管，快速反向时短暂越过上下边缘不能永久取消。
     // 接管后允许在条外松手吸附；真正纵向起手仍保持取消语义。
     if(this.axis==="pending"&&(y<0||y>64))this.axis="vertical"
     if(this.axis==="vertical"){this.motion.end(true);this.clearHold()}
     else this.motion.move(x,event.velocity?.width)
     return true
   }
   this.clearHold();this.owner=null
   const outside=y<0||y>64||this.motion.hit(x)===null
   const cancel=event.phase==="cancelled"||this.axis==="vertical"||(this.axis!=="horizontal"&&outside)
   const releaseX=this.axis==="horizontal"?Math.max(0,Math.min(this.motion.read().width,x)):x
   const index=this.motion.end(cancel,releaseX,event.velocity?.width)
   if(!cancel)this.commit(index)
   return true
 }
 cancel(){this.clearHold();this.owner=null;this.axis="pending";this.held=false;this.motion.end(true)}
 dispose(){this.cancel();this.disposed=true}
}

// 编辑键只在原位置抬手提交；划过刷新／删除不执行，副手指不抢占按压。
export class DockActionInput {
 private touch:{id:string;index:number;x:number;y:number;valid:boolean}|null=null
 private disposed=false
 constructor(private motion:DockMotion,private enabled:(index:number)=>boolean,private commit:(index:number)=>void){}
 receive(event:DockTouch):boolean{
   if(this.disposed)return false
   const {x,y}=event.location
   if(event.phase==="began"){
     const index=this.motion.hit(x)
     if(this.touch||index===null||y<0||y>64||!this.enabled(index))return false
     this.touch={id:event.touchId,index,x,y,valid:true};this.motion.pressRail(true);return true
   }
   const touch=this.touch
   if(!touch||touch.id!==event.touchId)return false
   if(event.phase==="moved"){
     if(Math.hypot(x-touch.x,y-touch.y)>10||this.motion.hit(x)!==touch.index||y<0||y>64){touch.valid=false;this.motion.pressRail(false)}
   }else{
     this.cancel()
     if(touch.valid&&event.phase==="ended"&&this.motion.hit(x)===touch.index&&y>=0&&y<=64&&this.enabled(touch.index))this.commit(touch.index)
   }
   return true
 }
 cancel(){this.touch=null;this.motion.pressRail(false)}
 dispose(){this.cancel();this.disposed=true}
}
