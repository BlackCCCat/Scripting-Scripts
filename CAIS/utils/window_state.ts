const APP_FULLSCREEN_KEY = "cais_app_fullscreen_v1"
const LEGACY_SHARED_STORAGE_OPTIONS = { shared: true }

function storage(): any {
  return (globalThis as any).Storage
}

function removeLegacySharedAppFullscreen(): void {
  try {
    storage()?.remove?.(APP_FULLSCREEN_KEY, LEGACY_SHARED_STORAGE_OPTIONS)
  } catch {
  }
}

export function readAppFullscreen(defaultValue = false): boolean {
  const st = storage()
  try {
    const value = st?.get?.(APP_FULLSCREEN_KEY)
    if (typeof value === "boolean") {
      removeLegacySharedAppFullscreen()
      return value
    }
    if (typeof value === "string") {
      removeLegacySharedAppFullscreen()
      return value === "true"
    }
  } catch {
  }
  try {
    const value = st?.get?.(APP_FULLSCREEN_KEY, LEGACY_SHARED_STORAGE_OPTIONS)
    if (typeof value === "boolean") {
      writeAppFullscreen(value)
      return value
    }
    if (typeof value === "string") {
      const parsed = value === "true"
      writeAppFullscreen(parsed)
      return parsed
    }
  } catch {
  }
  return defaultValue
}

export function writeAppFullscreen(value: boolean): void {
  const st = storage()
  try {
    if (typeof st?.set === "function") {
      if (st.set(APP_FULLSCREEN_KEY, value) !== false) removeLegacySharedAppFullscreen()
    } else if (typeof st?.setString === "function") {
      st.setString(APP_FULLSCREEN_KEY, String(value))
      removeLegacySharedAppFullscreen()
    }
  } catch {
  }
}
