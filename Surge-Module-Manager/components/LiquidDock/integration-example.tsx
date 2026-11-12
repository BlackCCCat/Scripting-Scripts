import { Button, GeometryReader, Spacer, Text, VStack, ZStack, useObservable, useRef, useState } from "scripting"
import type { Rect, VirtualNode } from "scripting"
import { createLiquidDock, LiquidDock, LiquidDockMenu, LiquidDockPreview } from "./index"
import type { DockAppearance, DockMenuPresentation, DockMenuRequest, DockOrigin } from "./index"
import { MorphSurface } from "../MorphSurface"

const palette: DockAppearance = { surface: "#EEEDE7", foreground: "#77786F", selectedSurface: "#DDE5D5",
 selectedForeground: "#39482F", border: "#C8CCBF", shadow: "#00000018" }

// Complete menu → independent confirmation → live dock handoff; no account code.
export function DockMenuMorphExample(): VirtualNode {
 const selection = useObservable("home")
 const [menu, setMenu] = useState<DockMenuPresentation | null>(null)
 const [moving, setMoving] = useState<DockOrigin | null>(null)
 const close = useRef<() => void>(() => {})
 const viewport = useRef<Rect>({ x: 0, y: 0, width: 375, height: 700 })
 const handshake = useRef<(() => void) | null>(null)
 const dismiss = (): void => { handshake.current?.(); handshake.current = null; setMenu(null) }
 const present = (request: DockMenuRequest): "accepted" => {
   handshake.current?.()
   handshake.current = request.presented
   setMenu({ id: Date.now(), anchor: request.anchor, width: 220, height: 52,
     onPresented: () => { request.presented(); if (handshake.current === request.presented) handshake.current = null },
     content: <Button accessibilityLabel="打开确认卡片" buttonStyle="plain" action={() => { dismiss(); setMoving(request.origin) }}>
       <Text frame={{ width: 220, height: 52 }} contentShape="rect">打开确认卡片</Text>
     </Button> })
   return "accepted"
 }
 const [dock] = useState(() => createLiquidDock({ selection, items: [
   { value: "home", title: "首页", systemImage: "house" },
   { value: "account", title: "账号", systemImage: "person" },
 ], onMenu: present }))
 const local = (rect: Rect): Rect => ({ ...rect, x: rect.x - viewport.current.x, y: rect.y - viewport.current.y })
 return <GeometryReader coordinateSpaces={["global"]}>{g => {
   viewport.current = g.frame("global")
   return <ZStack alignment="topLeading" frame={g.size} background="#F7F5EF" foregroundStyle="#35362F">
     <VStack frame={g.size} padding={16}>
       <Text>长按底栏，选择打开确认卡片</Text><Spacer />
       <LiquidDock controller={dock} appearance={palette} width={174} interactive={!moving} opacity={moving ? 0 : 1}/>
     </VStack>
     <LiquidDockMenu presentation={menu} appearance={palette} onDismiss={dismiss}/>
     {moving ? <MorphSurface origin={{ frame: local(moving.frame), current: () => local(moving.current()), radius: 32,
       surface: { fill: palette.surface, border: palette.border, glass: true, shadow: { color: palette.shadow, radius: 14, y: 6 } } }}
       target={{ frame: { x: 20, y: Math.max(20, (g.size.height - 180) / 2), width: g.size.width - 40, height: 180 },
         surface: { fill: "#F9F6EE", border: palette.border, shadow: { color: palette.shadow, radius: 24, y: 12 } } }}
       viewport={{ ...g.size, x: 0, y: 0 }} reversible={false}
       preview={(_returning, frame) => <LiquidDockPreview controller={dock} appearance={palette} width={frame.width} decorated/>}
       bindClose={action => { close.current = action }} onClosed={() => setMoving(null)}>
       <VStack spacing={20} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
         <Text>由同一个底栏表面变形而来</Text>
         <Button title="返回" action={() => close.current()}/>
       </VStack>
     </MorphSurface> : null}
   </ZStack>
 }}</GeometryReader>
}
