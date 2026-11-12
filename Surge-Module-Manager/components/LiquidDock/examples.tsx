import { Button, HStack, Text, VStack, useMemo, useObservable, useState } from "scripting"
import type { VirtualNode } from "scripting"
import { createLiquidDock, LiquidDock, LiquidDockMenu, type DockAppearance, type DockMenuPresentation, type DockMenuRequest } from "./index"

// Independent consumer: official-style Observable selection, no account/theme/router imports.
export const LiquidDockDemo=({dark=false}:{dark?:boolean}):VirtualNode=>{
 const [menu,setMenu]=useState<DockMenuPresentation|null>(null)
 const open=(request:DockMenuRequest):"accepted"=>{setMenu({id:Date.now(),anchor:request.anchor,width:220,height:52,onPresented:request.presented,content:<HStack frame={{width:220,height:52}}><Text>{request.value} · 示例菜单</Text></HStack>});return "accepted"}
 const appearance=useMemo<DockAppearance>(()=>dark?{
   surface:"#292A29",foreground:"#A8ABA6",selectedSurface:"#3E443D",selectedForeground:"#D7E7CC",border:"#555A52",shadow:"#00000055",
 }:{surface:"#EEEDE7",foreground:"#77786F",selectedSurface:"#DDE5D5",selectedForeground:"#39482F",border:"#C8CCBF",shadow:"#00000018"},[dark])
 return <VStack spacing={48} padding={20} background={dark?"#20211F":"#F7F5EF"} frame={{maxWidth:Infinity,maxHeight:Infinity}} overlay={<LiquidDockMenu presentation={menu} appearance={appearance} onDismiss={()=>setMenu(null)}/>} foregroundStyle={dark?"#E3E2DA":"#35362F"}>
   <Text font={23}>LiquidDock · 独立接入</Text>
   <DemoBar count={3} appearance={appearance} onMenu={open}/>
   <DemoBar count={5} appearance={appearance} onMenu={open}/>
 </VStack>
}
const DemoBar=({count,appearance,onMenu}:{count:number;appearance:DockAppearance;onMenu:(request:DockMenuRequest)=>"accepted"}):VirtualNode=>{
 const selected=useObservable("search")
 const [dock]=useState(()=>createLiquidDock({selection:selected,
   items:[{value:"home",title:"首页",systemImage:"house"},{value:"search",title:"搜索",systemImage:"magnifyingglass"},{value:"saved",title:"收藏",systemImage:"bookmark"},
     ...(count===5?[{value:"mail",title:"收件箱",systemImage:"tray"},{value:"settings",title:"设置",systemImage:"gearshape"}]:[])],
   onMenu,
 }))
 return <VStack spacing={14}>
   <Text>{count} 个导航项 · 初始选择搜索</Text>
   <LiquidDock controller={dock} appearance={appearance} width={count===3?258:326}/>
   <Button title="外部切到收藏" action={()=>selected.setValue("saved")}/>
 </VStack>
}
