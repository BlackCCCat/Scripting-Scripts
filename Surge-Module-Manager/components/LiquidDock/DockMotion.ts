import { dockGeometry } from "./geometry"
// Telegram TabBarComponent：触摸直接跟手，释放后局部弹簧吸附。
// Scripting 无 LiquidLens 私有接口；方向形变与原生玻璃共用同一份几何。
import { dockPressure, liquidDeformation, telegramDock } from "./DockTuning"
export type DockFrame = { x: number; stretch: number; skew:number; press: number; railScale:number; width:number; count:number }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
// CAAnimationUtils 的 cubic-bezier：输入是时间 x，必须先求参数 t，不能直接把时间代入 y。
function travel(p:number) {
 const [x1,y1,x2,y2]=telegramDock.curve
 const sample=(t:number,a:number,b:number)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t
 const derivative=(t:number,a:number,b:number)=>3*(1-t)*(1-t)*a+6*(1-t)*t*(b-a)+3*t*t*(1-b)
 let lo=0,hi=1,t=p
 for(let i=0;i<24;i++){
   const x=sample(t,x1,x2)
   if(Math.abs(x-p)<1e-9)break
   if(x<p)lo=t;else hi=t
   const next=t-(x-p)/derivative(t,x1,x2)
   t=next>lo&&next<hi?next:(lo+hi)/2
 }
 return {value:sample(t,y1,y2),velocity:derivative(t,y1,y2)/derivative(t,x1,x2)}
}
// 阻尼弹簧的解析解，长帧也按真实时间推进，不增加第二个按压时钟。
function springStep(position:number,velocity:number,target:number,dt:number,frequency=28,damping=.78) {
 const decay=frequency*damping,wave=frequency*Math.sqrt(1-damping*damping)
 const distance=position-target,envelope=Math.exp(-decay*dt),sin=Math.sin(wave*dt),cos=Math.cos(wave*dt)
 const next=target+envelope*(distance*cos+(velocity+decay*distance)/wave*sin)
 const speed=envelope*(velocity*cos-(decay*velocity+frequency*frequency*distance)/wave*sin)
 return Math.abs(next-target)<.00005&&Math.abs(speed)<.001?{position:target,velocity:0}:{position:next,velocity:speed}
}
// 旧速度在短交接内自然归零，起点导数为1、终点导数为0，避免改向时突然刹停。
const handoff=(elapsed:number,duration:number)=>{
 const p=Math.min(1,elapsed/duration)
 return {value:duration*p*(1-p)*(1-p),velocity:(1-p)*(1-3*p)}
}


export class DockMotion {
 private listeners = new Set<() => void>()
 private snapshot: DockFrame
 private geometry:ReturnType<typeof dockGeometry>
 private selected: number
 private target: number
 private flight: { from:number; carryVelocity:number; elapsed:number } | null = null
 private velocity=0
 private dragVelocity=0
 private shapeVelocity=0
 private skewVelocity=0
 private relaxingShape=false
 private gesture: { start:number; anchor:number; candidate:number; moved:boolean } | null = null
 private down = false
 private pressVelocity = 0
 private railFallback:ReturnType<typeof setTimeout>|undefined
 private timer: ReturnType<typeof setTimeout> | undefined
 private last = 0
 constructor(private width:number, private count:number, selected:number) {
   this.geometry=dockGeometry(width,count)
   this.selected=selected; this.target=this.slot(selected)
   this.snapshot={x:this.target,stretch:0,skew:0,press:1,railScale:1,width,count}
 }
 private get step() { return this.geometry.step }
 slot(index:number) { return this.geometry.center(index) }
 hit(x:number):number|null { return x<0||x>this.width?null:clamp(Math.round((x-this.slot(0))/this.step),0,this.count-1) }
 read=():DockFrame=>this.snapshot
 subscribe=(fn:()=>void):(()=>void)=>{this.listeners.add(fn);this.run();return()=>{this.listeners.delete(fn);if(!this.listeners.size)this.stop()}}
 private publish(next:DockFrame) {
   const old=this.snapshot
   if(old.x===next.x&&old.stretch===next.stretch&&old.skew===next.skew&&old.press===next.press&&old.railScale===next.railScale&&old.width===next.width&&old.count===next.count)return
   this.snapshot=next;[...this.listeners].forEach(fn=>fn())
 }
 private animate(target:number,inheritVelocity=false) {
   if(this.flight&&Math.abs(target-this.target)<0.01)return
   const moving=inheritVelocity||!!this.flight||Math.abs(this.velocity)>.1
   this.target=target
   const {x,stretch,skew}=this.snapshot
   if(Math.abs(target-x)<0.02&&Math.abs(stretch)<.001&&Math.abs(skew)<.001&&Math.abs(this.velocity)<.1&&Math.abs(this.shapeVelocity)<.001&&Math.abs(this.skewVelocity)<.001){this.flight=null;this.velocity=0;this.shapeVelocity=0;this.skewVelocity=0;this.publish({...this.snapshot,x:target,stretch:0,skew:0});return}
   const initialSpeed=(target-x)*travel(0).velocity/telegramDock.duration
   this.flight={from:x,carryVelocity:moving?this.velocity-initialSpeed:0,elapsed:0}
   this.run()
 }
 select(index:number) {
   this.selected=clamp(index,0,this.count-1)
   this.gesture=null
   this.animate(this.slot(this.selected))
 }
 resize(width:number,count=this.count,selected=this.selected) {
   if(width===this.width&&count===this.count)return
   this.geometry=dockGeometry(width,count)
   this.width=width;this.count=count;this.selected=clamp(selected,0,count-1)
   this.gesture=null;this.flight=null;this.down=false;this.relaxingShape=false
   // 布局本身使用原生宽度动画，不在 resize 里再启动第二个 JS 飞行。
   this.target=this.slot(this.selected)
   this.pressVelocity=0;this.velocity=0;this.dragVelocity=0;this.shapeVelocity=0;this.skewVelocity=0
   this.publish({...this.snapshot,x:this.target,stretch:0,skew:0,press:1,width:this.width,count:this.count});this.stop();this.run()
 }
 begin(x:number,committedIndex=this.selected) {
   const candidate=this.hit(x)
   if(candidate===null)return
   // 新一轮取消时回到真实页面，不沿用上一轮尚未提交的临时选中。
   this.selected=clamp(committedIndex,0,this.count-1)
   this.dragVelocity=0
   this.gesture={start:x,anchor:this.slot(candidate),candidate,moved:false}
   this.down=true;this.pressRail(true)
   this.animate(this.slot(candidate));this.run()
 }
 move(x:number,velocity=0) {
   const g=this.gesture;if(!g)return
   const hit=this.hit(x);if(hit!==null)g.candidate=hit
   const delta=x-g.start
   if(!g.moved){if(Math.abs(delta)<10)return;g.moved=true;g.anchor=this.snapshot.x-delta;this.flight=null}
   const raw=g.anchor+delta,min=this.slot(0),max=this.slot(this.count-1)
   const next=raw<min?min+(raw-min)*.18:raw>max?max+(raw-max)*.18:raw
   // 原生速度仅影响当前镜片的惯性和材质；不预测跨槽、不提前提交路由。
   this.velocity=Number.isFinite(velocity)?clamp(velocity,-this.step*12,this.step*12)*(raw<min||raw>max?.18:1):0
   this.dragVelocity=this.velocity;this.relaxingShape=true
   this.target=next;this.publish({...this.snapshot,x:next});this.run()
 }
 private finish(cancel:boolean,x:number|undefined,release:boolean,velocity?:number):number {
   const g=this.gesture
   if(g&&!cancel){const hit=x===undefined?null:this.hit(x);this.selected=hit??g.candidate}
   if(g?.moved&&!cancel&&velocity!==undefined&&Number.isFinite(velocity))this.velocity=clamp(velocity,-this.step*12,this.step*12)
   if(cancel)this.velocity=0
   this.dragVelocity=0
   this.gesture=null;if(release){this.down=false;this.pressRail(false)}
   this.animate(this.slot(this.selected),!!g?.moved);this.run()
   return this.selected
 }
 end(cancel=false,x?:number,velocity?:number):number {return this.finish(cancel,x,true,velocity)}
 hold():number {return this.finish(false,undefined,false)}
 advance(dt:number) {
   if(!Number.isFinite(dt)||dt<=0)return
   let {x,stretch,skew,press}=this.snapshot
   const pressure=springStep(press,this.pressVelocity,this.down?1.075:1,dt)
   press=pressure.position;this.pressVelocity=pressure.velocity
   // 用位移的实际速度驱动同一个材质弹簧，点击、跟手、吸附及改向不重播形变时间表。
   // 子步只积分本地数值，整帧仍只通知一次；长帧不会跳过到位回弹。
   let remaining=Math.min(dt,4)
   while(remaining>1e-9){
     const step=Math.min(remaining,1/120)
     remaining-=step
     const f=this.flight
     if(f){
       f.elapsed=Math.min(telegramDock.duration,f.elapsed+step)
       const p=f.elapsed/telegramDock.duration,position=travel(p),carry=handoff(f.elapsed,.08)
       x=p>=1?this.target:f.from+(this.target-f.from)*position.value+f.carryVelocity*carry.value
       this.velocity=p>=1?0:(this.target-f.from)*position.velocity/telegramDock.duration+f.carryVelocity*carry.velocity
       if(p>=1)this.flight=null
     }else if(this.gesture?.moved){
       this.dragVelocity*=Math.exp(-step/.07)
       if(Math.abs(this.dragVelocity)<1)this.dragVelocity=0
       this.velocity=this.dragVelocity
     }else {this.velocity=0;this.dragVelocity=0}
     const target=clamp(Math.abs(this.velocity)/this.step*liquidDeformation.velocityScale,0,liquidDeformation.maxStretch)
     const shape=springStep(stretch,this.shapeVelocity,target,step,liquidDeformation.frequency,liquidDeformation.damping)
     stretch=shape.position;this.shapeVelocity=shape.velocity
     // 后缘承担80%的宽度变化，前缘20%；换向保留位置与速度，不直接翻转偏心。
     const bias=springStep(skew,this.skewVelocity,target===0?0:-Math.sign(this.velocity)*.3*target,step,liquidDeformation.frequency,liquidDeformation.damping)
     skew=bias.position;this.skewVelocity=bias.velocity
     // 低于0.12pt的余振停止采样，避免为不可见的材质尾巴持续穿过 JS/原生桥。
     if(target===0&&Math.abs(stretch)<.0015&&Math.abs(this.shapeVelocity)<.02){stretch=0;this.shapeVelocity=0}
     if(target===0&&Math.abs(skew)<.0015&&Math.abs(this.skewVelocity)<.02){skew=0;this.skewVelocity=0}
   }
   this.relaxingShape=stretch!==0||this.shapeVelocity!==0||skew!==0||this.skewVelocity!==0||this.dragVelocity!==0
   this.publish({...this.snapshot,x,stretch,skew,press,width:this.width,count:this.count})
 }
 // 目标值立即交给原生弹簧；实际输入按began/end驱动，辅助功能点击使用短暂保压降级。
 pressRail(down:boolean){clearTimeout(this.railFallback);this.railFallback=undefined;this.publish({...this.snapshot,railScale:down?dockPressure.railScale:1})}
 rebound(){this.pressRail(true);this.railFallback=setTimeout(()=>this.pressRail(false),70)}
 releasePress(){this.down=false;this.pressRail(false);this.run()}
 private active(){return !!this.flight||this.relaxingShape||this.snapshot.press!==(this.down?1.075:1)||this.pressVelocity!==0}
 private run(){
   if(this.timer!==undefined||!this.listeners.size||!this.active())return
   this.last=Date.now()
   const tick=()=>{this.timer=undefined;const now=Date.now();this.advance(Math.max(.001,(now-this.last)/1000));this.last=now;if(this.active()&&this.listeners.size)this.timer=setTimeout(tick,16)}
   this.timer=setTimeout(tick,16)
 }
 private stop(){if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined}
 dispose(){clearTimeout(this.railFallback);this.stop();this.down=false;this.flight=null;this.gesture=null;this.relaxingShape=false;this.listeners.clear()}
}
