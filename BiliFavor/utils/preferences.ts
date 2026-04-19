import type {
  BiliAuthorFilterRule,
  BiliFavoriteAuthor,
  BiliLoginMode,
  BiliPlaybackMode,
  BiliPreferences,
} from "../types"

const STORAGE_KEY = "bili_scripting_preferences_v1"

function sanitizePlaybackMode(raw: any): BiliPlaybackMode {
  return raw === "inline" ? "inline" : "external"
}

function sanitizeLoginMode(raw: any): BiliLoginMode {
  return raw === "webview" ? "webview" : "cookie"
}

function sanitizeFilterRule(raw: any): BiliAuthorFilterRule {
  const mids: string[] = Array.isArray(raw?.mids)
    ? raw.mids
      .map((item: any) => String(item ?? "").trim())
      .filter((item: string) => Boolean(item))
    : []

  return {
    mode: raw?.mode === "custom" ? "custom" : "all",
    mids: Array.from(new Set<string>(mids)),
  }
}

function sanitizeFavoriteAuthor(raw: any): BiliFavoriteAuthor | null {
  const mid = String(raw?.mid ?? "").trim()
  const uname = String(raw?.uname ?? "").trim()
  if (!mid || !uname) return null

  return {
    mid,
    uname,
    face: String(raw?.face ?? "").trim(),
    sign: String(raw?.sign ?? "").trim(),
    fans: Math.max(0, Number(raw?.fans ?? 0) || 0),
    videos: Math.max(0, Number(raw?.videos ?? 0) || 0),
    officialVerifyDesc: String(raw?.officialVerifyDesc ?? "").trim(),
  }
}

function sanitizeFavoriteAuthors(raw: any): BiliFavoriteAuthor[] {
  const seen = new Set<string>()
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => sanitizeFavoriteAuthor(item))
    .filter((item): item is BiliFavoriteAuthor => Boolean(item))
    .filter((item) => {
      if (seen.has(item.mid)) return false
      seen.add(item.mid)
      return true
    })
}

function sanitizePreferences(raw: any): BiliPreferences {
  const authorFiltersByAccount: Record<string, BiliAuthorFilterRule> = {}

  if (raw?.authorFiltersByAccount && typeof raw.authorFiltersByAccount === "object") {
    for (const [accountId, rule] of Object.entries(raw.authorFiltersByAccount)) {
      const id = String(accountId ?? "").trim()
      if (!id) continue
      authorFiltersByAccount[id] = sanitizeFilterRule(rule)
    }
  }

  return {
    loginMode: sanitizeLoginMode(raw?.loginMode),
    playbackMode: sanitizePlaybackMode(raw?.playbackMode),
    authorFiltersByAccount,
    favoriteAuthors: sanitizeFavoriteAuthors(raw?.favoriteAuthors),
  }
}

export function loadStoredPreferences(): BiliPreferences {
  try {
    return sanitizePreferences(Storage.get<any>(STORAGE_KEY))
  } catch {
    return {
      loginMode: "cookie",
      playbackMode: "external",
      authorFiltersByAccount: {},
      favoriteAuthors: [],
    }
  }
}

export function saveStoredPreferences(preferences: BiliPreferences): void {
  try {
    Storage.set(STORAGE_KEY, sanitizePreferences(preferences))
  } catch {
  }
}

export function getAuthorFilterRule(
  preferences: BiliPreferences,
  accountId: string | null | undefined
): BiliAuthorFilterRule {
  const key = String(accountId ?? "").trim()
  if (!key) {
    return {
      mode: "all",
      mids: [],
    }
  }

  return preferences.authorFiltersByAccount[key] ?? {
    mode: "all",
    mids: [],
  }
}

export function setAuthorFilterRule(
  preferences: BiliPreferences,
  accountId: string,
  rule: BiliAuthorFilterRule
): BiliPreferences {
  const key = String(accountId ?? "").trim()
  if (!key) return preferences

  return {
    ...preferences,
    authorFiltersByAccount: {
      ...preferences.authorFiltersByAccount,
      [key]: sanitizeFilterRule(rule),
    },
  }
}

export function removeAccountPreferences(
  preferences: BiliPreferences,
  accountId: string | null | undefined
): BiliPreferences {
  const key = String(accountId ?? "").trim()
  if (!key || !preferences.authorFiltersByAccount[key]) return preferences

  const nextFilters = { ...preferences.authorFiltersByAccount }
  delete nextFilters[key]

  return {
    ...preferences,
    authorFiltersByAccount: nextFilters,
  }
}

export function setPlaybackMode(
  preferences: BiliPreferences,
  playbackMode: BiliPlaybackMode
): BiliPreferences {
  return {
    ...preferences,
    playbackMode: sanitizePlaybackMode(playbackMode),
  }
}

export function setLoginMode(
  preferences: BiliPreferences,
  loginMode: BiliLoginMode
): BiliPreferences {
  return {
    ...preferences,
    loginMode: sanitizeLoginMode(loginMode),
  }
}

export function setFavoriteAuthors(
  preferences: BiliPreferences,
  authors: BiliFavoriteAuthor[]
): BiliPreferences {
  return {
    ...preferences,
    favoriteAuthors: sanitizeFavoriteAuthors(authors),
  }
}
