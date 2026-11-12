# MorphSurface

一个来源表面连续移动、缩放、改变圆角成为目标表面；关闭时返回来源的最新矩形。组件不导入账号、业务主题、网络、震动或蒙层控制器。完整状态设计见 [DESIGN.md](DESIGN.md)。

## 常用入口：MorphCard

只提供入口内容与展开内容。测量、来源隐藏、打开状态、关闭绑定及原生完成交接由组件负责。

```tsx
import { Button, Text } from "scripting"
import { MorphCard } from "./src/components/MorphSurface"

export function SimpleExample() {
  return <MorphCard source={<Text>查看详情</Text>} label="查看详情"
    content={close => <Button title="关闭" action={close} />} />
}
```

| 参数 | 默认 | 用途 |
| --- | --- | --- |
| source | 必需 | 入口展示内容；组件已包Button，不要再传交互按钮 |
| content(close) | 必需 | 展开内容；调用close请求回缩，不需要绑定ref |
| label | 打开详情 | 入口的辅助功能名称 |
| size | 最大420×320pt | 目标尺寸，宽高分别可省略；按容器尺寸收至四边至少16pt |
| surface | 系统语义背景与边线 | 填色、边框、阴影；项目主题由调用方按需映射 |
| layout(source) | 入口居中 | 把组件生成的入口节点放进自己的排布；只放一次 |

MorphCard占满父容器给定的空间，详情在这个空间内居中；应放在页面或明确给定尺寸的展示区域，**不要直接作为列表中每一行的自动全屏详情**。来源可放在layout内的ScrollView中，隐藏时保留占位并继续测量最新位置。外部页面内容放在layout回调中返回，开合只通知入口与浮层；不能在layout/content回调内调用hook，需要状态时返回独立组件。

它不获取物理屏幕大小、不自动越过祖先裁剪、不加全屏蒙层、不管理多个独立容器的互斥。source应为可重复呈现的摘要；它也用于回缩预览。内容工厂在一次展示内保持缓存（content本身变更时更新），其close属于该次展示；旧close不能关闭下一张目标。需要跨页面坐标、独立来源/目标材质、菜单变形、动态高度或列表插入的流程，使用下面的MorphSurface接口。业务层原有AccountExpansion继续使用该高级入口，不改变现有复杂交接。

默认使用系统语义颜色，随系统浅深外观解析，不读取项目主题。自包含可编译例子见[examples.tsx](examples.tsx)。新增依赖为通用MeasuredSource、shared/EventBus及hooks/useBusState；连同下文基础hook一起携带。没有要求调用方新建控制器或订阅source。内容工厂使用显式content属性，避免Scripting对自定义组件children的节点归一化改变函数类型。

## 高级入口：MorphSurface

```tsx
import { Button, GeometryReader, ZStack, Text, useRef, useState } from "scripting"
import { MorphSurface } from "./src/components/MorphSurface"

export function Example() {
  const [open, setOpen] = useState(false)
  const close = useRef<() => void>(() => {})
  const surface = { fill: "#FAF7F0" as const, border: "#D4CBBE" as const,
    shadow: { color: "#00000020" as const, radius: 18, y: 6 } }
  return <GeometryReader>{g => {
    // 全部矩形在这个 GeometryReader 的局部坐标中。
    const frame = { x: 24, y: 60, width: 160, height: 52 }
    return <ZStack alignment="topLeading" frame={g.size}>
      <Button title="打开" action={() => setOpen(true)} opacity={open ? 0 : 1}
        disabled={open} frame={{ width: frame.width, height: frame.height }}
        offset={{ x: frame.x, y: frame.y }} />
      {open ? <MorphSurface origin={{ frame, current: () => frame, radius: 26 }}
        target={{ frame: { x: 16, y: 140, width: Math.max(0, g.size.width - 32), height: 220 }, surface }}
        viewport={{ ...g.size, x: 0, y: 0 }} preview={<Text>打开</Text>}
        bindClose={action => { close.current = action }} onClosed={() => setOpen(false)}>
        <Button title="关闭" action={() => close.current()} />
      </MorphSurface> : null}
    </ZStack>
  }}</GeometryReader>
}
```

实际来源会滚动/改变位置时，将 `current` 接到实时测量ref；不要返回首次点击时冻结的矩形。全局与局部坐标必须先由宿主统一。viewport的x/y只用于浮层宿主偏移，不自动转换origin/target。来源节点由调用方隐藏并保留占位，动画结束后才恢复。

## 接口

| 参数 | 必需 / 默认 | 说明 |
| --- | --- | --- |
| origin | 必需 | `{frame,current,radius?,surface?}`；初始矩形、动态返回读取；radius默认24，surface默认继承target |
| target | 必需 | `{frame,radius?,surface}`；radius默认28。挂载期间可随内容尺寸更新 |
| viewport | 必需 | 当前浮层局部尺寸与宿主偏移 `{x,y,width,height}` |
| preview | 必需 | 原内容或`(returning,frame)=>VNode`；只读，不参与点击 |
| children | 必需 | 展开内容；折叠时关闭命中和辅助功能 |
| bindClose | 必需 | 每次渲染提供当前关闭函数；保存到ref，关闭事件调用它 |
| onClosed | 必需 | 原生removed完成后调用；调用方在此卸载表面、交还来源 |
| onChange | 可选 | 动画事务开始时收到true/false；不代表动画完成 |
| onReopen | 可选 | 回缩途中点击反向前回调，可由宿主给震动 |
| motion | 0.43s/bounce0.02弹簧工厂 | 自定义原生Animation；也可导入surfaceMorphAnimation/duration |
| reversible | true | 回缩中原地点击重新展开；确认通知通常设false |
| start | effect | `effect`挂载后启动；`appear`等原生onAppear后启动，重复出现仅启动一次 |
| modal | false | 是否声明isModal辅助功能语义；不自动创建蒙层 |
| fadeHost | false | 是否使用宿主opacity转场；通常保持默认identity |
| closingOpacity | 1 | 回缩期间来源玻璃/边框透明度，0适用于交还隐藏装饰的入口 |
| rotation3DEffect | 可选 | 原生 `CommonViewProps.rotation3DEffect`，作用于整张纸面（含内容、背景）；不设置时保持平面。翻面背面的文字需要调用方自行反向旋转；不改变开合完成的生命周期 |

`surface`为`{fill,border,shadow:{color,radius,y},glass?,content?}`。来源glass时共享原生玻璃与目标纯色淡入；target.content是常驻自定义目标背景，不随阶段替换节点。两端阴影参数可不同。不要把业务主题对象直接传入。

## 生命周期与限制

初始来源姿态 → 下一帧原生展开 → open。关闭可在展开中触发，读取最新来源后反向；onClosed等待实际动画完成，未使用duration计时卸载。每次反向递增代次，旧完成事件/卸载后的任务不再交接。preview与children节点常驻，内容过渡与几何在同一事务。

组件不管理全局互斥、返回键、来源隐藏、背景蒙层、删除任务或列表插入。没有JS逐帧循环；expanded/returnFrame只更新当前表面。接入项目时不要再在外层bus提交增加withAnimation事务。

依赖Scripting、通用`src/hooks/scheduleUI.ts`和`src/hooks/useStableAction.ts`。通过`index.ts`导入公共接口。项目原AccountExpansion保留兼容适配，负责主题/震动，业务调用方无需改动。

内部`presentation.ts`集中展示身份、提前关闭意图、关闭绑定、实际完成释放及卸载取消。常用封装和Tab形变都组合这个生命周期与原MorphSurface内核；它不是用户必须学习的新控制协议。
