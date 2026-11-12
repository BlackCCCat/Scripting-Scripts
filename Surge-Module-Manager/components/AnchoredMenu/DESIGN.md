# AnchoredMenu 设计

弹层拥有 shown 状态与上一份 presentation ref。展示ID是一次弹出身份；同ID可更新内容，清空 presentation 后保留旧树完成退场，命中立即停用。显示状态只在菜单卡片叶子消费。跨下一轮 UI 任务提交 shown，清理时撤销迟到任务。

锚点是全局矩形，由组件测量自己的全局视口后换算、限位。优先在锚点上方10pt，边距16pt；尺寸来自调用者，viewport改变时请求关闭。组件负责透明关闭面、布局和动效，业务提供背景节点和内容，不导入Tab的类型/材质/动画。LiquidDockMenu保留为外观适配层。

默认原生进入spring(.42, 1-104/(2√4500))与退出easeOut(.18)保持已验收效果；可传openMotion/closeMotion工厂。onPresented在内容开始显示时通知，调用者负责幂等握手、震动、菜单业务、互斥。清空或替换presentation不会替业务执行命令。

2026-11-06：surface与onPresented提供默认/可选行为，id省略时只在关闭→打开边界产生新身份。简单菜单组合MeasuredSource获取锚点；Tab继续传显式id和保压握手，原动画参数不变。
