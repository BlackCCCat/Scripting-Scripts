const CLIP_DATA_VERSION_KEY = "cais_clip_data_version_v1"
const LEGACY_SHARED_OPTIONS = { shared: true }
const listeners = new Set<(version: number) => void>()
let memoryVersion = 0

function getStorage(): any {
  return (globalThis as any).Storage
}

function writeClipDataVersionValue(version: number): void {
  const st = getStorage()
  try {
    if (typeof st?.set === "function") {
      st.set(CLIP_DATA_VERSION_KEY, version)
    } else {
      st?.setString?.(CLIP_DATA_VERSION_KEY, String(version))
    }
  } catch {
  }
}

export function readClipDataVersion(): number {
  const st = getStorage()
  try {
    const raw = st?.get?.(CLIP_DATA_VERSION_KEY) ?? st?.getString?.(CLIP_DATA_VERSION_KEY)
    if (raw != null) {
      memoryVersion = Math.max(memoryVersion, Number(raw) || 0)
      return memoryVersion
    }
  } catch {
  }
  try {
    const raw = st?.get?.(CLIP_DATA_VERSION_KEY, LEGACY_SHARED_OPTIONS) ?? st?.getString?.(CLIP_DATA_VERSION_KEY, LEGACY_SHARED_OPTIONS)
    const version = Number(raw ?? 0) || 0
    if (version > 0) writeClipDataVersionValue(version)
    memoryVersion = Math.max(memoryVersion, version)
    return memoryVersion
  } catch {
    return memoryVersion
  }
}

export function bumpClipDataVersion(): number {
  const next = Math.max(Date.now(), readClipDataVersion() + 1)
  memoryVersion = next
  writeClipDataVersionValue(next)
  for (const listener of listeners) {
    try { listener(next) } catch {}
  }
  return next
}

export function subscribeClipDataChanges(listener: (version: number) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
