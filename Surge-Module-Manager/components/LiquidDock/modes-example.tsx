import { Button, Text, VStack, useObservable, useState } from "scripting"
import type { VirtualNode } from "scripting"
import { createLiquidDock, LiquidDock, type DockAppearance } from "./index"
import { createStateSource } from "../../shared/EventBus"
const appearance: DockAppearance = { surface: "#EEEDE7", foreground: "#77786F", selectedSurface: "#DDE5D5",
 selectedForeground: "#39482F", border: "#C8CCBF", shadow: "#00000018" }
export function DockModesExample(): VirtualNode {
 const selection = useObservable("home")
 const [mode] = useState(() => createStateSource("navigation"))
 const [message, setMessage] = useState("")
 const [dock] = useState(() => createLiquidDock({ selection, mode,
   items: [
     { value: "home", title: "首页", systemImage: "house" }, { value: "profile", title: "资料", systemImage: "person" },
     { value: "back", title: "退出编辑", systemImage: "arrow.backward" }, { value: "selectAll", title: "全选", systemImage: "checklist" },
     { value: "reload", title: "刷新", systemImage: "arrow.clockwise" }, { value: "remove", title: "删除", systemImage: "trash" },
   ], modes: [
     { id: "navigation", interaction: "navigation", width: 174, slots: [{ key: "leading", value: "home" }, { key: "trailing", value: "profile" }] },
     { id: "actions", interaction: "actions", width: 258, slots: [{ key: "leading", value: "back" }, { key: "select", value: "selectAll" }, { key: "refresh", value: "reload" }, { key: "trailing", value: "remove" }] },
   ], onAction: value => { if (value === "back") mode.write("navigation"); else setMessage(`示例动作：${value}`) },
 }))
 return <VStack spacing={20}>
   <Text>{message || "业务命令由宿主管理"}</Text>
   <Button title="进入操作模式" action={() => mode.write("actions")}/>
   <LiquidDock controller={dock} appearance={appearance}/>
 </VStack>
}
