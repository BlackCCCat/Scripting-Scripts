# AnchoredMenu

基础用法只需要presentation中的anchor/width/height/content，以及onDismiss。展示ID、外观和onPresented握手均可省略。

独立的上方锚点菜单；没有 Tab、账号或主题依赖。原生插值负责缩放与位移。设计见 [DESIGN.md](DESIGN.md)。

```tsx
import { Button, GeometryReader, RoundedRectangle, ZStack, useState } from "scripting"
import { AnchoredMenu, type MenuPresentation } from "./src/components/AnchoredMenu"
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
```

实际按钮可用全局 GeometryReader ref 测量 anchor。透明关闭面应覆盖整个可操作视口；菜单内容要自行提供整行 `frame/contentShape` 命中面。不要把该组件放进一个小按钮自身的 overlay，否则会限制关闭面范围。

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| presentation | 必填，可为null | 本轮菜单或关闭状态 |
| surface | 系统背景／分隔边线 | 装饰背景VNode；可用原生玻璃/普通形状，调用方禁用背景命中 |
| onDismiss | 必填 | 外部点击或打开后视口尺寸变化时请求关闭；宿主将presentation置null |
| openMotion | spring 0.42s，bounce约0.225 | 原生Animation工厂 |
| closeMotion | easeOut 0.18s | 原生Animation工厂 |

presentation字段：可选`id`(string/number)、`anchor`(全局Rect)、`width/height`(pt)、`content`(VNode)、可选`onPresented`(回调)。省略id时，关闭后重开会自动生成新身份，同次展示更新内容则保留身份。需要在不经过null渲染的情况下直接替换菜单时显式提供不同id。尺寸须为正数并小于视口减去32pt；组件限位位置，不裁剪或压缩内容尺寸。顶部/侧边距16pt，锚点间距10pt。默认菜单以锚点在底边的投影为缩放中心。

挂载后下一轮UI提交shown，内容开始可见时通知可选onPresented；它不是动画完成通知。宿主应使回调幂等（同ID更新presentation可再次通知），提前取消时也要解除自身按压握手。关闭立即禁止命中和辅助功能，上一份树常驻以完成淡出。卸载取消调度并使已排主线程回调失效。业务动作、震动、删除确认、返回键及多浮层互斥由调用者管理。

复制组件目录与`src/hooks/scheduleUI.ts`到Scripting脚本。`index.ts`导出组件、props及presentation类型。`LiquidDockMenu`兼容层提供DockSurface材质；其他消费者直接使用AnchoredMenu，不需引入LiquidDock。

## 与测量入口组合

[examples.tsx](examples.tsx)中的BasicMenuExample组合已有MeasuredSource：点击按钮直接使用其全局frame打开菜单。无需自己写GeometryReader、ID生成器、背景或空握手回调。只有与Tab保压等行为联动时才传onPresented；调用方业务仍控制开关和菜单内容。
