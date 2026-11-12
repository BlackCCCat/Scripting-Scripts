// Self-contained README example; compiled by project typecheck.
import { Button, GeometryReader, RoundedRectangle, Text, ZStack, useState } from "scripting"
import { MeasuredSource } from "../MeasuredSource"
import { AnchoredMenu, type MenuPresentation } from "./index"
export function MenuExample() {
  const [menu, setMenu] = useState<MenuPresentation | null>(null)
  return <GeometryReader coordinateSpaces={["global"]}>{g => <ZStack
    frame={g.size} overlay={<AnchoredMenu presentation={menu}
      surface={<RoundedRectangle cornerRadius={22} fill="#F7F5EE" allowsHitTesting={false} />}
      onDismiss={() => setMenu(null)} />}>
    <Button title="菜单" action={() => {
      const viewport = g.frame("global")
      setMenu({ id: Date.now(), anchor: { x: viewport.x + g.size.width / 2 - 40,
        y: viewport.y + g.size.height / 2 - 22, width: 80, height: 44 },
        width: 220, height: 52, onPresented() {},
        content: <Button title="关闭菜单" frame={{ width: 220, height: 52 }}
          action={() => setMenu(null)} /> })
    }} />
  </ZStack>}</GeometryReader>
}

export function BasicMenuExample() {
 const [menu, setMenu] = useState<MenuPresentation | null>(null)
 return <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
  <MeasuredSource label="更多" onActivate={({ frame }) => setMenu({ anchor: frame, width: 220, height: 52,
   content: <Button title="关闭菜单" action={() => setMenu(null)} frame={{ width: 220, height: 52 }} contentShape="rect"/>,
  })}><Text padding={16}>更多</Text></MeasuredSource>
  <AnchoredMenu presentation={menu} onDismiss={() => setMenu(null)}/>
 </ZStack>
}
