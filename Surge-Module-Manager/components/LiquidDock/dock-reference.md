# LiquidDock：高级底栏接口

Scripting 原生自定义底栏。保留现有位移、吸附、定向形变、0.2s 按压、共享玻璃镜片／mask 和图标播放时机。接口参考官方 `TabView selection` 与 `Tab value/title/systemImage`；这是底栏，不接管页面内容或页面转场。

## 简单导航

```tsx
import { useObservable, useState } from "scripting"
import { createLiquidDock, LiquidDock, type DockAppearance } from "./src/components/LiquidDock"

const palette: DockAppearance = { surface: "#EEEDE7", foreground: "#77786F",
  selectedSurface: "#DDE5D5", selectedForeground: "#39482F", border: "#C8CCBF", shadow: "#00000018" }

function NavigationBar() {
  const selection = useObservable("search")
  const [dock] = useState(() => createLiquidDock({
    selection,
    items: [
      { value: "home", title: "首页", systemImage: "house" },
      { value: "search", title: "搜索", systemImage: "magnifyingglass" },
      { value: "saved", title: "收藏", systemImage: "bookmark" },
    ],
  }))
  return <LiquidDock controller={dock} appearance={palette} width={258} />
}
```

`palette` 是 `DockAppearance`，仅包含 `surface / foreground / selectedSurface / selectedForeground / border / shadow` 六个颜色。组件不读取项目 ThemeContext；宿主映射自己的主题。完整可运行的3／5项例子见 `examples.tsx`，它不导入账号、工作台、HTTP 或 Surge。

- `selection` 接受官方 `Observable<string>`，默认双向写入；也接受结构化的只读 `StateSource<string>`（`read/subscribe`）。后者配合 `onSelectionChanged`，由宿主同步接受或拒绝切页。
- `value` 是稳定字符串标识，不是数组下标。初次及同页点击不播放图标选择动画；实际选中值改变才触发。
- `title` 可为字符串或条目级 source；`enabled` 是可选的布尔 source。禁用项可以被拖动经过，松手不会执行，镜片回权威选择。
- `icon(context)` 可替代 `systemImage`。context 包含当前 value、modeId、颜色、高亮状态和条目级 playback source。动态图标应返回独立组件，在其内部订阅；不要在定义图标时读取账号全局状态。
- controller 在宿主生命周期内稳定；组件卸载或替换 controller 时会清理输入、订阅、计时器和迟到主线程任务。不要每次 render 重新创建它。外部 Observable/source 由调用者管理，不由底栏销毁。

## 可选的操作模式

`modes` 与 `mode` 用于同一个底栏在导航／操作之间连续变形；不需要模式切换时省略它们即可。

完整可编译的导航／操作模式示例见 [modes-example.tsx](modes-example.tsx)，所有条目、模式source、主题和回调都在文件中定义，无业务占位变量。

`slot.key` 是常驻原生节点身份，`slot.value` 是该模式下的动作。多个模式可让同一个槽承载不同动作，原生材质和形变图标不会因业务 value 改变而整栏重建。未出现的槽仍常驻，关闭命中与辅助功能，再以透明度／缩放隐藏。图标要连续路径 morph，需由调用方提供匹配拓扑的 CustomShape；任意图像不会自动 morph。

导航可拖动换页；操作模式只允许在原按钮范围内抬手执行。跨按钮拖动不会意外执行刷新或删除。`onAction` 只提交命令，异步任务、刷新进度、成功／错误文案和业务删除确认始终由宿主管理。同步切换模式会撤销未执行的旧命令。

`blocked` 合成业务忙碌／模态锁；`interactive={false}` 只暂停输入并撤销待办，不重建 Motion，不停止来源坐标测量。一个 controller 对应一个 live 底栏；多个只读摘要可安全共享同一选择源。

## 菜单与跨树交接

`onMenu({value, origin, anchor, presented})` 必须明确返回 `"accepted"` 或 `"rejected"`。接受时保留按压，宿主在菜单实际开始可见时调用 `presented()`；若提前取消，也必须结束此握手。旧回调有代次校验，不会释放新手指的压力。辅助功能与旧系统 Button 走相同的延后命令路径。

可用 `<LiquidDockMenu presentation={...} appearance={palette} onDismiss={...}/>` 获得现有弹出动效、屏幕限位和透明区域关闭。将它放在全屏 overlay；presentation 包含稳定的本次展示 ID、anchor、width、height、content 和 onPresented。业务菜单内容、可用性、互斥、震动和动作不在通用层。

动作收到的 `origin` 包含初始全局 `frame` 与实时 `current()`。业务确认卡片用它求展开／回缩位置；终点尺寸根据目标业务模式决定。用 `<LiquidDockPreview controller={dock} modeId={...} width={movingWidth} .../>` 渲染同样的只读外观。preview 没有 Motion、输入、scene 监听或播放时钟，不能执行命令。

## 状态与使用范围

- 每帧：只更新镜片／mask及局部按压装饰；不更新业务页面、静态图标或列表。
- 模式：低频布局宿主。
- 选中值：镜片与按钮选中投影；播放只通知目标条目的普通／高亮图标。
- 可用性：对应按钮及透明度装饰；装饰保持子图标身份。
- 菜单：独立浮层。

不在 bus 提交外包裹 `withAnimation`。布局和图标自带原生 animation，输入回调通过 `scheduleUI` 离开当前原生调用栈后提交。整栏按压只缩放绘制层，命中面和全局测量保持稳定。

第一版支持静态定义的非空、等宽槽位及预声明的模式切换。定义在创建时复制；需要更换条目集合时创建新 controller，组件负责旧实例清理。重复 value、模式 ID、槽 key、未知条目和非法宽度会报错。每项至少44pt；live 宽度不足时保持最小总宽，不无限缩小触摸目标，宿主应提供足够空间或换布局。只读 preview 可跟随移动卡片缩放，不参与命中。没有加入滚动条目、垂直布局、动态重排、异步选页确认或页面托管。

文件依赖 Scripting、通用AnchoredMenu及本仓库的基础设施：`src/shared/EventBus.ts`、`src/hooks/useBusState.ts`、`src/hooks/useStableAction.ts`、`src/hooks/scheduleUI.ts` 及 `src/hooks/animateState.ts`。复制到其他脚本时一起携带这些基础模块；不需要账号代码。


## 参数与默认值

`createLiquidDock(options)` 返回稳定的不透明 controller；不提供全局单例或页面容器。

| options | 默认 | 说明 |
| --- | --- | --- |
| items | 必填 | 非空条目集合，每项value/title及systemImage或icon |
| selection | 必填 | Observable<string>或read/subscribe的StateSource<string> |
| modes | 自动生成default导航模式 | 非空槽位；宽度默认max(174, 12+n×64+6×(n-1)) |
| mode | 内部default source | 自定义modes必须传初始值匹配的mode source |
| blocked | false | 可选布尔source，阻止输入及待交付命令 |
| onSelectionChanged | Observable.setValue；source无默认写入 | 导航命令；必须同步提交权威选择，拒绝则镜片回实际选择 |
| onAction | 无 | 操作模式命令，收到value、origin或null |
| onMenu | 无 | 长按/更多操作收到request，必须返回accepted/rejected |

| LiquidDock props | 默认 | 说明 |
| --- | --- | --- |
| controller / appearance | 必填 | controller稳定身份，appearance六个Color |
| width | 当前mode.width | live最小44pt/项；含左右内距和槽间距 |
| interactive | true | 暂停输入，测量和节点仍常驻 |
| decorated | true | 背景玻璃、轮廓与阴影 |

`DockItem`：value唯一非空字符串、title字符串或source、systemImage可选、icon(context)可选、enabled布尔source可选（默认true）。自定义icon优先于systemImage。playbackDuration可选，单位毫秒，默认170；高层接口通过iconAnimation.duration声明。`DockMode`：id唯一、interaction为navigation/actions、width为有效pt宽度、slots为`{key,value}`数组；同模式key和value均不能重复。某个模式没包含的槽保留原生身份，隐藏并禁止输入。

`LiquidDockPreview`接收controller/appearance/width/decorated，另有可选modeId（默认当前mode），无interactive。默认decorated=false，未给width用mode.width；preview不强制最小触摸宽度。它仅绘制，不负责输入/播放，不主动订阅mode变化；调用方需要在模式更新时给新的modeId或触发渲染。

`LiquidDockMenu`的presentation/appearance/onDismiss必填。presentation可null，字段及生命周期见 [AnchoredMenu](../AnchoredMenu/README.md)。作为适配层只负责22pt圆角的DockSurface。菜单尺寸不会自动测量，由宿主声明。

## 完整菜单与确认卡片示例

[ integration-example.tsx ](integration-example.tsx) 提供自包含的长按菜单 → 点击命令 → 底栏表面变为确认卡片 → 返回底栏流程。它使用新MorphSurface的完成回调，不使用固定时间卸载。全局来源转换为当前宿主局部坐标；current()每次读取最新来源和视口ref。真实底栏只隐藏绘制并保留测量，preview为只读外观。

接受菜单时保留request.presented，菜单开始显示或被提前取消都结束握手。回调内部带输入代次校验，可以幂等调用；不能拿旧回调解除另一轮按压。示例中的确认不执行网络或删除操作，业务任务应在宿主接入。

## 安装与架构

复制LiquidDock目录，以及其依赖的`src/components/AnchoredMenu`、`src/shared/EventBus.ts`、`src/hooks/useBusState.ts`、`src/hooks/useStableAction.ts`、`src/hooks/scheduleUI.ts`和`src/hooks/animateState.ts`。统一入口还依赖`src/components/MorphSurface`，复制模块时一并携带。要求Scripting原生环境（当前验证3.3.0.39）；iOS18+走onTouchGesture，旧系统走Button路径。玻璃材质可用性遵循Scripting/系统，不做Web模拟。

- controller：静态定义、权威选择适配、条目播放source；不持有页面/账号。
- interaction/DockInput：手指归属、真实命中、菜单握手、延后动作和取消代次。
- DockMotion：位移、定向形变和吸附采样，只通知运动叶子。
- LiquidDock/DockMotionView：稳定原生节点，mask与镜片共享几何；图标叶子消费自己的播放source。
- 宿主：页面切换、数据、菜单内容、震动、确认卡片和网络任务。

这份文档补全现有组件接口；本轮未改动Tab物理参数、手势或内部业务适配。复杂改动继续先写状态/输入/生命周期设计，再实现，不能给bus提交再次套动画事务。


外观可省略或按字段覆盖（`Partial<DockAppearance>`），默认使用系统语义色。低层自定义icon省略playbackDuration仍保留170ms兼容行为；设为0明确关闭播放，系统图标不创建播放任务。新使用者优先通过LiquidTabs的iconAnimation按需声明。

Tab联动形变组合MorphSurface套件内部的展示生命周期，与MorphCard共享提前关闭、旧回调失效和原生完成交接逻辑；Dock自身只保存目标注册及来源坐标，不再维护第二份关闭锁。
