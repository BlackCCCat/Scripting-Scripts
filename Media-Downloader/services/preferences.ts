export type SaveMode = "ask" | "photos" | "files"
export type LanguageMode = "system" | "zh" | "en"

export type Preferences = {
  defaultSaveMode: SaveMode
  preferNoWatermark: boolean
  language: LanguageMode
  keepHistoryFiles: boolean
  historyCacheLimitMB: number | null
  historyRecordLimit: number | null
  ytDlpReady: boolean | null
  ytDlpVersion: string | null
  ytDlpCheckedAt: string | null
  ytDlpDetectionVersion: number
}

export const PREFS_KEY = "preferences"
export const YTDLP_DETECTION_VERSION = 2

export const DEFAULT_PREFERENCES: Preferences = {
  defaultSaveMode: "ask",
  preferNoWatermark: true,
  language: "system",
  keepHistoryFiles: false,
  historyCacheLimitMB: null,
  historyRecordLimit: null,
  ytDlpReady: null,
  ytDlpVersion: null,
  ytDlpCheckedAt: null,
  ytDlpDetectionVersion: YTDLP_DETECTION_VERSION,
}

export function getPreferences(): Preferences {
  const saved = Storage.get<Partial<Preferences>>(PREFS_KEY, { shared: false })
  const sharedSaved = Storage.get<Partial<Preferences>>(PREFS_KEY, { shared: true })
  if (!saved && sharedSaved) {
    Storage.set(PREFS_KEY, sharedSaved, { shared: false })
  }
  if (sharedSaved) {
    Storage.remove(PREFS_KEY, { shared: true })
  }

  const next = {
    ...DEFAULT_PREFERENCES,
    ...(saved || sharedSaved || {}),
  }
  if ((saved || sharedSaved)?.ytDlpReady === false && (saved || sharedSaved)?.ytDlpDetectionVersion !== YTDLP_DETECTION_VERSION) {
    next.ytDlpReady = null
    next.ytDlpVersion = null
    next.ytDlpCheckedAt = null
  }
  next.ytDlpDetectionVersion = YTDLP_DETECTION_VERSION
  return next
}

export function persistPreferences(next: Preferences) {
  Storage.set(PREFS_KEY, next, { shared: false })
  Storage.remove(PREFS_KEY, { shared: true })
}
