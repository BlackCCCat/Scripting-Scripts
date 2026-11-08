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
  enabled?: boolean
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
const ACCOUNT_ROTATION = "wb2api.local.account-rotation"
const FIXED_ACCOUNT = "wb2api.local.fixed-account"
const CREDENTIAL_SYNC = "wb2api.local.credential-sync"
const CREDENTIAL_CLEANUP = "wb2api.local.credential-cleanup"

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

export const credentialSyncEnabled = (): boolean => Storage.get<boolean>(CREDENTIAL_SYNC) === true
const keychainOptions = (synchronizable: boolean) => ({ synchronizable })
const secretKey = (uid: string, nickname: string) => `${SECRET}${uid} · ${nickname.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 32) || uid}`
const secretKeys = (uid: string, synchronizable: boolean) => Keychain.keys(keychainOptions(synchronizable)).filter(key => key === SECRET + uid || key.startsWith(`${SECRET}${uid} · `))

function parsedCredential(raw: string | null): Credential | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Credential
    return /^[\w-]{1,64}$/.test(value?.uid) && typeof value.nickname === "string"
      && (value.site === "cn" || value.site === "intl" || value.site === "workbuddy")
      && typeof value.accessToken === "string" && !!value.accessToken ? value : null
  } catch { return null }
}

export function restoreSyncedAccounts(): number {
  if (!credentialSyncEnabled()) return 0
  const existing = accounts()
  const known = new Set(existing.map(item => item.uid))
  const added: Account[] = []
  for (const key of Keychain.keys(keychainOptions(true))) {
    if (!key.startsWith(SECRET)) continue
    const value = parsedCredential(Keychain.get(key, keychainOptions(true)))
    if (!value || known.has(value.uid) || key !== SECRET + value.uid && !key.startsWith(`${SECRET}${value.uid} · `)) continue
    known.add(value.uid)
    added.push({ uid: value.uid, nickname: value.nickname, site: value.site, enterpriseId: value.enterpriseId })
  }
  if (added.length && !Storage.set(ACCOUNTS, [...existing, ...added])) throw new Error("iCloud 账号列表恢复失败")
  return added.length
}

function credentialEntry(uid: string): { key: string; raw: string; value: Credential } | null {
  const nickname = accounts().find(item => item.uid === uid)?.nickname ?? uid
  const read = (key: string, synchronizable: boolean) => {
    const raw = Keychain.get(key, keychainOptions(synchronizable))
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as Credential
      return value?.uid === uid ? { key, raw, value } : null
    } catch { return null }
  }
  const active = credentialSyncEnabled()
  const scopes = Storage.get<boolean>(CREDENTIAL_CLEANUP) === true ? [active, !active] : [active]
  for (const synchronizable of scopes) {
    for (const key of [secretKey(uid, nickname), SECRET + uid, ...secretKeys(uid, synchronizable)]) {
      const found = read(key, synchronizable)
      if (found) return found
    }
  }
  return null
}

export function credential(uid: string): Credential | null { return credentialEntry(uid)?.value ?? null }

export function saveCredential(value: Credential) {
  if (!/^[\w-]{1,64}$/.test(value.uid)) throw new Error("账号 UID 无效")
  const key = secretKey(value.uid, value.nickname)
  const synchronizable = credentialSyncEnabled()
  const options = keychainOptions(synchronizable)
  const previous = Keychain.get(key, options)
  const oldKeys = secretKeys(value.uid, synchronizable)
  if (!Keychain.set(key, JSON.stringify(value), options)) throw new Error("凭据保存失败")
  const existing = accounts().find(item => item.uid === value.uid)
  const next = accounts().filter(item => item.uid !== value.uid)
  next.push({ ...existing, uid: value.uid, nickname: value.nickname, site: value.site, enterpriseId: value.enterpriseId, error: undefined })
  if (!Storage.set(ACCOUNTS, next)) {
    if (previous === null) Keychain.remove(key, options)
    else Keychain.set(key, previous, options)
    throw new Error("账号列表保存失败")
  }
  for (const oldKey of oldKeys) if (oldKey !== key) Keychain.remove(oldKey, options)
}

export function setCredentialSyncEnabled(enabled: boolean): void {
  if (enabled === credentialSyncEnabled()) return
  const source = keychainOptions(!enabled)
  const target = keychainOptions(enabled)
  const sourceKeys = Keychain.keys(source).filter(key => key.startsWith(SECRET))
  const targetEntries = new Map<string, { key: string; value: Credential }>()
  for (const key of Keychain.keys(target)) {
    if (!key.startsWith(SECRET)) continue
    const value = parsedCredential(Keychain.get(key, target))
    if (value && (key === SECRET + value.uid || key.startsWith(`${SECRET}${value.uid} · `))) targetEntries.set(value.uid, { key, value })
  }
  const written: { key: string; previous: string | null }[] = []
  try {
    for (const key of sourceKeys) {
      const raw = Keychain.get(key, source)
      const value = parsedCredential(raw)
      if (!value || key !== SECRET + value.uid && !key.startsWith(`${SECRET}${value.uid} · `)) throw new Error(`无法识别旧凭据：${key}`)
      const existing = targetEntries.get(value.uid)
      if (enabled && existing && existing.value.expiresAt >= value.expiresAt) continue
      const destination = existing?.key ?? secretKey(value.uid, value.nickname)
      const previous = Keychain.get(destination, target)
      if (!Keychain.set(destination, raw!, target) || Keychain.get(destination, target) !== raw) throw new Error(`凭据迁移失败：${value.nickname}`)
      written.push({ key: destination, previous })
      targetEntries.set(value.uid, { key: destination, value })
    }
    if (!Storage.set(CREDENTIAL_CLEANUP, true)) throw new Error("凭据迁移状态保存失败")
    if (!Storage.set(CREDENTIAL_SYNC, enabled)) {
      Storage.remove(CREDENTIAL_CLEANUP)
      throw new Error("iCloud 同步设置保存失败")
    }
  } catch (error) {
    for (const item of written) {
      if (item.previous === null) Keychain.remove(item.key, target)
      else Keychain.set(item.key, item.previous, target)
    }
    throw error
  }
  let failed = 0
  for (const key of sourceKeys) {
    if (!Keychain.remove(key, source) || Keychain.contains(key, source)) failed++
  }
  if (!failed) Storage.remove(CREDENTIAL_CLEANUP)
  if (enabled) restoreSyncedAccounts()
  if (failed) throw new Error(`同步方式已切换，但 ${failed} 条旧凭据未能删除；下次启动会重试清理`)
}

export function migrateCredentialKeys(): { migrated: number; failed: number } {
  let migrated = 0, failed = 0
  if (credentialSyncEnabled()) restoreSyncedAccounts()
  const options = keychainOptions(credentialSyncEnabled())
  const keys = new Set([...Keychain.keys(options).filter(key => key.startsWith(SECRET)), ...accounts().map(item => SECRET + item.uid)])
  const entries = new Map<string, { key: string; raw: string; value: Credential }[]>()
  for (const key of keys) {
    const raw = Keychain.get(key, options)
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
    } else if (source.key !== desired && !Keychain.set(desired, source.raw, options)) { failed++; continue }
    for (const item of items) {
      if (item.key === desired) continue
      if (!Keychain.contains(item.key, options)) { migrated++; continue }
      if (Keychain.remove(item.key, options) && !Keychain.contains(item.key, options)) migrated++
      else failed++
    }
  }
  if (Storage.get<boolean>(CREDENTIAL_CLEANUP) === true) {
    const previous = keychainOptions(!credentialSyncEnabled())
    const activeSync = credentialSyncEnabled()
    let cleanupFailed = 0
    for (const key of Keychain.keys(previous).filter(key => key.startsWith(SECRET))) {
      const value = parsedCredential(Keychain.get(key, previous))
      const activeCopy = value && secretKeys(value.uid, activeSync).some(activeKey =>
        parsedCredential(Keychain.get(activeKey, keychainOptions(activeSync)))?.uid === value.uid)
      if (!activeCopy) { cleanupFailed++; continue }
      if (Keychain.remove(key, previous) && !Keychain.contains(key, previous)) migrated++
      else cleanupFailed++
    }
    if (!cleanupFailed) Storage.remove(CREDENTIAL_CLEANUP)
    failed += cleanupFailed
  }
  return { migrated, failed }
}

export function updateAccount(uid: string, change: Partial<Account>) {
  const next = accounts().map(item => item.uid === uid ? { ...item, ...change } : item)
  if (!Storage.set(ACCOUNTS, next)) throw new Error("账号状态保存失败")
}

export function removeAccount(uid: string) {
  const modes = Storage.get<boolean>(CREDENTIAL_CLEANUP) === true ? [false, true] : [credentialSyncEnabled()]
  const previous = modes.flatMap(sync => secretKeys(uid, sync).map(key => ({ key, sync, raw: Keychain.get(key, keychainOptions(sync)) })))
  for (const { key, sync } of previous) {
    if (!Keychain.remove(key, keychainOptions(sync))) {
      for (const item of previous) if (item.raw !== null) Keychain.set(item.key, item.raw, keychainOptions(item.sync))
      throw new Error("凭据删除失败")
    }
  }
  if (!Storage.set(ACCOUNTS, accounts().filter(item => item.uid !== uid))) {
    for (const item of previous) if (item.raw !== null) Keychain.set(item.key, item.raw, keychainOptions(item.sync))
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

export function accountRotationEnabled(): boolean { return Storage.get<boolean>(ACCOUNT_ROTATION) !== false }
export function setAccountRotationEnabled(enabled: boolean) {
  if (!Storage.set(ACCOUNT_ROTATION, enabled)) throw new Error("账号轮询设置保存失败")
}
export function fixedAccountUid(): string { return Storage.get<string>(FIXED_ACCOUNT) ?? "" }
export function setFixedAccountUid(uid: string) {
  if (!accounts().some(account => account.uid === uid)) throw new Error("请选择已有账号")
  if (!Storage.set(FIXED_ACCOUNT, uid)) throw new Error("固定账号设置保存失败")
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

export function modelIds(onlyUid?: string): string[] {
  const catalog = modelCatalog()
  const hidden = new Set(hiddenModelIds())
  const active = new Set(accounts().filter(item => item.enabled !== false && (onlyUid === undefined || item.uid === onlyUid)).map(item => `${item.uid}:${item.site === "cn" ? "cn" : "global"}`))
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
