const APP_FULLSCREEN_KEY = "cais_app_fullscreen_v1"
const SHARED_STORAGE_OPTIONS = { shared: true }

function storage(): any {
  return (globalThis as any).Storage
}

export function readAppFullscreen(defaultValue = false): boolean {
  const st = storage()
  try {
    const value = st?.get?.(APP_FULLSCREEN_KEY, SHARED_STORAGE_OPTIONS) ?? st?.get?.(APP_FULLSCREEN_KEY)
    if (typeof value === "boolean") return value
    if (typeof value === "string") return value === "true"
  } catch {
  }
  return defaultValue
}

export function writeAppFullscreen(value: boolean): void {
  const st = storage()
  try {
    if (typeof st?.set === "function") {
      st.set(APP_FULLSCREEN_KEY, value, SHARED_STORAGE_OPTIONS)
      st.set(APP_FULLSCREEN_KEY, value)
    } else if (typeof st?.setString === "function") {
      st.setString(APP_FULLSCREEN_KEY, String(value), SHARED_STORAGE_OPTIONS)
      st.setString(APP_FULLSCREEN_KEY, String(value))
    }
  } catch {
  }
}
