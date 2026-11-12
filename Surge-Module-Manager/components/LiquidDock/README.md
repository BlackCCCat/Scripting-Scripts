# LiquidTabs

Scripting 原生 Tab 容器。使用者注册页面、图标、图标动画、目标卡片和第二套栏；组件负责页面常驻、输入、吸附、玻璃镜片与 mask、局部状态、播放时钟、坐标转换及形变返回交接。现有 `LiquidDock` 继续兼容，已验收的拖动、形变及按压参数保持不变。

完整可编译示例：[tabs-example.tsx](tabs-example.tsx)。它包含三页、页面计数保留、自定义动画图标、四项编辑栏和三个形变目标，不依赖账号或网络。

## 1. 注册页面和图标

```tsx
import { Text, useState } from "scripting"
import { createLiquidTabs, LiquidTabs } from "./src/components/LiquidDock"

export function App() {
  const [tabs] = useState(() => createLiquidTabs({
    pages: [
      { value: "home", title: "首页", systemImage: "house", content: <Text>首页</Text> },
      { value: "account", title: "账号", systemImage: "person", content: <Text>账号</Text> },
    ],
  }))
  return <LiquidTabs controller={tabs}/>
}
```

`value` 是唯一稳定 ID，`title` 用于辅助功能标签。页面只注册一次；切换只改变展示宿主的透明度和命中，不卸载业务页面。controller 使用惰性 `useState` 创建；不要在每次 render 时重新创建。

图标三选一，类型和运行时均检查。普通图片和 SF Symbols 都不需要计算图标宽高：

```tsx
{ value: "home", title: "首页", systemImage: "house", content: <HomePage/> }
{ value: "brand", title: "品牌", image: { filePath: Script.directory + "/assets/brand.png" }, content: <BrandPage/> }
{ value: "cloud", title: "云端", image: { imageUrl: "https://example.com/cloud.png" }, content: <CloudPage/> }
{ value: "photo", title: "图片", image: { image: myUIImage }, content: <PhotoPage/> }
```

`image` 接受原生 `ImageProps`：本地文件、URL、UIImage 和原生的浅深主题来源均可直接使用。组件统一将图片等比适配到 22×22pt 的画布并居中，不读取像素尺寸来计算栏宽；不会裁剪或拉伸成长宽相同。彩色图片默认保留原色；希望跟随普通／选中颜色时加 `renderingMode: "template"`。`resizable` 与布局由组件管理，图片来源无需配置它们。SF Symbols 使用统一 22pt 字号。

需要自行绘制图形时才使用回调：

```tsx
{ value: "saved", title: "收藏", content: <SavedPage/>,
  icon: ({ color, highlighted, value }) => <MyIcon color={color}/> }
```

`icon(context)` 返回自定义节点，供 CustomShape 等高级绘制使用；绘图自身的设计坐标由它决定，不必计算按钮槽宽度。context 只有 `value / color / highlighted`；无播放 source、手势或 mode 内部对象。需要读取业务状态时，返回独立叶组件，让它自行订阅所需字段。

静态系统图标直接使用原生Image；静态图片和自定义图标也不创建播放订阅或回落时钟。不提供surfaces时不创建形变会话、测量包装或浮层宿主。可选能力没有必填的空配置。

## 2. 注册图标动画

在任意一种图标条目上声明 `iconAnimation`，无需维护计时器、播放订阅或普通／高亮两份状态。图片的 `icon` 已完成等比适配：

```tsx
iconAnimation: {
  duration: 170,
  render: ({ active, icon }) => <VStack
    scaleEffect={active ? 0.8 : 1}
    animation={{ animation: active
      ? Animation.easeOut(0.17)
      : Animation.spring({ duration: 0.5, bounce: 0.26 }), value: active }}>
    {icon}
  </VStack>,
}
```

`render` 还收到图标的 `value / color / highlighted`。`icon` 是已缓存的基础图标；可以包裹它，也可以返回自己的分笔画组件。自定义路径形变需提供匹配拓扑，组件不会自动把任意图像变成另一个图像。

`active` 在真实选页提交时变为 true，`duration` 毫秒后变回 false，默认 170ms；它表示蓄力窗口，不是整个回弹时长。初次显示、点击当前页、拖动经过和切换栏都不播放。快速反选、切换栏、卸载会取消旧播放。动作条目在接受命令时播放，包括再次点击同一动作；连续点击会重置蓄力窗口。切换栏会取消当前播放。每项普通／高亮共用一个时钟，状态只进入该图标叶。

## 3. 切换第二套栏

`pages` 登记页面，`actions` 登记命令，`bars` 仅排列 ID。无需声明槽 key、模式 source 或焦点 source。

```tsx
const tabs = createLiquidTabs({
  pages: [/* 页面定义 */],
  actions: [
    { value: "back", title: "退出编辑", systemImage: "arrow.left",
      onPress: ({ tabs }) => tabs.showBar("main") },
    { value: "refresh", title: "刷新", systemImage: "arrow.clockwise",
      onPress: () => refreshSelected() },
    { value: "delete", title: "删除", systemImage: "trash",
      onPress: ({ tabs }) => tabs.present("confirm") },
  ],
  bars: [
    { value: "main", items: ["home", "account"], width: 174 },
    { value: "edit", items: ["back", "refresh", "delete"], width: 234 },
  ],
  surfaces: [/* 下一节 */],
})
// 页面上的编辑按钮：
tabs.showBar("edit")
```

栏切换与页面选择相互独立；退出编辑不会回到其他页，也不会自动清空业务选择。首尾槽跨栏保留，中间槽由组件生成。导航栏可拖动选页；横向拖动接管后，在底栏上下边缘外松手仍按释放位置吸附，左右越界落到首／尾项。纵向起手和系统取消不提交。操作栏仅在原按钮内抬手执行，跨按钮拖动不会误删。不同导航栏可以只展示页面子集：当前页不在栏里时镜片停首项，页面仍保留，直到实际选择新的页面。

省略 `bars` 自动生成 `main` 导航栏。一个栏只能全部是页面或全部是命令，不能混合。刷新、删除、全选、进度、成功提示等业务逻辑由 `onPress` 回调处理；异步失败由调用方捕获和显示。

## 4. 与其他组件联动形变

登记目标尺寸和内容，然后 `tabs.present(id)`。来源默认是整个底栏；测量、全局到局部坐标、只读底栏预览、实时返回位置、关闭绑定均在组件内部。

```tsx
surfaces: [{
  value: "confirm",
  size: { width: 320, height: 200 },
  content: ({ close, tabs }) => <VStack spacing={20} padding={24}>
    <Text>删除已选项目？</Text>
    <Button title="取消" action={close}/>
    <Button title="删除" action={() => {
      deleteSelected()
      tabs.showBar("main")
      close()
    }}/>
  </VStack>,
}]
```

- `present(id)` 返回是否接受打开；来源未测量、未挂载 overlay 或已有目标时返回 false，不排队。
- 每次接受打开后首次挂载目标时调用一次 `content(context)`，返回节点保持稳定。
- `content` 提供的 `close()` 属于该次展示；旧回调不能关闭新的目标。controller 的 `close()` 关闭当前目标。
- 关闭可在打开过程中触发；若原生关闭函数尚未绑定，组件保存这次意图，绑定后跨事件循环执行。
- 关闭读取最新来源位置和宽高，在同一动画里返回；等待原生动画实际完成后才显示 live 底栏。不以固定计时器卸载。
- 目标展示期间底栏保留占位与测量但暂停输入。可以先 `showBar()` 再关闭，直接回到新栏尺寸。
- 点击目标外的淡色蒙层关闭。目标尺寸上限为当前宿主宽高减 32pt；`surface` 可覆盖填色、边框、玻璃和阴影（类型 `MorphSurfaceStyle`）。

这里的目标是底栏联动卡片，不是任意视图之间的共享元素系统。需要其他来源或菜单握手时使用高级接口，见 [dock-reference.md](dock-reference.md) 和 [integration-example.tsx](integration-example.tsx)。

## 5. 页面选择和外部绑定

```tsx
const selection = useObservable("account")
const [tabs] = useState(() => createLiquidTabs({ pages, selection }))
// 以下两种方式都更新页面、镜片和选择动画：
tabs.select("home")
selection.setValue("account")
```

也可以不传 Observable，用 `initialSelection` 指定初值，之后调用 `select(id)`，通过只读 `tabs.selection.read()/subscribe()` 联动其他组件。订阅返回取消函数；结束使用时调用。`tabs.bar` 同样只读。

`onSelectionChanged(id)` 只通知由 controller/底栏接受的选页，不是拦截器；外部直接写 Observable 不触发它。需要监听所有变化则订阅 `tabs.selection`。不要在此回调里用另一次选页“拒绝”导航。

`select` 遇到相同页、禁用页或 `blocked` 为 true 时不改变值。Observable 是外部权威，可主动选禁用页；它的值必须始终是注册页面 ID，非法初值、外部读取或通知会明确报错。组件卸载只解除自己的订阅，不销毁外部 Observable。

## 6. iPhone / iPad 和已有布局

完整 `<LiquidTabs>` 组合页面宿主、底栏和目标浮层，页面预留 80pt 底部空间；系统安全区由外部屏幕容器决定。不读业务 ThemeContext。appearance可省略，使用跟随系统的语义颜色；只覆盖需要的字段，例如 `appearance={{ selectedForeground: "systemBlue" }}`。已有完整六色外观原样保留。

需要侧栏、独立 toolbar 或现有页面布局时拆分使用，同一个 controller 各放一个宿主：

```tsx
<ZStack>
  <LiquidTabPages controller={tabs}/>
  <VStack><Spacer/><LiquidTabBar controller={tabs} appearance={palette}/></VStack>
  <LiquidTabOverlay controller={tabs} appearance={palette}/>
</ZStack>
```

overlay 放在覆盖目标区域的最上层、与 bar 同一窗口，不能放在底栏的 64pt 容器里；它自己换算坐标。分拆布局时自行给滚动内容预留底栏空间。只用页面和底栏、不声明形变目标时可省略 overlay。一个 controller 同时只挂载一个 live bar 和一个 overlay；需要多窗口时分别创建。

iPad 侧栏可直接调用 `tabs.select(value)` 并订阅选择值；不要求把 iPad 改成手机底栏。本项目既有业务适配仍用兼容的低层 `LiquidDock`，无需为了新入口重做已验收布局。

## 尺寸、参数和生命周期

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| pages | 必填 | 非空，value/title/content 与一种图标；value 在所有页面和命令中唯一 |
| actions | [] | 同样的图标定义、可选 enabled 和 onPress({tabs}) |
| bars | main 全部页面 | value/items，可选 width（pt） |
| surfaces | [] | value/size/content，可选 surface；目标 value 唯一 |
| initialSelection | 第一页 | 有 selection Observable 时以其当前值为准 |
| initialBar | 第一栏 | 必须是已注册栏 |
| selection | 内部 source | 官方 Observable<string>，可双向绑定 |
| onSelectionChanged | 无 | controller 接受选页后通知 |
| blocked | false | 布尔 StateSource，阻止底栏输入、待交付动作和 controller 选页/打开目标 |

`title` 可为字符串或条目级 `StateSource<string>`；`enabled` 是可选 `StateSource<boolean>`。`StateSource` 只有 `read()` 和 `subscribe(notify)`，可复用项目 bus，不要求某个具体业务模型。

默认栏宽 `max(174, 12 + n×64 + 6×(n−1))`。最小宽 `12 + n×44 + 6×(n−1)`，不足时报错，避免偷偷缩小触摸目标。栏高 64pt、镜片高 52pt、内距和间距 6pt；这些是当前验收几何，不开放未经验证的任意高度。条目多时由宿主改布局，不自动水平滚动。

定义在创建时复制。替换整套页面/条目请创建新 controller；替换或卸载宿主会清理原输入、播放计时器、订阅、关闭交接和迟到回调。组件不会替你清理业务网络任务。

重复 ID、空页面/空栏、未知页面/栏/目标、混合栏、缺图标或两种图标并存、非法尺寸/播放时长均明确报错。`showBar`/`close` 不受 blocked 限制，业务可以结束忙碌展示；`present` 不排队、不会偷偷重试。

## 状态和性能约定

| 变化 | 消费者 | 不更新 |
| --- | --- | --- |
| 拖动/按压/吸附 | 原有镜片、mask、轻量装饰 | 页面、列表、静态图标 |
| 页面选择 | 页面展示宿主、按钮投影、目标图标 | 注册的业务内容节点 |
| 栏切换 | 底栏布局与图标槽 | 页面内容与本地 hook |
| 图标播放 | 当前项普通/高亮图标叶 | 其他图标、页面 |
| 目标形变 | 独立 overlay 与底栏显隐 | 业务页面 |

不要给 source/bus 通知再包外层 `withAnimation`；视图已经有原生动画。原生动作跨事件循环再提交。既有 DockMotion 的速度、吸附、定向形变、0.2s 按压均复用。底板在 iOS 26+ 使用原生透明玻璃与单次主题染色，不再叠加同色实底；较旧系统使用主题表面作为回退。选中镜片是独立的材质层。

## 安装与验证

从统一入口 `src/components/LiquidDock` 导入。复制到其他 Scripting 脚本时同时携带 `MorphSurface`、`AnchoredMenu`、`src/shared/EventBus.ts` 以及 `useBusState/useStableAction/scheduleUI/animateState` 基础 hook。要求原生 Scripting；iOS18+使用触摸事件，旧系统使用 Button。玻璃能力遵循系统。

组件公开使用路径测试位于 `tests/components/liquid-tabs.test.cjs`，原手势、图标、业务编辑与删除交接测试继续保留。Node 测试证明状态和生命周期，不证明真机帧率。原生验收记录见 `docs/architecture/liquid-tabs-consumer-plan.md`。
