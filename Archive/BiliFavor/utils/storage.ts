import type { BiliAuthSession, BiliAuthStore } from "../types"

const STORAGE_KEY = "bili_scripting_auth_v1"

function sanitizeUser(raw: any) {
  if (!raw) return null
  const uname = String(raw?.uname ?? "").trim()
  const mid = String(raw?.mid ?? "").trim()
  if (!uname || !mid) return null

  return {
    mid,
    uname,
    face: String(raw?.face ?? "").trim(),
    level: Number(raw?.level ?? 0) || 0,
    vipLabel: String(raw?.vipLabel ?? "").trim(),
  }
}

function sanitizeSession(raw: any): BiliAuthSession | null {
  const cookieHeader = String(raw?.cookieHeader ?? "").trim()
  if (!cookieHeader) return null
  const user = sanitizeUser(raw?.user)
  const id = String(raw?.id ?? user?.mid ?? "").trim()
  if (!id) return null

  return {
    id,
    cookieHeader,
    refreshToken: String(raw?.refreshToken ?? "").trim(),
    updatedAt: Number(raw?.updatedAt ?? Date.now()) || Date.now(),
    user,
    loginMethod: raw?.loginMethod === "webview" ? "webview" : "cookie",
  }
}

function sanitizeStore(raw: any): BiliAuthStore {
  if (Array.isArray(raw?.accounts)) {
    const accounts = raw.accounts
      .map((item: any) => sanitizeSession(item))
      .filter(Boolean) as BiliAuthSession[]
    const preferredActiveId = String(raw?.activeAccountId ?? "").trim()
    const activeAccountId = accounts.some((item) => item.id === preferredActiveId)
      ? preferredActiveId
      : (accounts[0]?.id ?? null)

    return {
      activeAccountId,
      accounts,
    }
  }

  const legacySession = sanitizeSession(raw)
  if (!legacySession) {
    return {
      activeAccountId: null,
      accounts: [],
    }
  }

  return {
    activeAccountId: legacySession.id,
    accounts: [legacySession],
  }
}

export function loadStoredAuthState(): BiliAuthStore {
  try {
    const raw = Storage.get<any>(STORAGE_KEY)
    return sanitizeStore(raw)
  } catch {
    return {
      activeAccountId: null,
      accounts: [],
    }
  }
}

export function saveStoredAuthState(state: BiliAuthStore): void {
  try {
    const accounts = (state.accounts ?? [])
      .map((item) => sanitizeSession(item))
      .filter(Boolean) as BiliAuthSession[]

    if (accounts.length === 0) {
      Storage.remove(STORAGE_KEY)
      return
    }

    const activeAccountId = accounts.some((item) => item.id === state.activeAccountId)
      ? state.activeAccountId
      : accounts[0]?.id ?? null

    Storage.set(STORAGE_KEY, {
      activeAccountId,
      accounts,
    } satisfies BiliAuthStore)
  } catch {
  }
}
