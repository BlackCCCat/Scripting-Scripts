# MorphSurface 设计

## 常用接口收敛（2026-11-05）

公开两种接入：MorphCard面向同一容器内的入口→详情；MorphSurface处理已有跨树、菜单、列表交接。不是给基础接口增加更多必填参数，也不把账号业务搬入通用层。

MorphCard的使用者只提供source及content(close)。内部GeometryReader建立独立命名坐标空间，MeasuredSource保存最新来源位置；目标在容器中居中，默认限制尺寸并留16pt边距。layout只负责把生成的入口放入排布。主题和内容仍由宿主决定。

| 数据 | 所有者 | 更新范围 |
| --- | --- | --- |
| 稳定session和坐标空间名 | MorphCard惰性初始化 | 根布局不订阅开合 |
| 最新来源位置 | MeasuredSource ref | 测量不提交state |
| 当前来源快照/null | 内部session | CardSource隐藏占位与CardOverlay挂载 |
| 展开/返回姿态及原生完成 | 原MorphSurface | 当前表面，仍使用原动画 |
| 内容状态 | 使用者独立内容组件 | 不进入session |

打开和关闭事件均经scheduleUI离开原生回调；同轮重复操作合并，关闭调度还校验当前来源身份。订阅提交不增加动画事务，几何动画只由原MorphSurface负责。关闭时读取current()，原生removed完成才清除session并恢复入口；旧来源回调不能清除新来源。卸载取消尚未执行的打开/关闭、解除叶订阅，原MorphSurface继续校验存活和动画代次。

此入口解决调用者反复手写的测量、隐藏、关闭ref和完成恢复，未引入全局注册、主题读取、多卡调度或新的动画参数。复杂业务继续直接使用MorphSurface，避免为了统一调用而改变列表插入、蒙层及成功交接。

## 职责

将一个已测量的来源表面连续变形成目标表面。source与target定义矩形、圆角和表面样式，viewport定义所在浮层坐标与偏移。preview提供折叠内容，children提供展开内容。默认动画是原0.43秒、bounce0.02的原生弹簧。

组件不获取列表、账号或页面状态。AccountExpansion继续作为项目适配层，映射主题、震动、现有调用参数；添加成功成卡与列表插入仍由AddAccountExpansion管理。原节点的隐藏由来源调用方负责。

## 状态归属

| 状态 | 所有者/消费者 | 更新 |
| --- | --- | --- |
| expanded与returnFrame | 单个MorphSurface | 每次开/合一次提交 |
| opening/open/closing、代次、任务、存活 | 组件ref | 不驱动业务页 |
| 动态target | 调用方 | 表单高度/业务切换时 |
| 动画插值 | 原生框架 | 不建立JS逐帧循环 |
| 主题、震动、模态协调 | 业务适配层 | 通过外观/回调注入 |

## 交接协议

挂载先渲染来源姿态，下一帧进入展开事务；可选择onAppear后才启动，以保证特殊材质的首次挂载。关闭在同一事务读取source.current，提交完整返回矩形与expanded=false。等待withAnimation的removed完成事件，再调用onClosed。动画中反向会增加代次，旧完成事件不能卸载新一轮。卸载后定时任务和完成事件均失效。

内容与材质节点常驻；preview和children只在各自装饰层过渡。关闭手势modifier常驻，不在动画中增删。目标自定义背景常驻并交叉淡入，不替换背景树产生退场快照。命中随expanded切换，不额外延迟解锁。

## 接口取舍

source和target将几何与同一端的外观组合；生命周期回调不包含任何账号动作。可选动画工厂、自定义目标背景、关闭透明度、反向和模态语义只描述呈现行为。默认不强制模态，业务适配层显式启用。SurfaceStyle只包含fill/border/shadow/glass/content，未加入主题对象。

不提供全局调度器、多表面互斥或列表重排；这些不属于单张变形表面的生命周期。共享坐标由调用方统一，不在组件内猜测物理屏幕大小。

## 回归

现有AccountExpansion公开路径验证：详情、添加、批量删除、重置、动画中反向、真实完成回调、最新返回矩形、卸载代次失效、尺寸交接和稳定材质节点。新增直接公共接口用非账号外观验证独立使用，并检查导入图无业务依赖。

2026-11-06统一审核：MorphCard复用内部presentation生命周期；关闭绑定前的意图不会丢失，每次展示close有身份校验，内容工厂不因无关浮层执行重复调用。原MorphSurface仍独自拥有opening/open/closing与原生动画完成。该共享机制随后用于Tab；不复制几何动画，也不向常用入口增加参数。
