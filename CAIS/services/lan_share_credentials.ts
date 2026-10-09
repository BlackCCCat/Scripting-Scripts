const LAN_SHARE_TOKEN_KEY = "cais_lan_share_token_v1"
const TRUSTED_DEVICES_KEY = "cais_lan_trusted_devices_v1"
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const ACCESS_CODE_LENGTH = 8
const MAX_TRUSTED_DEVICES = 32

type StoredTrustedDevice = {
  id: string
  name: string
  createdAt: number
  tokenHash: string
}

export type TrustedDevice = Omit<StoredTrustedDevice, "tokenHash">

function storage(): any {
  return (globalThis as any).Storage
}

function createToken(): string {
  try {
    const bytes = (globalThis as any).Crypto?.generateSymmetricKey?.(128)?.toIntArray?.()
    if (Array.isArray(bytes) && bytes.length >= ACCESS_CODE_LENGTH) {
      return bytes.slice(0, ACCESS_CODE_LENGTH)
        .map((value: number) => ACCESS_CODE_ALPHABET[value % ACCESS_CODE_ALPHABET.length])
        .join("")
    }
  } catch {
  }
  const uuid = String((globalThis as any).UUID?.string?.() ?? `${Date.now()}${Math.random()}`)
  let seed = 2166136261
  for (let index = 0; index < uuid.length; index += 1) {
    seed ^= uuid.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }
  let result = ""
  for (let index = 0; index < ACCESS_CODE_LENGTH; index += 1) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    result += ACCESS_CODE_ALPHABET[(seed >>> 0) % ACCESS_CODE_ALPHABET.length]
  }
  return result
}

function writeToken(token: string): void {
  const st = storage()
  try {
    if (typeof st?.set === "function") {
      st.set(LAN_SHARE_TOKEN_KEY, token)
    } else {
      st?.setString?.(LAN_SHARE_TOKEN_KEY, token)
    }
  } catch {
  }
}

export function getLanShareAccessToken(): string {
  const st = storage()
  try {
    const current = st?.get?.(LAN_SHARE_TOKEN_KEY) ?? st?.getString?.(LAN_SHARE_TOKEN_KEY)
    const normalized = String(current ?? "").trim().toUpperCase()
    if (new RegExp(`^[${ACCESS_CODE_ALPHABET}]{${ACCESS_CODE_LENGTH}}$`).test(normalized)) return normalized
  } catch {
  }
  const token = createToken()
  writeToken(token)
  return token
}

export function rotateLanShareAccessToken(): string {
  const token = createToken()
  writeToken(token)
  return token
}

function storedTrustedDevices(): StoredTrustedDevice[] {
  try {
    const st = storage()
    const raw = st?.get?.(TRUSTED_DEVICES_KEY) ?? st?.getString?.(TRUSTED_DEVICES_KEY)
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    return Array.isArray(value) ? value.filter((item): item is StoredTrustedDevice =>
      typeof item?.id === "string" && typeof item?.name === "string" &&
      Number.isFinite(item?.createdAt) && /^[A-F0-9]{64}$/.test(item?.tokenHash)
    ) : []
  } catch {
    return []
  }
}

function saveTrustedDevices(devices: StoredTrustedDevice[]): void {
  const st = storage()
  const raw = JSON.stringify(devices)
  if (typeof st?.set === "function") {
    if (st.set(TRUSTED_DEVICES_KEY, raw) !== false) return
  } else if (typeof st?.setString === "function") {
    st.setString(TRUSTED_DEVICES_KEY, raw)
    return
  }
  throw new Error("信任设备保存失败")
}

function trustedTokenHash(token: string): string {
  const data = Data.fromRawString(token, "utf-8")
  if (!data) throw new Error("凭证编码失败")
  return Crypto.sha256(data).toHexString().toUpperCase()
}

export function isTrustedDeviceToken(token: string): boolean {
  if (!/^[A-F0-9]{64}$/.test(token)) return false
  try {
    const hash = trustedTokenHash(token)
    return storedTrustedDevices().some((device) => device.tokenHash === hash)
  } catch {
    return false
  }
}

export function listTrustedDevices(): TrustedDevice[] {
  return storedTrustedDevices().map(({ id, name, createdAt }) => ({ id, name, createdAt }))
}

export function trustDevice(name: string): string {
  const devices = storedTrustedDevices()
  if (devices.length >= MAX_TRUSTED_DEVICES) throw new Error("信任设备已达上限，请先移除旧设备")
  const token = Crypto.generateSymmetricKey(256).toHexString().toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(token)) throw new Error("安全凭证生成失败")
  const hash = trustedTokenHash(token)
  devices.push({
    id: hash.slice(0, 16),
    name: name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 60) || "浏览器设备",
    createdAt: Date.now(),
    tokenHash: hash,
  })
  saveTrustedDevices(devices)
  return token
}

export function revokeTrustedDevice(id: string): void {
  const devices = storedTrustedDevices()
  saveTrustedDevices(devices.filter((device) => device.id !== id))
}
