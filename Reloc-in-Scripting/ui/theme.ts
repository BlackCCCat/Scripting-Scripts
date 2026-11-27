import type { Color, CommonViewProps } from "scripting";
import type { AppLanguage, SessionSnapshot } from "../types";
import { formatText, getStrings } from "../utils/i18n";

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

export function sessionPhaseText(snapshot: SessionSnapshot, language?: AppLanguage): string {
  const logs = getStrings(language).logs;
  if (snapshot.lastError && !snapshot.isRunning) return logs.phaseErrorStop;
  if (!snapshot.isRunning) return logs.phaseIdle;
  if (snapshot.authenticated && snapshot.activeSentences.length > 0) {
    return snapshot.mode === "probe"
      ? logs.phaseProbeReady
      : formatText(logs.phaseInjecting, snapshot.packetsAcknowledged);
  }
  if (snapshot.authenticated) return logs.phaseAuthWaitSub;
  if (snapshot.identified) return logs.phaseIdentified;
  if (snapshot.linkReady) return logs.phaseLinkReady;
  if (snapshot.lockdownConnected) return logs.phaseTunnelConnected;
  return logs.phaseConnecting;
}
