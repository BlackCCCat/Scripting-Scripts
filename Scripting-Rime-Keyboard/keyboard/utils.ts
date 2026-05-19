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

export type TouchIntentState =
  | "idle"
  | "pending"
  | "longpress_locked"
  | "swipe_locked"
  | "tap_locked"
  | "cancelled";

export function createTouchIntentMachine(options: {
  longPressDuration?: number | (() => number);
  swipeTriggerDistance?: number | (() => number);
  safetyReleaseDelay?: number | (() => number);
  longPressSafetyReleaseDelay?: number | (() => number);
  isLongPressEnabled?: () => boolean;
  shouldCancelLongPress?: (details: any) => boolean;
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
  onLongPress?: () => void;
  onLongPressEnd?: () => void;
  onLongPressMove?: (details: any) => void;
  onSwipeStart?: () => void;
  onResolveSwipe?: (
    direction: "up" | "down" | "left" | "right",
    details: any,
  ) => boolean;
  onPress?: () => void;
}) {
  let state: TouchIntentState = "idle";
  let latestDetails: any = null;
  let longPressTimer: any = null;
  let safetyTimer: any = null;

  function clearLongPressTimer() {
    if (longPressTimer != null) clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function clearSafetyTimer() {
    if (safetyTimer != null) clearTimeout(safetyTimer);
    safetyTimer = null;
  }

  function reset() {
    clearLongPressTimer();
    clearSafetyTimer();
    latestDetails = null;
    state = "idle";
  }

  function isLongPressEnabled() {
    return options.isLongPressEnabled ? options.isLongPressEnabled() : true;
  }

  function shouldCancelLongPress(details: any) {
    return options.shouldCancelLongPress
      ? options.shouldCancelLongPress(details)
      : false;
  }

  function scheduleSafetyRelease(delay: number) {
    clearSafetyTimer();
    safetyTimer = setTimeout(() => {
      if (state !== "pending" && state !== "longpress_locked") return;
      const wasLongPress = state === "longpress_locked";
      if (wasLongPress) options.onLongPressEnd?.();
      options.onTouchEnd?.();
      state = "cancelled";
      reset();
    }, delay);
  }

  function scheduleLongPress() {
    clearLongPressTimer();
    if (!options.onLongPress || isLongPressEnabled() === false) return;
    const duration =
      typeof options.longPressDuration === "function"
        ? options.longPressDuration()
        : options.longPressDuration;
    longPressTimer = setTimeout(() => {
      if (state !== "pending") return;
      if (isLongPressEnabled() === false) {
        clearLongPressTimer();
        return;
      }
      if (latestDetails && shouldCancelLongPress(latestDetails)) {
        clearLongPressTimer();
        return;
      }
      state = "longpress_locked";
      options.onLongPress?.();
      const longPressSafetyDelay =
        typeof options.longPressSafetyReleaseDelay === "function"
          ? options.longPressSafetyReleaseDelay()
          : options.longPressSafetyReleaseDelay;
      scheduleSafetyRelease(longPressSafetyDelay ?? 2600);
    }, duration ?? 360);
  }

  return {
    getState() {
      return state;
    },
    start() {
      if (state !== "idle") return;
      state = "pending";
      options.onTouchStart?.();
      const safetyDelay =
        typeof options.safetyReleaseDelay === "function"
          ? options.safetyReleaseDelay()
          : options.safetyReleaseDelay;
      scheduleSafetyRelease(safetyDelay ?? 1500);
      scheduleLongPress();
    },
    update(details: any) {
      if (state !== "pending" && state !== "longpress_locked") return;
      latestDetails = details;
      if (state === "longpress_locked") {
        options.onLongPressMove?.(details);
        return;
      }
      if (shouldCancelLongPress(details)) {
        clearLongPressTimer();
      }
    },
    end(details: any) {
      latestDetails = details;
      clearLongPressTimer();
      clearSafetyTimer();
      if (state === "longpress_locked") {
        options.onLongPressEnd?.();
        options.onTouchEnd?.();
        state = "cancelled";
        reset();
        return;
      }
      if (state !== "pending") {
        reset();
        return;
      }
      const swipeTriggerDistance =
        typeof options.swipeTriggerDistance === "function"
          ? options.swipeTriggerDistance()
          : options.swipeTriggerDistance;
      const direction = dragDirection(details, swipeTriggerDistance);
      if (direction) {
        state = "swipe_locked";
        options.onSwipeStart?.();
        if (options.onResolveSwipe?.(direction, details)) {
          options.onTouchEnd?.();
          state = "cancelled";
          reset();
          return;
        }
      }
      state = "tap_locked";
      options.onPress?.();
      options.onTouchEnd?.();
      state = "cancelled";
      reset();
    },
    cancel(opts?: { invokeTouchEnd?: boolean; invokeLongPressEnd?: boolean }) {
      const wasPending = state === "pending";
      const wasLongPress = state === "longpress_locked";
      clearLongPressTimer();
      clearSafetyTimer();
      if ((wasPending || wasLongPress) && opts?.invokeTouchEnd) {
        if (wasLongPress && opts?.invokeLongPressEnd) {
          options.onLongPressEnd?.();
        }
        options.onTouchEnd?.();
      } else if (wasLongPress && opts?.invokeLongPressEnd) {
        options.onLongPressEnd?.();
      }
      state = "cancelled";
      reset();
    },
    dispose() {
      this.cancel({ invokeTouchEnd: true, invokeLongPressEnd: true });
    },
  };
}

export function nearestHitTarget(
  x: number,
  y: number,
  targets: KeyHitTarget[],
) {
  let best: KeyHitTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const fallbackThreshold = 3;
  const fallbackThresholdSquared = fallbackThreshold * fallbackThreshold;
  for (const target of targets) {
    const hasVerticalFrame = target.y != null && target.height != null;
    const withinX = x >= target.x && x <= target.x + target.width;
    const withinY = !hasVerticalFrame ||
      (y >= target.y! && y <= target.y! + target.height!);
    if (withinX && withinY) return target;

    const dx = x < target.x
      ? target.x - x
      : (x > target.x + target.width ? x - target.x - target.width : 0);
    let dy = 0;
    if (hasVerticalFrame) {
      const targetY = target.y!;
      const targetHeight = target.height!;
      dy = y < targetY
        ? targetY - y
        : (y > targetY + targetHeight ? y - targetY - targetHeight : 0);
    }
    const distance = dx * dx + dy * dy;
    if (
      distance < bestDistance ||
      (distance === bestDistance && target.width > (best?.width ?? 0))
    ) {
      best = target;
      bestDistance = distance;
    }
  }
  return bestDistance <= fallbackThresholdSquared ? best : null;
}

export function estimatedTextWidth(
  text: string,
  fontSize: number,
  fallbackCharWidth: number,
) {
  let total = 0;
  const Segmenter = (Intl as any).Segmenter;
  const segments: string[] = typeof Segmenter === "function"
    ? Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (item: any) => item.segment,
    )
    : Array.from(text);
  for (const segment of segments) {
    if (
      /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}/u
        .test(segment)
    ) {
      total += fontSize * 1.8;
    } else if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(segment)) {
      total += fontSize * 0.94;
    } else if (/[A-Z]/.test(segment)) total += fontSize * 0.64;
    else if (/[0-9]/.test(segment)) total += fontSize * 0.58;
    else if (/[mwMW]/.test(segment)) total += fontSize * 0.78;
    else if (/[a-z]/.test(segment)) total += fontSize * 0.56;
    else if (/\p{Script=Latin}/u.test(segment)) total += fontSize * 0.58;
    else if (/\s/.test(segment)) total += fontSize * 0.36;
    else total += Math.max(fallbackCharWidth, fontSize * 0.58);
  }
  return total;
}
