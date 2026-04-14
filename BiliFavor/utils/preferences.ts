import type {
  BiliAuthorFilterRule,
  BiliPlaybackMode,
  BiliPreferences,
} from "../types"

const STORAGE_KEY = "bili_scripting_preferences_v1"

function sanitizePlaybackMode(raw: any): BiliPlaybackMode {
  return raw === "inline" ? "inline" : "external"
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
    playbackMode: sanitizePlaybackMode(raw?.playbackMode),
    authorFiltersByAccount,
  }
}

export function loadStoredPreferences(): BiliPreferences {
  try {
    return sanitizePreferences(Storage.get<any>(STORAGE_KEY))
  } catch {
    return {
      playbackMode: "external",
      authorFiltersByAccount: {},
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
