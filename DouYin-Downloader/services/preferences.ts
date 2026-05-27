export type SaveMode = "ask" | "photos" | "files"

export type Preferences = {
  defaultSaveMode: SaveMode
  preferNoWatermark: boolean
}

export const PREFS_KEY = "preferences"

export const DEFAULT_PREFERENCES: Preferences = {
  defaultSaveMode: "ask",
  preferNoWatermark: true,
}

export function getPreferences(): Preferences {
  const saved = Storage.get<Partial<Preferences>>(PREFS_KEY)
  return {
    ...DEFAULT_PREFERENCES,
    ...(saved || {}),
  }
}

export function persistPreferences(next: Preferences) {
  Storage.set(PREFS_KEY, next)
}
