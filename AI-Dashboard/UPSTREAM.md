# 上游项目版本追踪与对齐规范 (Upstream Tracking)

本项目部分供应商接入协议、配额数据模型与重置状态流参考自以下开源项目。为了在后续维护中能够及时核验上游最新特性并同步更新，特在此记录对齐基线与检查方法。

---

## 1. 追踪的上游仓库与当前对齐基线

### 1.1 TokenPulse
- **仓库地址**：[github.com/hqwuzhaoyi/TokenPulse](https://github.com/hqwuzhaoyi/TokenPulse)
- **对齐 Commit SHA**：`46ea63dec13192627ea910b0e3820bd23af864eb`
- **提交时间**：`2026-10-17 11:04:49 UTC`
- **对应提交说明**：`Merge pull request #9 from hqwuzhaoyi/codex/reset-preview-widgets-notifications - feat: 小组件展示 Codex 重置预告并精简卡片与通知`
- **本项目的参考范围**：
  1. 78 家直连网络 AI 平台供应商接入标准（端点规范、请求头格式、限流与钱包多币种数据归一化；已移除无实时网络请求的 JetBrains 本地 IDE 静态导出）。
  2. `CodexResetFeed` 与 `CodexResetStatus`（基于 `codex-resets.com` 的实时重置与 AI 预测预告流）。
  3. Web 登录会话 Cookie 容器与白名单筛选机制。

---

### 1.2 Antigravity-Manager
- **仓库地址**：[github.com/lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)
- **对齐 Commit SHA**：`9f8e4f24d61b33fa80b8078d104c942752a5fa0b`
- **对应版本 Tag**：`v4.9.8`
- **提交时间**：`2026-10-17 13:44:53 UTC`
- **对应提交说明**：`chore(release): bump version to 4.9.8 and update changelog`
- **本项目的参考范围**：
  1. Google Antigravity 多窗口配额模型（Gemini 5小时/周配额、Claude/GPT 5小时/周配额）。
  2. Gemini 4 Argon 独立模型配额与锁定周期提取算法。
  3. 客户端直连 OAuth 刷新与设备流接入。

---

## 2. 检查上游更新的操作指南

当用户提出 **“检查上游是否有更新”** 或 **“同步参考项目最新改动”** 时，执行以下标准核验流程：

### 步骤 1：查询上游最新 Commit
使用 GitHub MCP 或 GitHub API 检查对应仓库自上述对齐基线后的最新提交：
- **TokenPulse**：对比 `https://api.github.com/repos/hqwuzhaoyi/TokenPulse/commits` 与当前基准 `46ea63d`。
- **Antigravity-Manager**：对比 `https://api.github.com/repos/lbjlaq/Antigravity-Manager/commits` 与当前基准 `9f8e4f2`。

### 步骤 2：比对核心模块差异
重点比对以下目录的文件变动：
- `TokenPulse/TokenPulse/Providers/`：查看是否有新增 AI 平台或旧平台 API 端点/认证改动。
- `TokenPulse/TokenPulse/Domain/`：查看配额数据模型是否有新增字段。
- `Antigravity-Manager/`：查看关于 Google Antigravity 配额接口的参数解析升级。

### 步骤 3：移植与本地验证
1. 将新平台或接口补丁按 Scripting 原生 TypeScript 规范移植至 `scripts/AI Dashboard/providers/`。
2. 保持纯客户端直连、无中间层转发的安全规范。
3. 执行 `npx --yes -p typescript tsc --noEmit` 校验。
4. 更新 `UPSTREAM.md` 与 `upstream.json` 中的最新 Commit SHA 及更新日期。
