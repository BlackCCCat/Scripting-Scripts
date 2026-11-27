# Reloc in Scripting

基于 [Reukix/Reloc](https://github.com/Reukix/Reloc) 移植到 [Scripting App](https://scripting.fun) 的 iOS 外设级位置模拟脚本（CarKit / iAP2 / MFi-v3 / `$GPGGA` & `$GPRMC`），内置本机 Remote Pairing 与 RSD 隧道建连能力，**无需依赖外部 Loopback 脚本**，同时兼容 Surge / Loon / Egern / ClashMi 等外部代理提供的 `10.7.0.1` 本地回环模式。

---

## 快速上手

1. **配置隧道与配对**（「设备连接 → 01 / 02」）：
   - 选择「外部代理回环 (`10.7.0.1`)」或「Scripting 内置本机隧道」；
   - 点击「本机一键配对」按屏幕 / 画中画 / 灵动岛中的 6 位 PIN 完成系统开发者配对，或导入已有配对文件。
2. **导入 MFi 凭据**（「设备连接 → 03」）：
   - 手动选择本地 `certificate.p7b` 与 `identity.pk8` 文件，或将两者放入脚本扫描目录后点击自动扫描。
   - **安全说明**：本脚本**不内置任何 MFi 私钥或证书**。
3. **选点并开始模拟**（「定位」页）：
   - 通过搜索、点选地图、收藏夹或手动输入坐标确定目标位置后，点击 **「开始定位」**。
   - **海拔自动匹配与调整**：地图选点、地址搜索或链接解析会自动匹配当地真实地形海拔；搜索框与坐标输入框支持直接填写 `纬度, 经度, 海拔`（例如 `37.334606, -122.009102, 52.4`）；轻点底部卡片中的海拔标签可随时手动修改；开启「自然微漂移」时会同步加入约 `±0.3m` 海拔浮动。
   - 当状态栏与底部卡片开始计数 `ACK` 时，说明 iOS 已订阅外设坐标流；随后请结合下方注意事项确认系统位置已完成切换。
4. **双语切换与快捷设置**（「设备连接 → 04」）：
   - 支持 **简体中文 / English** 双语切换（默认跟随系统），可在「应用语言 / Language」中即时切换，地名解析与灵动岛文案也会同步适配。

---

## 使用注意事项（提高成功率必读）

> [!IMPORTANT]
> 出现 **协议 `ACK` 一直在涨、但手机实际位置仍停留在原地** 的情况，通常不是脚本没连上，而是 iOS `locationd` 仍在沿用本机历史定位与网络辅助（Wi-Fi / 基站）缓存。请务必按以下要点操作：

1. **关闭「定位服务」必须保持足够长的时间再打开（关键）**
   - 当模拟未生效（尤其是跨城、跨省、跨国等**远距离目标**）时，请前往系统 **「设置 → 隐私与安全性 → 定位服务」关闭总开关，耐心等待较长时间（建议 10 秒以上，切勿秒关秒开），然后再重新打开**。
   - 实测中如果关闭时间过短（例如仅 3～5 秒），`locationd` 来不及清空原有融合状态缓存，重开后依然会迅速被真实位置拉回。
2. **配合切换飞行模式 / 开关 Wi-Fi 清理网络锚点**
   - 在室内或高密度 Wi-Fi 环境下，系统对 Wi-Fi BSSID 与基站定位的权重非常高，仅靠开关定位有时仍会被网络锚点拉回。
   - 若关闭定位等待较长时间后仍无效，建议**关闭定位服务的同时打开飞行模式（或关闭 Wi-Fi）等待约 10 秒以上 → 先打开定位服务等待模拟生效 → 再恢复网络**，通常可显著提高锁定成功率。
3. **如何判断位置是否已经模拟成功**
   - 开关定位后切回 Scripting，留意**地图页底部卡片参数栏右侧**（或前往「实测与日志」页查看）：
     - 绿色 **`✓ 已生效 · X.X m`**：系统当前读取到的坐标与目标偏差极小，说明外设定位已成功接管；
     - 琥珀色 **`未生效 · 偏 XXX km`**：系统仍在输出本地坐标，请继续按第 1、2 条关闭定位更长时间或配合飞行模式重试；
     - 轻点该状态胶囊或「刷新实测」可再次校验当前坐标。
4. **善用「快捷指令」快速跳转定位设置**
   - 可在「设备连接 → 06 快捷指令」一键复制 `prefs:root=Privacy&path=LOCATION`，在系统「快捷指令」App 中建立「打开 URL」快捷指令并把名称填回脚本，之后点击地图页右侧 **闪电快捷按钮** 即可一键跳转系统定位设置页面。
5. **授予「始终」定位权限并开启后台保活**
   - 建议在系统设置中将 Scripting 的定位权限设为 **「始终」**，并在本脚本设置中保持 **「后台保活」** 开启，确保切去系统设置、控制中心或其他地图/导航 App 时外设连接与导航级定位订阅不被系统挂起。
6. **结束模拟请规范停止以恢复真实定位**
   - 结束使用时请点击 **「停止模拟」**（或灵动岛中的停止按钮），尽量不要直接上滑强杀脚本进程。
   - 脚本停止时会自动下发高误差劣化报文（`HDOP=35.0`）、无效报文并发送 iAP2 `RST` 链路复位促使系统恢复真实 GPS；若停止后很久仍停在模拟坐标，同样在系统设置中**关闭「定位服务」等待 10 秒以上再打开**即可刷新恢复。
7. **设备与系统兼容性限制**
   - **仅支持 iPhone**：iPadOS 缺乏 iPhone 上完整的 CarKit / CoreLocation 虚拟配件定位路径，暂不支持在 iPad 上运行。
   - **纯蜂窝网络**：若使用外部代理回环且在纯蜂窝数据下无法建连，请开关一次飞行模式或切换至 Wi-Fi / Scripting 内置隧道后重试。

---

## 上游项目与致谢

- **上游仓库**：[https://github.com/Reukix/Reloc](https://github.com/Reukix/Reloc)（作者：**Reukix**）
- **开源协议**：依据上游仓库协议 **GNU Affero General Public License v3.0 (`AGPL-3.0-only`)** 开源。
- **社区与参考致谢**：
  - 感谢 **Reukix/Reloc** 提供 iAP2 链路层、MFi-v3 鉴权、NMEA 周期订阅下发与停止优雅复位方案。
  - 感谢 **WLOC 虚拟定位** 与 **Loopback** 脚本提供 Scripting 地图交互、灵动岛 `LiveActivity`、GCJ-02/WGS-84 坐标工具与本机 RSD 隧道设计参考。

---

## 上游同步基线（Upstream Tracking）

上游基线元数据统一维护在 [`UPSTREAM.json`](./UPSTREAM.json) 与 [`constants.ts`](./constants.ts)（`UPSTREAM_INFO`），后续跟随上游更新可直接对比变更：

- **当前已同步版本**：`v1.0.3`
- **基准 Commit**：[`4c82a1719100840e84411a34a89870b97d8cf291`](https://github.com/Reukix/Reloc/commit/4c82a1719100840e84411a34a89870b97d8cf291) (`2026-11-27T10:30:26Z`)
- **对比链接**：https://github.com/Reukix/Reloc/compare/4c82a1719100840e84411a34a89870b97d8cf291...main

> 注：上游 `v1.0.3` 新增的独立免配对模式通过原生 ObjC `dlopen("/System/Library/PrivateFrameworks/CoreAccessories.framework/CoreAccessories")` 调用系统私有 `ACCTransportClient`，在 Scripting 沙箱内无对应原生桥接能力，因此本脚本保留「内置 RSD 隧道 / 外部代理回环 + 本机 Remote Pairing」连接路径与原有的 `BackgroundKeeper` 保活方式；其余海拔高度、双语国际化与会话稳定性改进已完整移植。

### 一键检查上游更新

```bash
BASE=$(node -e "console.log(require('./scripts/Reloc in Scripting/UPSTREAM.json').upstream.baseCommit)")
curl -fsSL "https://api.github.com/repos/Reukix/Reloc/compare/${BASE}...main" \
  | node -e "
      const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
      console.log('Ahead by:', d.ahead_by, 'commits');
      for (const c of d.commits || []) console.log('-', c.sha.slice(0,7), c.commit.message.split('\n')[0]);
      console.log('Changed files:');
      for (const f of d.files || []) console.log('*', f.status, f.filename);
    "
```

### 模块映射概览

| 上游文件 (`Reukix/Reloc`) | 本地对应模块 (`Reloc in Scripting`) | 说明 |
| --- | --- | --- |
| `Reloc/Core/ObjC/RLASN1DER.*` | [`core/asn1.ts`](./core/asn1.ts) | ASN.1 DER 解析与构造 |
| `Reloc/Core/ObjC/RLMFiSigner.*` | [`core/mfi_signer.ts`](./core/mfi_signer.ts), [`core/p256.ts`](./core/p256.ts) | PKCS#7/PKCS#8 本地加载与 P-256 签名 |
| `Reloc/Core/ObjC/RLIAP2Wire.*` | [`core/iap2_wire.ts`](./core/iap2_wire.ts) | iAP2 控制消息编解码 |
| `Reloc/Core/Swift/IAP2Link.swift` | [`core/iap2_link.ts`](./core/iap2_link.ts) | `FF 5A` iAP2 链路层状态机与 `RST` 复位 |
| `Reloc/Core/Swift/NMEAGenerator.swift` | [`core/nmea.ts`](./core/nmea.ts) | `$GPGGA` / `$GPRMC` 生成、校验与无效复位报文 |
| `Reloc/Core/Swift/AccessoryLocationSession.swift` | [`core/accessory_session.ts`](./core/accessory_session.ts) | RSD/CarKit 通道与定位主会话 |
| `Reloc/Core/Swift/DevicePairingCoordinator.swift` | [`core/pair_setup.ts`](./core/pair_setup.ts), [`core/rppairing.ts`](./core/rppairing.ts) | 本机 Bonjour + SRP Remote Pairing |
| `Reloc/UI/RelocApp.swift` | [`index.tsx`](./index.tsx) | 根视图、状态编排、PiP 与灵动岛调度 |
| `Reloc/UI/RelocTheme.swift` | [`ui/theme.ts`](./ui/theme.ts), [`ui/components.tsx`](./ui/components.tsx) | 配色、毛玻璃/Liquid Glass 与通用控件 |
| `Reloc/UI/MapPickerView.swift` | [`ui/MapPickerView.tsx`](./ui/MapPickerView.tsx) | 地图选点、内联搜索、快捷指令与底部状态卡 |
| `Reloc/UI/ConfigurationView.swift` | [`ui/ConfigurationView.tsx`](./ui/ConfigurationView.tsx) | 连接配置、配对、本地 MFi 导入与设置 |
| `Reloc/UI/ProtocolLogsView.swift` | [`ui/ProtocolLogsView.tsx`](./ui/ProtocolLogsView.tsx) | 实时定位实测与协议事件流 |
