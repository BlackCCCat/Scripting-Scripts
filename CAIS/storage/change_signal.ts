const CLIP_DATA_VERSION_KEY = "cais_clip_data_version_v1"
const LEGACY_SHARED_OPTIONS = { shared: true }
const listeners = new Set<(version: number) => void>()
let memoryVersion = 0

function getStorage(): any {
  return (globalThis as any).Storage
}

function removeLegacySharedClipDataVersion(): void {
  try {
    getStorage()?.remove?.(CLIP_DATA_VERSION_KEY, LEGACY_SHARED_OPTIONS)
  } catch {
  }
}

function writeClipDataVersionValue(version: number): boolean {
  const st = getStorage()
  try {
    if (typeof st?.set === "function") {
      return st.set(CLIP_DATA_VERSION_KEY, version) !== false
    } else if (typeof st?.setString === "function") {
      st.setString(CLIP_DATA_VERSION_KEY, String(version))
      return true
    }
  } catch {
  }
  return false
}

export function readClipDataVersion(): number {
  const st = getStorage()
  try {
    const raw = st?.get?.(CLIP_DATA_VERSION_KEY) ?? st?.getString?.(CLIP_DATA_VERSION_KEY)
    if (raw != null) {
      removeLegacySharedClipDataVersion()
      memoryVersion = Math.max(memoryVersion, Number(raw) || 0)
      return memoryVersion
    }
  } catch {
  }
  try {
    const raw = st?.get?.(CLIP_DATA_VERSION_KEY, LEGACY_SHARED_OPTIONS) ?? st?.getString?.(CLIP_DATA_VERSION_KEY, LEGACY_SHARED_OPTIONS)
    const version = Number(raw ?? 0) || 0
    if (raw != null && writeClipDataVersionValue(version)) removeLegacySharedClipDataVersion()
    memoryVersion = Math.max(memoryVersion, version)
    return memoryVersion
  } catch {
    return memoryVersion
  }
}

export function bumpClipDataVersion(): number {
  const next = Math.max(Date.now(), readClipDataVersion() + 1)
  memoryVersion = next
  if (writeClipDataVersionValue(next)) removeLegacySharedClipDataVersion()
  for (const listener of listeners) {
    try { listener(next) } catch {}
  }
  return next
}

export function subscribeClipDataChanges(listener: (version: number) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
