const CLIP_DATA_VERSION_KEY = "cais_clip_data_version_v1"
const SHARED_OPTIONS = { shared: true }

function getStorage(): any {
  return (globalThis as any).Storage
}

export function readClipDataVersion(): number {
  const st = getStorage()
  try {
    const raw = st?.get?.(CLIP_DATA_VERSION_KEY, SHARED_OPTIONS) ?? st?.getString?.(CLIP_DATA_VERSION_KEY, SHARED_OPTIONS)
    if (raw != null) return Number(raw) || 0
  } catch {
  }
  try {
    const raw = st?.get?.(CLIP_DATA_VERSION_KEY) ?? st?.getString?.(CLIP_DATA_VERSION_KEY)
    return Number(raw ?? 0) || 0
  } catch {
    return 0
  }
}

export function bumpClipDataVersion(): number {
  const next = Math.max(Date.now(), readClipDataVersion() + 1)
  const st = getStorage()
  try {
    if (typeof st?.set === "function") {
      st.set(CLIP_DATA_VERSION_KEY, next)
    } else {
      st?.setString?.(CLIP_DATA_VERSION_KEY, String(next))
    }
  } catch {
  }
  try {
    if (typeof st?.set === "function") {
      st.set(CLIP_DATA_VERSION_KEY, next, SHARED_OPTIONS)
    } else {
      st?.setString?.(CLIP_DATA_VERSION_KEY, String(next), SHARED_OPTIONS)
    }
  } catch {
  }
  return next
}
