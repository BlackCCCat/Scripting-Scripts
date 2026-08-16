export const STORAGE_KEYS = {
  packs: "tg-stickers-keyboard:packs:v1",
  botToken: "tg-stickers-keyboard:bot-token:v1",
  targetScript: "tg-stickers-keyboard:target-keyboard-script:v1",
  recentStickers: "tg-stickers-keyboard:recent-stickers:v1",
  soundEnabled: "tg-stickers-keyboard:sound-enabled:v1",
  dynamicStickersEnabled: "tg-stickers-keyboard:dynamic-stickers-enabled:v1",
  photoAlbumId: "tg-stickers-keyboard:photo-album-id:v1",
  photoAssets: "tg-stickers-keyboard:photo-assets:v1",
} as const

const LEGACY_SHARED_OPTIONS = { shared: true }
const pendingPrivateValues = new Map<string, unknown>()

export function migrateLegacySharedStorage() {
  for (const key of Object.values(STORAGE_KEYS)) {
    readPrivateStorage<unknown>(key)
  }
}

export function readPrivateStorage<T>(key: string): T | null {
  if (pendingPrivateValues.has(key)) {
    const pendingValue = pendingPrivateValues.get(key) as T
    const privateValue = Storage.get<T>(key)
    if (storageValuesEqual(privateValue, pendingValue)) {
      Storage.remove(key, LEGACY_SHARED_OPTIONS)
      pendingPrivateValues.delete(key)
      return privateValue
    }
    return pendingValue
  }

  const privateValue = Storage.get<T>(key)
  if (privateValue != null) {
    Storage.remove(key, LEGACY_SHARED_OPTIONS)
    return privateValue
  }

  const sharedValue = Storage.get<T>(key, LEGACY_SHARED_OPTIONS)
  if (sharedValue == null) return null

  if (Storage.set(key, sharedValue)) {
    pendingPrivateValues.set(key, sharedValue)
  }
  return sharedValue
}

export function writePrivateStorage<T>(key: string, value: T): boolean {
  const stored = Storage.set(key, value)
  if (stored) {
    pendingPrivateValues.set(key, value)
  }
  return stored
}

export function removePrivateStorage(key: string) {
  pendingPrivateValues.delete(key)
  Storage.remove(key)
  Storage.remove(key, LEGACY_SHARED_OPTIONS)
}

function storageValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left == null || right == null) return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
