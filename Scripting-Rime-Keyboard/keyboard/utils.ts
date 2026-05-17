import type { RimeKeyboardSettings } from "../settings";
import type { KeyHitTarget } from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function playConfiguredClick(settings: RimeKeyboardSettings) {
  if (!settings.inputClicks) return;
  try {
    CustomKeyboard.playInputClick();
  } catch {}
}

export function playConfiguredHaptic(
  settings: RimeKeyboardSettings,
  level = settings.hapticLevel,
) {
  if (!settings.haptics) return;
  try {
    switch (level) {
      case 1:
        HapticFeedback.selection();
        break;
      case 2:
        HapticFeedback.lightImpact();
        break;
      case 4:
        HapticFeedback.heavyImpact();
        break;
      case 5:
        HapticFeedback.rigidImpact();
        break;
      default:
        HapticFeedback.mediumImpact();
        break;
    }
  } catch {}
}

export function inputClickInterval(settings: RimeKeyboardSettings) {
  switch (settings.inputClickLevel) {
    case 1:
      return 220;
    case 2:
      return 160;
    case 4:
      return 82;
    case 5:
      return 55;
    default:
      return 110;
  }
}

export function hapticInterval(settings: RimeKeyboardSettings) {
  switch (settings.hapticLevel) {
    case 1:
      return 130;
    case 2:
      return 95;
    case 4:
      return 45;
    case 5:
      return 30;
    default:
      return 65;
  }
}

export function dragDirection(
  details: any,
  threshold = 16,
): "up" | "down" | "left" | "right" | null {
  const dx = Number(details?.translation?.width ?? 0);
  const dy = Number(details?.translation?.height ?? 0);
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "up" : "down";
  return dx < 0 ? "left" : "right";
}

export function nearestHitTarget(
  x: number,
  y: number,
  targets: KeyHitTarget[],
) {
  let best: KeyHitTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const dx = x < target.x
      ? target.x - x
      : (x > target.x + target.width ? x - target.x - target.width : 0);
    const dy = target.y == null || target.height == null
      ? 0
      : (y < target.y
        ? target.y - y
        : (y > target.y + target.height ? y - target.y - target.height : 0));
    const distance = dx * dx + dy * dy;
    if (
      distance < bestDistance ||
      (distance === bestDistance && target.width > (best?.width ?? 0))
    ) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export function estimatedTextWidth(
  text: string,
  fontSize: number,
  fallbackCharWidth: number,
) {
  let total = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) total += fontSize * 0.94;
    else if (/[A-Z0-9]/.test(ch)) total += fontSize * 0.56;
    else if (/[a-z]/.test(ch)) total += fontSize * 0.5;
    else if (/\p{Script=Latin}/u.test(ch)) total += fontSize * 0.5;
    else if (/\s/.test(ch)) total += fontSize * 0.32;
    else total += fallbackCharWidth;
  }
  return total;
}
