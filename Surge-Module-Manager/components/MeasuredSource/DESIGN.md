# MeasuredSource 设计

来源只保存最新命名坐标快照（ref），测量不更新父层 state。激活时固定起点，current() 在收回时读取最新矩形。隐藏仅影响内容绘制、命中和辅助功能，仍保留尺寸和测量。使用原生 Button，不安装长按或滚动拦截手势。

业务适配层负责订阅来源隐藏 source、选择文案和工作区坐标名；组件不订阅账号 bus。disabled/hidden 通过稳定回调读取最新 props。容器必须声明同名 coordinateSpace，测量与 MorphSurface 目标必须使用同一坐标基准。

2026-11-06：space省略时使用global，不要求调用方先创建命名容器；显式space保留原业务语义。测量ref包含坐标空间身份，换空间或无效矩形时不允许旧几何激活。
