type CoreHapticsGlobals = {
  HapticEngine?: any
  HapticPattern?: any
  HapticEvent?: any
  HapticEventParameter?: any
}

export type KeyboardFeedbackSettings = {
  soundEnabled: boolean
}

type HapticPlayerPool = {
  players: any[]
  nextIndex: number
}

const HAPTIC_PLAYER_POOL_SIZE = 3
const HAPTIC_LEVEL_MIN = 1
const HAPTIC_LEVEL_MAX = 10
const HAPTIC_LEVEL = 7
const SYSTEM_CLICK_MIN_INTERVAL_MS = 32
let reusableHapticEngine: any = null
let hapticEngineStartPromise: Promise<void> | null = null
let hapticEngineReady = false
let coreHapticsUnavailable = false
let coreHapticsClickUnavailable = false
let reusableHapticPlayers: HapticPlayerPool | null = null
let reusableClickPlayers: HapticPlayerPool | null = null
let lastSystemClickAt = 0

function coreHaptics(): CoreHapticsGlobals {
  const scope = globalThis as any
  return {
    HapticEngine: scope.HapticEngine,
    HapticPattern: scope.HapticPattern,
    HapticEvent: scope.HapticEvent,
    HapticEventParameter: scope.HapticEventParameter,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function hapticProfile(level = HAPTIC_LEVEL) {
  const normalized = (clamp(level, HAPTIC_LEVEL_MIN, HAPTIC_LEVEL_MAX) - HAPTIC_LEVEL_MIN) /
    (HAPTIC_LEVEL_MAX - HAPTIC_LEVEL_MIN)
  return {
    intensity: 0.32 + normalized * 0.58,
    sharpness: 0.34 + normalized * 0.46,
  }
}

function makeTransientPlayer() {
  if (!reusableHapticEngine) return null
  const { HapticPattern, HapticEvent, HapticEventParameter } = coreHaptics()
  if (!HapticPattern || !HapticEvent || !HapticEventParameter) return null
  if (reusableHapticPlayers) {
    const player = reusableHapticPlayers.players[reusableHapticPlayers.nextIndex]
    reusableHapticPlayers.nextIndex = (reusableHapticPlayers.nextIndex + 1) % reusableHapticPlayers.players.length
    return player
  }

  const profile = hapticProfile()
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
  reusableHapticPlayers = { players, nextIndex: 1 }
  return players[0]
}

function makeClickPlayer() {
  if (!reusableHapticEngine || coreHapticsClickUnavailable) return null
  const { HapticPattern, HapticEvent, HapticEventParameter, HapticEngine } = coreHaptics()
  if (!HapticPattern || !HapticEvent || !HapticEventParameter || HapticEngine?.supportsAudio === false) {
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
      new HapticEvent("audioContinuous", [
        new HapticEventParameter("audioVolume", 0.28),
        new HapticEventParameter("audioPitch", 0.18),
        new HapticEventParameter("attackTime", 0),
        new HapticEventParameter("decayTime", 0.012),
        new HapticEventParameter("releaseTime", 0.008),
      ], 0, 0.018),
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
  reusableHapticPlayers = null
  reusableClickPlayers = null
  hapticEngineReady = false
  hapticEngineStartPromise = null
}

function playSystemInputClick(settings: KeyboardFeedbackSettings) {
  if (!settings.soundEnabled) return
  const now = Date.now()
  if (now - lastSystemClickAt < SYSTEM_CLICK_MIN_INTERVAL_MS) return
  lastSystemClickAt = now
  try { CustomKeyboard.playInputClick() } catch {}
}

export function disposeKeyboardFeedback() {
  const engine = reusableHapticEngine
  reusableHapticEngine = null
  resetCoreHaptics()
  if (!engine) return
  try { void engine.stop?.() } catch {}
  try { engine.dispose?.() } catch {}
}

export function prepareKeyboardFeedback(settings: KeyboardFeedbackSettings) {
  if (coreHapticsUnavailable || hapticEngineReady || hapticEngineStartPromise) return
  const { HapticEngine } = coreHaptics()
  if (!HapticEngine) return

  try {
    if (HapticEngine.supportsHaptics === false && HapticEngine.supportsAudio === false) {
      coreHapticsUnavailable = true
      return
    }
    if (!reusableHapticEngine) {
      reusableHapticEngine = new HapticEngine()
      try { reusableHapticEngine.autoShutdownEnabled = false } catch {}
      try { reusableHapticEngine.playsHapticsOnly = false } catch {}
      try { reusableHapticEngine.playsAudioOnly = false } catch {}
      reusableHapticEngine.onStopped = () => resetCoreHaptics()
      reusableHapticEngine.onReset = () => {
        resetCoreHaptics()
        prepareKeyboardFeedback(settings)
      }
    }
    try { reusableHapticEngine.isMutedForAudio = !settings.soundEnabled } catch {}

    const startResult = reusableHapticEngine.startAsync
      ? reusableHapticEngine.startAsync()
      : reusableHapticEngine.start()
    hapticEngineStartPromise = Promise.resolve(startResult)
      .then(() => {
        hapticEngineReady = true
        hapticEngineStartPromise = null
        makeTransientPlayer()
        if (settings.soundEnabled) makeClickPlayer()
      })
      .catch(() => {
        disposeKeyboardFeedback()
        coreHapticsUnavailable = true
      })
  } catch {
    disposeKeyboardFeedback()
    coreHapticsUnavailable = true
  }
}

function playPreparedClick(settings: KeyboardFeedbackSettings) {
  if (!settings.soundEnabled) return
  if (!hapticEngineReady || !reusableHapticEngine || coreHapticsClickUnavailable) {
    playSystemInputClick(settings)
    return
  }
  try {
    const player = makeClickPlayer()
    player?.start?.(0)
  } catch {
    coreHapticsClickUnavailable = true
    playSystemInputClick(settings)
  }
}

function playPreparedHaptic() {
  if (!hapticEngineReady || !reusableHapticEngine || coreHapticsUnavailable) {
    try { HapticFeedback.selection() } catch {}
    return
  }
  try {
    const player = makeTransientPlayer()
    player?.start?.(0)
  } catch {
    disposeKeyboardFeedback()
    try { HapticFeedback.selection() } catch {}
  }
}

export function playKeyboardFeedback(settings: KeyboardFeedbackSettings) {
  prepareKeyboardFeedback(settings)
  playPreparedClick(settings)
  playPreparedHaptic()
}
