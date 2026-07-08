import {
  HAPTIC_LEVEL_MAX,
  HAPTIC_LEVEL_MIN,
  type RimeKeyboardSettings,
} from "../settings";
import type { KeyHitTarget } from "./types";

type CoreHapticsGlobals = {
  HapticEngine?: any;
  HapticPattern?: any;
  HapticEvent?: any;
  HapticEventParameter?: any;
};

type HapticPlayerPool = {
  players: any[];
  nextIndex: number;
};

const HAPTIC_PLAYER_POOL_SIZE = 3;
const SYSTEM_CLICK_MIN_INTERVAL_MS = 32;
let reusableHapticEngine: any = null;
let hapticEngineStartPromise: Promise<void> | null = null;
let hapticEngineReady = false;
let coreHapticsUnavailable = false;
let coreHapticsClickUnavailable = false;
const reusableHapticPlayers = new Map<string, HapticPlayerPool>();
let reusableClickPlayers: HapticPlayerPool | null = null;
let lastSystemClickAt = 0;
let cachedGraphemeSegmenter: any = null;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function playConfiguredClick(settings: RimeKeyboardSettings) {
  if (settings.hapticEngineClicks) {
    if (!hapticEngineReady || !reusableHapticEngine) return;
    if (coreHapticsClickUnavailable) return;
    try {
      const player = makeClickPlayer();
      player?.start?.(0);
    } catch {
      coreHapticsClickUnavailable = true;
    }
    return;
  }
  if (!settings.inputClicks) return;
  const now = Date.now();
  if (now - lastSystemClickAt < SYSTEM_CLICK_MIN_INTERVAL_MS) return;
  lastSystemClickAt = now;
  try {
    CustomKeyboard.playInputClick();
  } catch {}
}

function coreHaptics(): CoreHapticsGlobals {
  const scope = globalThis as any;
  return {
    HapticEngine: scope.HapticEngine,
    HapticPattern: scope.HapticPattern,
    HapticEvent: scope.HapticEvent,
    HapticEventParameter: scope.HapticEventParameter,
  };
}

function hapticProfile(level: number) {
  const normalized = (clamp(level, HAPTIC_LEVEL_MIN, HAPTIC_LEVEL_MAX) -
    HAPTIC_LEVEL_MIN) /
    (HAPTIC_LEVEL_MAX - HAPTIC_LEVEL_MIN);
  return {
    intensity: 0.32 + normalized * 0.58,
    sharpness: 0.34 + normalized * 0.46,
  };
}

function hapticPlayerKey(level: number) {
  const profile = hapticProfile(level);
  const intensity = Math.round(profile.intensity * 20) / 20;
  const sharpness = Math.round(profile.sharpness * 20) / 20;
  return `${intensity}:${sharpness}`;
}

function makeTransientPlayer(level: number) {
  if (!reusableHapticEngine) return null;
  const constructors = coreHaptics();
  const {
    HapticPattern,
    HapticEvent,
    HapticEventParameter,
  } = constructors;
  if (!HapticPattern || !HapticEvent || !HapticEventParameter) return null;
  const key = hapticPlayerKey(level);
  const cached = reusableHapticPlayers.get(key);
  if (cached) {
    const player = cached.players[cached.nextIndex];
    cached.nextIndex = (cached.nextIndex + 1) % cached.players.length;
    return player;
  }
  const profile = hapticProfile(level);
  const pattern = new HapticPattern([
    new HapticEvent("hapticTransient", [
      new HapticEventParameter("hapticIntensity", profile.intensity),
      new HapticEventParameter("hapticSharpness", profile.sharpness),
    ], 0),
  ]);
  const players = Array.from(
    { length: HAPTIC_PLAYER_POOL_SIZE },
    () => reusableHapticEngine.makePlayer(pattern),
  );
  reusableHapticPlayers.set(key, { players, nextIndex: 1 });
  return players[0];
}

function makeClickPlayer() {
  if (!reusableHapticEngine || coreHapticsClickUnavailable) return null;
  const constructors = coreHaptics();
  const {
    HapticPattern,
    HapticEvent,
    HapticEventParameter,
    HapticEngine,
  } = constructors as CoreHapticsGlobals & { HapticEngine?: any };
  if (
    !HapticPattern || !HapticEvent || !HapticEventParameter ||
    HapticEngine?.supportsAudio === false
  ) {
    coreHapticsClickUnavailable = true;
    return null;
  }
  if (reusableClickPlayers) {
    const player = reusableClickPlayers.players[reusableClickPlayers.nextIndex];
    reusableClickPlayers.nextIndex = (reusableClickPlayers.nextIndex + 1) %
      reusableClickPlayers.players.length;
    return player;
  }
  try {
    const pattern = new HapticPattern([
      new HapticEvent(
        "audioContinuous",
        [
          new HapticEventParameter("audioVolume", 0.28),
          new HapticEventParameter("audioPitch", 0.18),
          new HapticEventParameter("attackTime", 0),
          new HapticEventParameter("decayTime", 0.012),
          new HapticEventParameter("releaseTime", 0.008),
        ],
        0,
        0.018,
      ),
    ]);
    const players = Array.from(
      { length: HAPTIC_PLAYER_POOL_SIZE },
      () => reusableHapticEngine.makePlayer(pattern),
    );
    reusableClickPlayers = { players, nextIndex: 1 };
    return players[0];
  } catch {
    coreHapticsClickUnavailable = true;
    return null;
  }
}

function resetCoreHaptics() {
  reusableHapticPlayers.clear();
  reusableClickPlayers = null;
  hapticEngineReady = false;
  hapticEngineStartPromise = null;
}

export function disposeConfiguredHaptics() {
  const engine = reusableHapticEngine;
  reusableHapticEngine = null;
  resetCoreHaptics();
  if (!engine) return;
  try {
    void engine.stop?.();
  } catch {}
  try {
    engine.dispose?.();
  } catch {}
}

export function prepareConfiguredHaptics(settings: RimeKeyboardSettings) {
  if (
    (!settings.haptics && !settings.hapticEngineClicks) ||
    coreHapticsUnavailable
  ) {
    return;
  }
  if (hapticEngineReady || hapticEngineStartPromise) return;
  const { HapticEngine } = coreHaptics();
  if (!HapticEngine) {
    return;
  }
  try {
    if (
      settings.haptics && HapticEngine.supportsHaptics === false &&
      (!settings.hapticEngineClicks || HapticEngine.supportsAudio === false)
    ) {
      coreHapticsUnavailable = true;
      return;
    }
    if (!reusableHapticEngine) {
      reusableHapticEngine = new HapticEngine();
      try {
        reusableHapticEngine.autoShutdownEnabled = false;
      } catch {}
      try {
        reusableHapticEngine.playsHapticsOnly = false;
      } catch {}
      try {
        reusableHapticEngine.playsAudioOnly = false;
      } catch {}
      try {
        reusableHapticEngine.isMutedForAudio = !settings.hapticEngineClicks;
      } catch {}
      reusableHapticEngine.onStopped = () => {
        resetCoreHaptics();
      };
      reusableHapticEngine.onReset = () => {
        resetCoreHaptics();
        prepareConfiguredHaptics(settings);
      };
    }
    const startResult = reusableHapticEngine.startAsync
      ? reusableHapticEngine.startAsync()
      : reusableHapticEngine.start();
    hapticEngineStartPromise = Promise.resolve(startResult)
      .then(() => {
        hapticEngineReady = true;
        hapticEngineStartPromise = null;
        if (settings.haptics) {
          makeTransientPlayer(settings.hapticLevel);
        }
        if (settings.hapticEngineClicks) makeClickPlayer();
      })
      .catch(() => {
        disposeConfiguredHaptics();
        coreHapticsUnavailable = true;
      });
  } catch {
    disposeConfiguredHaptics();
    coreHapticsUnavailable = true;
  }
}

export function playConfiguredHaptic(
  settings: RimeKeyboardSettings,
  level = settings.hapticLevel,
) {
  if (!settings.haptics) return;
  const { HapticEngine } = coreHaptics();
  if (coreHapticsUnavailable) return;
  if (HapticEngine) {
    prepareConfiguredHaptics(settings);
    if (coreHapticsUnavailable) return;
    if (!hapticEngineReady || !reusableHapticEngine) return;
    try {
      const player = makeTransientPlayer(level);
      player?.start?.(0);
      return;
    } catch {
      disposeConfiguredHaptics();
      return;
    }
  }
  try {
    const Haptics = (globalThis as any).Haptics;
    if (Haptics?.transient && Haptics.supportsHaptics !== false) {
      const profile = hapticProfile(level);
      void Haptics.transient(profile.intensity, profile.sharpness);
      return;
    }
  } catch {}
}

export function playPreparedConfiguredHaptic(
  settings: RimeKeyboardSettings,
  level = settings.hapticLevel,
) {
  if (!settings.haptics || coreHapticsUnavailable) return;
  if (!hapticEngineReady || !reusableHapticEngine) return;
  try {
    const player = makeTransientPlayer(level);
    player?.start?.(0);
  } catch {
    disposeConfiguredHaptics();
  }
}

export function hapticInterval(settings: RimeKeyboardSettings) {
  const normalized =
    (clamp(settings.hapticLevel, HAPTIC_LEVEL_MIN, HAPTIC_LEVEL_MAX) -
      HAPTIC_LEVEL_MIN) /
    (HAPTIC_LEVEL_MAX - HAPTIC_LEVEL_MIN);
  return Math.round(130 - normalized * 100);
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
    const duration = typeof options.longPressDuration === "function"
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
      const safetyDelay = typeof options.safetyReleaseDelay === "function"
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
      (cachedGraphemeSegmenter ??= new Segmenter(undefined, {
        granularity: "grapheme",
      })).segment(text),
      (item: any) => item.segment,
    )
    : Array.from(text);
  for (const segment of segments) {
    if (
      /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}/u
        .test(segment)
    ) {
      total += fontSize * 1.2;
    } else if (/[\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/.test(segment)) {
      total += fontSize * 0.96;
    } else if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(segment)) {
      total += fontSize * 0.95;
    } else if (/[A-Z]/.test(segment)) total += fontSize * 0.64;
    else if (/[0-9]/.test(segment)) total += fontSize * 0.58;
    else if (/[mwMW]/.test(segment)) total += fontSize * 0.78;
    else if (/[a-z]/.test(segment)) total += fontSize * 0.56;
    else if (/\p{Script=Latin}/u.test(segment)) total += fontSize * 0.58;
    else if (/[,.;:!'"`|/\\()[\]{}<>~@#$%^&*_+=?-]/.test(segment)) {
      total += fontSize * 0.42;
    } else if (/\s/.test(segment)) total += fontSize * 0.36;
    else total += Math.max(fallbackCharWidth, fontSize * 0.58);
  }
  return total;
}
