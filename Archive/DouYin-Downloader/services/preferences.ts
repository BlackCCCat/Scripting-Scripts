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
  const saved = Storage.get<Partial<Preferences>>(PREFS_KEY, { shared: false })
  const sharedSaved = Storage.get<Partial<Preferences>>(PREFS_KEY, { shared: true })
  if (!saved && sharedSaved) {
    Storage.set(PREFS_KEY, sharedSaved, { shared: false })
  }
  if (sharedSaved) {
    Storage.remove(PREFS_KEY, { shared: true })
  }

  return {
    ...DEFAULT_PREFERENCES,
    ...(saved || sharedSaved || {}),
  }
}

export function persistPreferences(next: Preferences) {
  Storage.set(PREFS_KEY, next, { shared: false })
  Storage.remove(PREFS_KEY, { shared: true })
}
