const LAN_SHARE_TOKEN_KEY = "cais_lan_share_token_v1"
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const ACCESS_CODE_LENGTH = 8

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
