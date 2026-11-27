/**
 * 灵动岛设备形态识别与紧凑模式排版辅助（支持 iPhone Duo 竖向灵动岛）
 */

export const IPHONE_DUO_HARDWARE_MODEL = "iPhone19,4";

export function isIPhoneDuo(
  hardwareModel: string | undefined = typeof Device !== "undefined" ? Device.hardwareModel : undefined,
): boolean {
  return hardwareModel === IPHONE_DUO_HARDWARE_MODEL;
}

/**
 * 将已持续时间格式化为适应竖向窄灵动岛的两行文本：[主行, 次行]
 * 1 小时内显示 ["MM", "SS"]；达到 1 小时后显示 ["Xh", "MM"] 避免宽度溢出。
 */
export function formatDuoElapsedParts(startedAt: number, now?: number): [string, string] {
  const totalSeconds = Math.max(0, Math.floor(((now ?? Date.now()) - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return [`${hours}h`, String(minutes).padStart(2, "0")];
  }
  return [String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")];
}

/**
 * 将 6 位配对 PIN 拆分为上下两行 3 位数字以适配 iPhone Duo 竖向灵动岛。
 */
export function splitDuoPin(pin: string): [string, string] | null {
  if (pin.length !== 6) return null;
  return [pin.slice(0, 3), pin.slice(3)];
}

/**
 * 生成灵动岛更新去重键：
 * - 普通横向灵动岛依赖系统 TimerIntervalLabel 自动走字，按状态/坐标/每 5 次 ACK 节流；
 * - iPhone Duo 竖向灵动岛使用双行静态文本显示持续时间，按整数秒边界刷新以保证走字准确。
 */
export function liveActivityUpdateKey(params: {
  statusLabel: string;
  latitude: number;
  longitude: number;
  packetsAcknowledged: number;
  startedAt: number;
  now?: number;
  duo: boolean;
}): string {
  const base = `${params.statusLabel}|${params.latitude.toFixed(5)}|${params.longitude.toFixed(5)}`;
  if (params.duo) {
    const secondBucket = Math.max(0, Math.floor(((params.now ?? Date.now()) - params.startedAt) / 1000));
    const ackBucket = params.packetsAcknowledged === 1 ? 1 : Math.floor(params.packetsAcknowledged / 5);
    return `${base}|s${secondBucket}|a${ackBucket}`;
  }
  const ackBucket = params.packetsAcknowledged === 1 ? 1 : Math.floor(params.packetsAcknowledged / 5);
  return `${base}|${ackBucket}`;
}
