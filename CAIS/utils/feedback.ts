import type { CaisSettings } from "../types"

type CoreHapticsGlobals = {
  HapticEngine?: any
  HapticPattern?: any
  HapticEvent?: any
  HapticEventParameter?: any
}

type HapticPlayerPool = {
  players: any[]
  nextIndex: number
}

const HAPTIC_PLAYER_POOL_SIZE = 3
const SYSTEM_CLICK_MIN_INTERVAL_MS = 32
const HAPTIC_LEVEL_MIN = 1
const HAPTIC_LEVEL_MAX = 10
const DEFAULT_HAPTIC_LEVEL = 7

let reusableHapticEngine: any = null
let hapticEngineStartPromise: Promise<void> | null = null
let hapticEngineReady = false
let coreHapticsUnavailable = false
let coreHapticsClickUnavailable = false
let reusableClickPlayers: HapticPlayerPool | null = null
const reusableHapticPlayers = new Map<string, HapticPlayerPool>()
let lastSystemClickAt = 0

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function coreHaptics(): CoreHapticsGlobals {
  const scope = globalThis as any
  return {
    HapticEngine: scope.HapticEngine,
    HapticPattern: scope.HapticPattern,
    HapticEvent: scope.HapticEvent,
    HapticEventParameter: scope.HapticEventParameter,
  }
}

function hapticProfile(level = DEFAULT_HAPTIC_LEVEL) {
  const normalized = (clamp(level, HAPTIC_LEVEL_MIN, HAPTIC_LEVEL_MAX) - HAPTIC_LEVEL_MIN) /
    (HAPTIC_LEVEL_MAX - HAPTIC_LEVEL_MIN)
  return {
    intensity: 0.32 + normalized * 0.58,
    sharpness: 0.34 + normalized * 0.46,
  }
}

function hapticPlayerKey(level = DEFAULT_HAPTIC_LEVEL) {
  const profile = hapticProfile(level)
  const intensity = Math.round(profile.intensity * 20) / 20
  const sharpness = Math.round(profile.sharpness * 20) / 20
  return `${intensity}:${sharpness}`
}

function makeTransientPlayer(level = DEFAULT_HAPTIC_LEVEL) {
  if (!reusableHapticEngine) return null
  const { HapticPattern, HapticEvent, HapticEventParameter } = coreHaptics()
  if (!HapticPattern || !HapticEvent || !HapticEventParameter) return null
  const key = hapticPlayerKey(level)
  const cached = reusableHapticPlayers.get(key)
  if (cached) {
    const player = cached.players[cached.nextIndex]
    cached.nextIndex = (cached.nextIndex + 1) % cached.players.length
    return player
  }
  const profile = hapticProfile(level)
  const pattern = new HapticPattern([
    new HapticEvent("hapticTransient", [
      new HapticEventParameter("hapticIntensity", profile.intensity),
      new HapticEventParameter("hapticSharpness", profile.sharpness),
    ], 0),
  ])
  const players = Array.from(
    { length: HAPTIC_PLAYER_POOL_SIZE },
    () => reusableHapticEngine.makePlayer(pattern),
  )
  reusableHapticPlayers.set(key, { players, nextIndex: 1 })
  return players[0]
}

function makeClickPlayer() {
  if (!reusableHapticEngine || coreHapticsClickUnavailable) return null
  const { HapticPattern, HapticEvent, HapticEventParameter, HapticEngine } = coreHaptics()
  if (
    !HapticPattern || !HapticEvent || !HapticEventParameter ||
    HapticEngine?.supportsAudio === false
  ) {
    coreHapticsClickUnavailable = true
    return null
  }
  if (reusableClickPlayers) {
    const player = reusableClickPlayers.players[reusableClickPlayers.nextIndex]
    reusableClickPlayers.nextIndex = (reusableClickPlayers.nextIndex + 1) % reusableClickPlayers.players.length
    return player
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
    ])
    const players = Array.from(
      { length: HAPTIC_PLAYER_POOL_SIZE },
      () => reusableHapticEngine.makePlayer(pattern),
    )
    reusableClickPlayers = { players, nextIndex: 1 }
    return players[0]
  } catch {
    coreHapticsClickUnavailable = true
    return null
  }
}

function resetCoreHaptics() {
  reusableHapticPlayers.clear()
  reusableClickPlayers = null
  hapticEngineReady = false
  hapticEngineStartPromise = null
}

export function disposeCaisFeedback() {
  const engine = reusableHapticEngine
  reusableHapticEngine = null
  resetCoreHaptics()
  if (!engine) return
  try {
    void engine.stop?.()
  } catch {}
  try {
    engine.dispose?.()
  } catch {}
}

export function prepareCaisFeedback(settings?: Pick<CaisSettings, "hapticEngineClicks">) {
  if (coreHapticsUnavailable) return
  if (hapticEngineReady || hapticEngineStartPromise) return
  const { HapticEngine } = coreHaptics()
  if (!HapticEngine) return
  const useCoreClick = Boolean(settings?.hapticEngineClicks)
  try {
    if (HapticEngine.supportsHaptics === false && (!useCoreClick || HapticEngine.supportsAudio === false)) {
      coreHapticsUnavailable = true
      return
    }
    if (!reusableHapticEngine) {
      reusableHapticEngine = new HapticEngine()
      try { reusableHapticEngine.autoShutdownEnabled = false } catch {}
      try { reusableHapticEngine.playsHapticsOnly = false } catch {}
      try { reusableHapticEngine.playsAudioOnly = false } catch {}
      try { reusableHapticEngine.isMutedForAudio = !useCoreClick } catch {}
      reusableHapticEngine.onStopped = () => {
        resetCoreHaptics()
      }
      reusableHapticEngine.onReset = () => {
        resetCoreHaptics()
        prepareCaisFeedback(settings)
      }
    }
    const startResult = reusableHapticEngine.startAsync
      ? reusableHapticEngine.startAsync()
      : reusableHapticEngine.start()
    hapticEngineStartPromise = Promise.resolve(startResult)
      .then(() => {
        hapticEngineReady = true
        hapticEngineStartPromise = null
        makeTransientPlayer(DEFAULT_HAPTIC_LEVEL)
        if (useCoreClick) makeClickPlayer()
      })
      .catch(() => {
        disposeCaisFeedback()
        coreHapticsUnavailable = true
      })
  } catch {
    disposeCaisFeedback()
    coreHapticsUnavailable = true
  }
}

export function playCaisHaptic() {
  if (coreHapticsUnavailable) return
  const { HapticEngine } = coreHaptics()
  if (HapticEngine) {
    prepareCaisFeedback()
    if (!hapticEngineReady || !reusableHapticEngine) return
    try {
      makeTransientPlayer(DEFAULT_HAPTIC_LEVEL)?.start?.(0)
      return
    } catch {
      disposeCaisFeedback()
      return
    }
  }
  try {
    const Haptics = (globalThis as any).Haptics
    if (Haptics?.transient && Haptics.supportsHaptics !== false) {
      const profile = hapticProfile(DEFAULT_HAPTIC_LEVEL)
      void Haptics.transient(profile.intensity, profile.sharpness)
    }
  } catch {}
}

function playCoreClick() {
  if (!hapticEngineReady || !reusableHapticEngine) return
  if (coreHapticsClickUnavailable) return
  try {
    makeClickPlayer()?.start?.(0)
  } catch {
    coreHapticsClickUnavailable = true
  }
}

function playSystemClick() {
  const now = Date.now()
  if (now - lastSystemClickAt < SYSTEM_CLICK_MIN_INTERVAL_MS) return
  lastSystemClickAt = now
  try {
    ;(globalThis as any).CustomKeyboard?.playInputClick?.()
  } catch {}
}

export function playCaisFeedback(settings?: Pick<CaisSettings, "inputClicks" | "hapticEngineClicks">) {
  prepareCaisFeedback(settings)
  if (settings?.hapticEngineClicks) {
    playCoreClick()
  } else if (settings?.inputClicks) {
    playSystemClick()
  }
  playCaisHaptic()
}
