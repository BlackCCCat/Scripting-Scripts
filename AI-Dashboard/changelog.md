## v1.1.0
- new: 接入 Codex 重置预告（Reset Forecast），支持自适应展示官方预定重置时间与社区 AI 预测概率。
- new: 引入项目更新日志弹窗机制（`changelog.md`），升级版本后首次打开自动展示更新要点。
- new: 建立上游开源项目追踪标记（`UPSTREAM.md` 与 `upstream.json`），精准对齐 TokenPulse 与 Antigravity-Manager 的最新代码基线。
- improve: 全面重构供应商目录与详情页分割线，移除条目内部自绘伪线条，回归 iOS 原生系统列表分割线与轻触反馈。
- improve: 图标背景色更新为代表数据监控与仪表盘的经典标志色（System Orange）。
- improve: 概览 4 块 KPI 卡片对齐高度，柱状图对 Antigravity 等多窗口模型智能汇聚周期总消耗。
- improve: 供应商目录恢复首字母 (A-Z) 排序与右侧快速定位栏（支持拼音映射与路径筛选联动），并支持自由切换首字母索引或接入路径分组。
- fix: 修复在「设置」页点击「查看更新说明」未立即弹出、需切回「额度看板」才呈现的层级挂载问题（将弹窗统一挂载至根 TabView 容器）。
- remove: 移除 JetBrains AI 供应商及本地 IDE 导出路径。因其仅支持本地静态文件导入而无实时网络刷新接口，将其彻底下线以保证全平台纯网络直连刷新的一致性；接入路径收敛为 5 大类，可用供应商精炼为 78 家。

## v1.0.0
- new: 初始版本发布，支持 79 家主流 AI 供应商直连配额与 API 钱包余额统一监控。
- new: 覆盖直连 API 密钥、自建/聚合网关、OAuth 设备码、Google 原生 OAuth、Web 会话及本地 IDE 导出等 6 大接入路径。
- new: 独立支持 Google Antigravity 多窗口配额提取与 Gemini 4 Argon 独立模型解析。
- new: 支持卡片拖拽调序与轻扫快捷删除。
- new: 内置离线样例演示模式（Demo Mode）与系统钥匙串敏感凭据保护。