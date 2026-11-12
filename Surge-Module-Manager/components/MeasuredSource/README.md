# MeasuredSource

最简用法：`<MeasuredSource onActivate={open}><Text>查看详情</Text></MeasuredSource>`，默认使用全局坐标；不必先声明命名容器。

把任意内容变成可测量的原生按钮，给形变卡片提供固定起点和实时回缩位置。无账号、主题或 bus 依赖。

```tsx
import { Text, ZStack } from "scripting"
import { MeasuredSource, type MeasuredOrigin } from "./src/components/MeasuredSource"
function Source({ open }: { open: (source: MeasuredOrigin) => void }) {
  return <ZStack coordinateSpace="demo">
    <MeasuredSource space="demo" label="打开详情" onActivate={open}>
      <Text padding={16}>查看详情</Text>
    </MeasuredSource>
  </ZStack>
}
```

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| children | 必填 | 按钮内容及其布局尺寸 |
| space | global | 省略时全局坐标；传字符串时使用父容器声明的命名坐标系 |
| label | 打开详情 | 按需覆盖辅助功能名称 |
| onActivate | 必填 | 收到 `{ frame, current }`；未测量/无尺寸时不调用 |
| hidden | false | 内容透明、禁止命中和辅助功能，保留尺寸与测量 |
| disabled | false | 禁止激活，保留外观 |
| accessibilityValue | 无 | 调用者提供本地化的选中等状态文案 |
| onFrame | 无 | 每次布局测量通知；不要在这里无条件更新父层 state |

frame 是激活当时的起点快照；current() 返回最近布局测量值，列表滚动后仍可正确回缩。坐标只是布局快照，不是逐帧几何查询。激活前校验矩形各值有限、尺寸大于0。切换坐标空间后，必须获得新空间的有效测量才能激活；旧来源current()不会混用另一空间的坐标。稳定按钮回调读取最新隐藏/禁用属性，不装长按手势，不阻挡滚动。组件不决定展开互斥或来源何时隐藏，这些由宿主协调。

复制 `src/components/MeasuredSource` 和 `src/hooks/useStableAction.ts` 到 Scripting 脚本。入口 `index.ts` 导出组件、props 和 origin 类型。旧 `CardSource` 只是命名坐标与隐藏 source 的业务适配；迁移时将 open 改为 onActivate，将 selected 改为本地化 accessibilityValue。
