export type Site = "cn" | "intl" | "workbuddy"

export type Credential = {
  uid: string
  nickname: string
  site: Site
  domain: string
  enterpriseId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type Account = Pick<Credential, "uid" | "nickname" | "site" | "enterpriseId"> & {
  credits?: number
  total?: number
  checkedIn?: string
  checkinActive?: boolean
  updatedAt?: number
  error?: string
}

export type RequestRecord = {
  at: number
  uid: string
  model: string
  ok: boolean
  tokens: number
  durationMs?: number
  creditsSpent?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
}

export type ModelEntry = { id: string; name: string; realm: "cn" | "global"; uids: string[] }
export type ModelLock = { uid: string; model: string; until: number; reason: string; estimated: boolean }

const ACCOUNTS = "wb2api.local.accounts"
const RECORDS = "wb2api.local.requests"
const SECRET = "wb2api.local.account."
const SERVICE = "wb2api.local.service"
const CATALOG = "wb2api.local.catalog"
const CATALOG_ACCOUNTS = "wb2api.local.catalog-accounts"
const HIDDEN_MODELS = "wb2api.local.hidden-models"
const HOST = "wb2api.local.host"
const PORT = "wb2api.local.port"
const CLAIMED_LOCAL = "wb2api.local.claimed-local"
const RELEASE_NOTES = "wb2api.local.release-notes-hash"
const MODEL_LOCKS = "wb2api.local.model-locks"
const CHECKIN_STATUS = "wb2api.local.checkin-status"

export function accounts(): Account[] { return Storage.get<Account[]>(ACCOUNTS) ?? [] }

export const todayInChina = () => new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 10)

function checkinStatusCache() {
  const day = todayInChina()
  const accountSet = accounts().map(item => `${item.uid}:${item.site}:${item.enterpriseId}`).sort().join("\n")
  const saved = Storage.get<{ day: string; accountSet: string; checked: string[] }>(CHECKIN_STATUS)
  return saved?.day === day && saved.accountSet === accountSet && Array.isArray(saved.checked)
    ? saved : { day, accountSet, checked: [] }
}

export function checkinStatusNeedsRefresh(uid: string): boolean { return !checkinStatusCache().checked.includes(uid) }

export function rememberCheckinStatus(uid: string) {
  const cache = checkinStatusCache()
  if (!Storage.set(CHECKIN_STATUS, { ...cache, checked: [...new Set([...cache.checked, uid])] }))
    console.warn("签到状态缓存保存失败")
}

const secretKey = (uid: string, nickname: string) => `${SECRET}${uid} · ${nickname.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 32) || uid}`
const secretKeys = (uid: string) => Keychain.keys().filter(key => key === SECRET + uid || key.startsWith(`${SECRET}${uid} · `))

function credentialEntry(uid: string): { key: string; raw: string; value: Credential } | null {
  const nickname = accounts().find(item => item.uid === uid)?.nickname ?? uid
  const read = (key: string) => {
    const raw = Keychain.get(key)
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as Credential
      return value?.uid === uid ? { key, raw, value } : null
    } catch { return null }
  }
  for (const key of [secretKey(uid, nickname), SECRET + uid]) {
    const found = read(key)
    if (found) return found
  }
  for (const key of secretKeys(uid)) {
    const found = read(key)
    if (found) return found
  }
  return null
}

export function credential(uid: string): Credential | null { return credentialEntry(uid)?.value ?? null }

export function saveCredential(value: Credential) {
  if (!/^[\w-]{1,64}$/.test(value.uid)) throw new Error("账号 UID 无效")
  const key = secretKey(value.uid, value.nickname)
  const previous = Keychain.get(key)
  const oldKeys = secretKeys(value.uid)
  if (!Keychain.set(key, JSON.stringify(value))) throw new Error("凭据保存失败")
  const existing = accounts().find(item => item.uid === value.uid)
  const next = accounts().filter(item => item.uid !== value.uid)
  next.push({ ...existing, uid: value.uid, nickname: value.nickname, site: value.site, enterpriseId: value.enterpriseId, error: undefined })
  if (!Storage.set(ACCOUNTS, next)) {
    if (previous === null) Keychain.remove(key)
    else Keychain.set(key, previous)
    throw new Error("账号列表保存失败")
  }
  for (const oldKey of oldKeys) if (oldKey !== key) Keychain.remove(oldKey)
}

export function migrateCredentialKeys(): { migrated: number; failed: number } {
  let migrated = 0, failed = 0
  const keys = new Set([...Keychain.keys().filter(key => key.startsWith(SECRET)), ...accounts().map(item => SECRET + item.uid)])
  const entries = new Map<string, { key: string; raw: string; value: Credential }[]>()
  for (const key of keys) {
    const raw = Keychain.get(key)
    if (!raw) continue
    try {
      const value = JSON.parse(raw) as Credential
      if (!/^[\w-]{1,64}$/.test(value?.uid) || typeof value.nickname !== "string"
        || value.site !== "cn" && value.site !== "intl" && value.site !== "workbuddy"
        || typeof value.accessToken !== "string" || !value.accessToken
        || key !== SECRET + value.uid && !key.startsWith(`${SECRET}${value.uid} · `)) { failed++; continue }
      entries.set(value.uid, [...(entries.get(value.uid) ?? []), { key, raw, value }])
    } catch { failed++ }
  }
  for (const [uid, items] of entries) {
    const account = accounts().find(item => item.uid === uid)
    const desired = secretKey(uid, account?.nickname || items[0].value.nickname || uid)
    const source = items.find(item => item.key === desired) ?? items.find(item => item.key === SECRET + uid) ?? items[0]
    if (!account) {
      try { saveCredential(source.value) } catch { failed++; continue }
    } else if (source.key !== desired && !Keychain.set(desired, source.raw)) { failed++; continue }
    for (const item of items) {
      if (item.key === desired) continue
      if (!Keychain.contains(item.key)) { migrated++; continue }
      if (Keychain.remove(item.key) && !Keychain.contains(item.key)) migrated++
      else failed++
    }
  }
  return { migrated, failed }
}

export function updateAccount(uid: string, change: Partial<Account>) {
  const next = accounts().map(item => item.uid === uid ? { ...item, ...change } : item)
  if (!Storage.set(ACCOUNTS, next)) throw new Error("账号状态保存失败")
}

export function removeAccount(uid: string) {
  const previous = secretKeys(uid).map(key => [key, Keychain.get(key)] as const)
  for (const [key] of previous) {
    if (!Keychain.remove(key)) {
      for (const [restoreKey, raw] of previous) if (raw !== null) Keychain.set(restoreKey, raw)
      throw new Error("凭据删除失败")
    }
  }
  if (!Storage.set(ACCOUNTS, accounts().filter(item => item.uid !== uid))) {
    for (const [key, raw] of previous) if (raw !== null) Keychain.set(key, raw)
    throw new Error("账号列表保存失败")
  }
  Storage.set(MODEL_LOCKS, modelLocks().filter(item => item.uid !== uid))
}

export function records(): RequestRecord[] { return Storage.get<RequestRecord[]>(RECORDS) ?? [] }

export function recordRequest(entry: RequestRecord) {
  Storage.set(RECORDS, [...records().slice(-199), entry])
}

export function serviceEnabled(): boolean { return Storage.get<boolean>(SERVICE) === true }
export function setServiceEnabled(enabled: boolean) {
  if (!Storage.set(SERVICE, enabled)) throw new Error("服务设置保存失败")
}

const catalogAccounts = () => accounts().map(item => `${item.uid}:${item.site}`).sort().join("\n")

export function modelCatalog(): ModelEntry[] {
  return (Storage.get<ModelEntry[]>(CATALOG) ?? []).filter(item => (item?.realm === "cn" || item?.realm === "global") && Array.isArray(item.uids))
}

export function modelCatalogNeedsRefresh(): boolean {
  return !!accounts().length && (!modelCatalog().length || Storage.get<string>(CATALOG_ACCOUNTS) !== catalogAccounts())
}

export function modelLocks(): ModelLock[] {
  const now = Date.now()
  const uids = new Set(accounts().map(item => item.uid))
  return (Storage.get<ModelLock[]>(MODEL_LOCKS) ?? []).filter(item => uids.has(item.uid) && item.until > now)
}

export function setModelLock(uid: string, model: string, until: number, reason: string, estimated: boolean) {
  const next = modelLocks().filter(item => item.uid !== uid || item.model !== model)
  next.push({ uid, model, until, reason: reason.slice(0, 180), estimated })
  Storage.set(MODEL_LOCKS, next)
}

export function saveModelCatalog(entries: ModelEntry[]) {
  const clean = [...new Map(entries
    .filter(item => typeof item?.id === "string" && /^[A-Za-z0-9._-]+$/.test(item.id) && (item.realm === "cn" || item.realm === "global") && Array.isArray(item.uids))
    .map(item => [`${item.realm}:${item.id}`, { id: item.id, name: String(item.name || item.id), realm: item.realm, uids: [...new Set(item.uids)] }]))
    .values()]
  if (!clean.length) throw new Error("上游未返回有效模型")
  if (!Storage.set(CATALOG, clean)) throw new Error("模型目录保存失败")
  if (!Storage.set(CATALOG_ACCOUNTS, catalogAccounts())) throw new Error("模型目录来源保存失败")
}

export function hiddenModelIds(): string[] {
  const catalog = modelCatalog()
  return [...new Set((Storage.get<string[]>(HIDDEN_MODELS) ?? []).flatMap(id => {
    if (id.startsWith("cn:") || id.startsWith("global:")) return [id]
    const matches = catalog.filter(item => item.id === id).map(item => `${item.realm}:${item.id}`)
    return matches.length ? matches : [id]
  }))]
}

export function setModelHidden(id: string, hidden: boolean) {
  const next = hidden ? [...new Set([...hiddenModelIds(), id])] : hiddenModelIds().filter(item => item !== id)
  if (!Storage.set(HIDDEN_MODELS, next)) throw new Error("模型开关保存失败")
}

export function modelIds(): string[] {
  const catalog = modelCatalog()
  const hidden = new Set(hiddenModelIds())
  const active = new Set(accounts().map(item => `${item.uid}:${item.site === "cn" ? "cn" : "global"}`))
  return catalog.filter(item => item.uids.some(uid => active.has(`${uid}:${item.realm}`))).map(item => `${item.realm}:${item.id}`).filter(id => !hidden.has(id))
}

export function listenPort(): number { return Storage.get<number>(PORT) ?? 8787 }

export function setListenPort(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("端口必须是 1-65535 的整数")
  if (!Storage.set(PORT, value)) throw new Error("端口保存失败")
}

export function addressHost(fallback: string): string { return Storage.get<string>(HOST)?.trim() || fallback }

export function setAddressHost(value: string) {
  if (value.trim() && !/^[A-Za-z0-9.-]+$/.test(value.trim())) throw new Error("地址只能填写主机名或 IPv4 地址")
  if (!Storage.set(HOST, value.trim())) throw new Error("地址保存失败")
}

export function localClaimTimes(): Record<string, number> { return Storage.get<Record<string, number>>(CLAIMED_LOCAL) ?? {} }

export function recordLocalClaim(uid: string, code: string) {
  const saved = localClaimTimes()
  Storage.set(CLAIMED_LOCAL, { ...saved, [`${uid}:${code}`]: Date.now() })
}

function releaseNotesHash(content: string): string {
  let value = 2166136261
  for (let i = 0; i < content.length; i++) value = Math.imul(value ^ content.charCodeAt(i), 16777619)
  return (value >>> 0).toString(16)
}

export function shouldShowReleaseNotes(content: string): boolean {
  return !!content.trim() && Storage.get<string>(RELEASE_NOTES) !== releaseNotesHash(content.trim())
}

export function markReleaseNotesSeen(content: string): boolean {
  return Storage.set(RELEASE_NOTES, releaseNotesHash(content.trim()))
}
