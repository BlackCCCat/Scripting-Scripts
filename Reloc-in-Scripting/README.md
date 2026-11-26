# Reloc in Scripting

基于 [Reukix/Reloc](https://github.com/Reukix/Reloc) 完整移植到 [Scripting App](https://scripting.fun) 的 iOS 外设级位置模拟脚本（CarKit / iAP2 / MFi-v3 / `$GPGGA` & `$GPRMC`），现已内置全部配对与 RSD 隧道能力，**无需依赖外部 Loopback 脚本**。

## 上游项目与致谢

- **上游仓库**：[https://github.com/Reukix/Reloc](https://github.com/Reukix/Reloc)（作者：**Reukix**）
- **开源协议**：依据上游仓库协议 **GNU Affero General Public License v3.0 (`AGPL-3.0-only`)** 开源。
- **社区与参考致谢**：
  - 感谢 **Reukix/Reloc** 提供 iAP2 链路层、MFi-v3 鉴权、NMEA 周期订阅下发与停止优雅复位方案。
  - 感谢 **WLOC 虚拟定位** 与 **Loopback** 脚本提供 Scripting 地图交互、灵动岛 `LiveActivity`、GCJ-02/WGS-84 坐标工具与本机 RSD 隧道设计参考。

> **安全与凭据说明**：本脚本**不内置任何 MFi 私钥或证书**。请在「设备连接 → 03 MFi 本地凭据」中自行选择本地 `certificate.p7b` 与 `identity.pk8` 文件，或放入预设目录由脚本自动扫描加载。

---

## 上游同步基线（Upstream Tracking）

上游基线元数据统一维护在 [`UPSTREAM.json`](./UPSTREAM.json) 与 [`constants.ts`](./constants.ts)（`UPSTREAM_INFO`），后续跟随上游更新可直接对比变更：

- **当前已同步版本**：`v1.0.1`
- **基准 Commit**：[`c6e96d312d4101ee3aa47e97205bb27e3fecfa6c`](https://github.com/Reukix/Reloc/commit/c6e96d312d4101ee3aa47e97205bb27e3fecfa6c) (`2026-11-26T11:34:53Z`)
- **对比链接**：https://github.com/Reukix/Reloc/compare/c6e96d312d4101ee3aa47e97205bb27e3fecfa6c...main

> 注：上游 `v1.0.1` 中针对原生 UIKit `WebMercatorMapView.swift` 的离线瓦片画布属于 iOS 原生 `MKTileOverlay` 方案，Scripting 使用原生 MapKit `<Map>` 组件，故仅同步其协议、保活、停止恢复及 iPad 兼容性检查改动。

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
| `Reloc/UI/MapPickerView.swift` | [`ui/MapPickerView.tsx`](./ui/MapPickerView.tsx) | 地图选点、内联搜索与底部控制卡 |
| `Reloc/UI/ConfigurationView.swift` | [`ui/ConfigurationView.tsx`](./ui/ConfigurationView.tsx) | 连接配置、配对、本地 MFi 导入与关于 |
| `Reloc/UI/ProtocolLogsView.swift` | [`ui/ProtocolLogsView.tsx`](./ui/ProtocolLogsView.tsx) | 实时定位实测与协议事件流 |
