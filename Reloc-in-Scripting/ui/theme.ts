import type { Color, CommonViewProps } from "scripting";
import type { SessionSnapshot } from "../types";

export const RELOC_COLORS = {
  accent: "#2B73F5" as Color,
  accentDeep: "#1C52D6" as Color,
  emerald: "#17B87A" as Color,
  emeraldDeep: "#0D8F66" as Color,
  amber: "#F2991F" as Color,
  crimson: "#E64045" as Color,
  crimsonDeep: "#C22933" as Color,
} as const;

export function isIOS26OrLater(): boolean {
  const major = Number.parseInt((Device.systemVersion || "0").split(".")[0] ?? "0", 10);
  return Number.isFinite(major) && major >= 26;
}

/**
 * 浮动卡片表面样式（对应 RelocGlassCard）：
 * iOS 26+ 使用原生 Liquid Glass（不叠加外层直角 shadow 避免矩形黑影），低版本回退为系统 regularMaterial。
 */
export function floatingCardStyle(cornerRadius = 24): Partial<CommonViewProps> {
  const shape = {
    type: "rect" as const,
    cornerRadius,
    style: "continuous" as const,
  };
  if (isIOS26OrLater()) {
    return {
      glassEffect: shape,
      clipShape: shape,
    };
  }
  return {
    background: { style: "regularMaterial", shape },
    clipShape: shape,
  };
}

/**
 * 圆形顶部/HUD 按钮样式（对应 MapHUDIconButton 42x42）。
 */
export function topCircleButtonStyle(activeColor?: Color): Partial<CommonViewProps> {
  if (activeColor) {
    return {
      background: { style: activeColor, shape: "circle" },
      clipShape: "circle",
    };
  }
  if (isIOS26OrLater()) {
    return {
      glassEffect: "circle",
      clipShape: "circle",
    };
  }
  return {
    background: { style: "regularMaterial", shape: "circle" },
    clipShape: "circle",
  };
}

/**
 * 浮动胶囊样式（对应顶栏搜索框与状态胶囊）。
 */
export function floatingPillStyle(): Partial<CommonViewProps> {
  if (isIOS26OrLater()) {
    return {
      glassEffect: "capsule",
      clipShape: "capsule",
    };
  }
  return {
    background: { style: "regularMaterial", shape: "capsule" },
    clipShape: "capsule",
  };
}

export function sessionPhaseText(snapshot: SessionSnapshot): string {
  if (snapshot.lastError && !snapshot.isRunning) return "异常停止";
  if (!snapshot.isRunning) return "待机";
  if (snapshot.authenticated && snapshot.activeSentences.length > 0) {
    return snapshot.mode === "probe"
      ? "探测就绪"
      : `定位注入中 · ACK ${snapshot.packetsAcknowledged}`;
  }
  if (snapshot.authenticated) return "已认证 · 等待订阅";
  if (snapshot.identified) return "已识别 · MFi 认证中";
  if (snapshot.linkReady) return "链路已建立 · 识别中";
  if (snapshot.lockdownConnected) return "隧道已连接 · 握手中";
  return "建立连接中…";
}
