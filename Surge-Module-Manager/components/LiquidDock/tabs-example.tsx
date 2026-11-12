import { Button, Image, Text, VStack, useState } from "scripting"
import type { VirtualNode } from "scripting"
import { createLiquidTabs, LiquidTabs, type DockAppearance, type LiquidTabsController } from "./index"

export const tabsExampleAppearance: DockAppearance = {
 surface: "secondarySystemBackground", foreground: "secondaryLabel", selectedSurface: "tertiarySystemBackground",
 selectedForeground: "label", border: "separator", shadow: "#00000018",
}
// Self-contained consumer: no accounts, transport, theme singleton or coordinate bookkeeping.
export function createTabsExample(): LiquidTabsController {
 const tabs = createLiquidTabs({
  pages: [
   { value: "home", title: "首页", systemImage: "house", content: <ExamplePage title="首页" edit={() => tabs.showBar("edit")}/> },
   { value: "saved", title: "收藏", icon: ({ color }) => <Image systemName="bookmark" font={22} foregroundStyle={color}/>,
    iconAnimation: { render: ({ active, icon }) => <VStack scaleEffect={active ? 0.78 : 1} rotationEffect={active ? -12 : 0}
     animation={{ animation: active ? Animation.easeOut(0.17) : Animation.spring({ duration: 0.5, bounce: 0.26 }), value: active }}>{icon}</VStack> },
    content: <ExamplePage title="收藏" edit={() => tabs.showBar("edit")}/> },
   { value: "account", title: "账号", systemImage: "person", content: <ExamplePage title="账号" edit={() => tabs.showBar("edit")}/> },
  ],
  actions: [
   { value: "back", title: "退出编辑", systemImage: "arrow.left", onPress: ({ tabs }) => tabs.showBar("main") },
   { value: "all", title: "全选", systemImage: "checkmark.circle", onPress: ({ tabs }) => tabs.present("selection") },
   { value: "refresh", title: "刷新", systemImage: "arrow.clockwise", onPress: ({ tabs }) => { tabs.showBar("main"); tabs.present("refresh") } },
   { value: "delete", title: "删除", systemImage: "trash", onPress: ({ tabs }) => tabs.present("confirm") },
  ],
  bars: [{ value: "main", items: ["home", "saved", "account"], width: 234 },
   { value: "edit", items: ["back", "all", "refresh", "delete"], width: 282 }],
  surfaces: [
   { value: "selection", size: { width: 320, height: 180 }, content: ({ close }) => <ExampleSurface title="全选操作" close={close}/> },
   { value: "refresh", size: { width: 320, height: 180 }, content: ({ close }) => <ExampleSurface title="刷新操作" close={close}/> },
   { value: "confirm", size: { width: 320, height: 200 }, content: ({ close, tabs }) => <VStack spacing={24} padding={24}>
    <Text font={20} fontWeight="semibold">确认操作</Text>
    <Button title="取消" action={close}/>
    <Button title="确认并返回主栏" action={() => { tabs.showBar("main"); close() }}/>
   </VStack> },
  ],
 })
 return tabs
}
const ExamplePage = ({ title, edit }: { title: string; edit: () => void }): VirtualNode => {
 const [count, setCount] = useState(0)
 return <VStack spacing={24} padding={24} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
  <Text font={30} fontWeight="semibold">{title}</Text>
  <Text>切页保留本页计数 · {count}</Text>
  <Button title="本页计数 +1" action={() => setCount(value => value + 1)}/>
  <Button title="编辑工具栏" action={edit}/>
 </VStack>
}
const ExampleSurface = ({ title, close }: { title: string; close: () => void }): VirtualNode => <VStack spacing={28} padding={28}>
 <Text font={20} fontWeight="semibold">{title}</Text><Button title="返回" action={close}/>
</VStack>
export function TabsConsumerExample(): VirtualNode {
 const [tabs] = useState(createTabsExample)
 return <LiquidTabs controller={tabs} appearance={tabsExampleAppearance}/>
}

// Minimal usage has no palette, playback, action bar or morph registry to learn.
export function BasicTabsExample(): VirtualNode {
 const [tabs] = useState(() => createLiquidTabs({ pages: [
  { value: "home", title: "首页", systemImage: "house", content: <Text>首页</Text> },
  { value: "saved", title: "收藏", systemImage: "bookmark", content: <Text>收藏</Text> },
 ] }))
 return <LiquidTabs controller={tabs}/>
}

// Supply only a native Image source; no font, frame, slot width or aspect calculation.
export function ImageTabsExample({ filePath }: { filePath: string }): VirtualNode {
 const [tabs] = useState(() => createLiquidTabs({ pages: [
  { value: "home", title: "首页", systemImage: "house", content: <Text>SF Symbols</Text> },
  { value: "image", title: "图片", image: { filePath }, content: <Text>原生 Image</Text> },
 ] }))
 return <LiquidTabs controller={tabs}/>
}
