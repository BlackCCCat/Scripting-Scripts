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
const CLOUD_INDEX = "wb2api.local.account-index"
const CLOUD_SECRET = "wb2api.sync.account."

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
const keychainWriteOptions = (synchronizable: boolean) => synchronizable
  ? { synchronizable: true, accessibility: "first_unlock" as const }
  : { synchronizable: false, accessibility: "first_unlock_this_device" as const }
const namedKey = (prefix: string, uid: string, nickname: string) => `${prefix}${uid} · ${nickname.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 32) || uid}`
const secretKey = (uid: string, nickname: string) => namedKey(SECRET, uid, nickname)
const cloudSecretKey = (uid: string, nickname: string) => namedKey(CLOUD_SECRET, uid, nickname)
const isAccountKey = (key: string, uid: string) => [SECRET, CLOUD_SECRET].some(prefix =>
  key === prefix + uid || key.startsWith(`${prefix}${uid} · `))

type CloudIndexEntry = { uid: string; key: string }

function cloudIndex(): CloudIndexEntry[] {
  const raw = Keychain.get(CLOUD_INDEX, keychainOptions(true))
  if (!raw) return []
  try {
    const entries = JSON.parse(raw) as CloudIndexEntry[]
    return Array.isArray(entries) ? entries.filter(item => typeof item?.uid === "string" && /^[\w-]{1,64}$/.test(item.uid)
      && typeof item.key === "string" && isAccountKey(item.key, item.uid)) : []
  } catch { return [] }
}

function writeCloudIndex(entries: CloudIndexEntry[]) {
  const options = keychainOptions(true)
  const previous = Keychain.get(CLOUD_INDEX, options)
  const raw = JSON.stringify([...new Map(entries.map(item => [item.uid, item])).values()])
  if (!Keychain.set(CLOUD_INDEX, raw, keychainWriteOptions(true)) || Keychain.get(CLOUD_INDEX, options) !== raw) {
    if (previous === null) Keychain.remove(CLOUD_INDEX, options)
    else Keychain.set(CLOUD_INDEX, previous, keychainWriteOptions(true))
    throw new Error("iCloud 账号索引保存失败")
  }
}

const scopedSecretKeys = (synchronizable: boolean) => [...new Set([
  ...Keychain.keys(keychainOptions(synchronizable)).filter(key => key.startsWith(synchronizable ? CLOUD_SECRET : SECRET)),
  ...(synchronizable ? cloudIndex().map(item => item.key) : []),
])]
const accountKeyCandidates = (synchronizable: boolean) => [...new Set([
  ...scopedSecretKeys(synchronizable),
  ...accounts().flatMap(item => synchronizable
    ? [cloudSecretKey(item.uid, item.nickname), secretKey(item.uid, item.nickname), SECRET + item.uid]
    : [secretKey(item.uid, item.nickname), SECRET + item.uid]),
])]
const secretKeys = (uid: string, synchronizable: boolean) => accountKeyCandidates(synchronizable).filter(key => isAccountKey(key, uid))

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
  for (const key of scopedSecretKeys(true)) {
    const value = parsedCredential(Keychain.get(key, keychainOptions(true)))
    if (!value || known.has(value.uid) || !isAccountKey(key, value.uid)) continue
    known.add(value.uid)
    added.push({ uid: value.uid, nickname: value.nickname, site: value.site, enterpriseId: value.enterpriseId })
  }
  if (added.length && !Storage.set(ACCOUNTS, [...existing, ...added])) throw new Error("iCloud 账号列表恢复失败")
  return added.length
}

export function credentialStorageCounts(): { local: number; cloud: number } | null {
  try {
    const count = (sync: boolean) => {
      const uids = new Set<string>()
      const keys = sync
        ? [...new Set([...scopedSecretKeys(true), ...Keychain.keys(keychainOptions(true)).filter(key => key.startsWith(SECRET))])]
        : accountKeyCandidates(false)
      for (const key of keys) {
        const value = parsedCredential(Keychain.get(key, keychainOptions(sync)))
        if (value && isAccountKey(key, value.uid)) uids.add(value.uid)
      }
      return uids.size
    }
    return { local: count(false), cloud: count(true) }
  } catch { return null }
}

export function readableSyncedAccounts(): number | null { return credentialStorageCounts()?.cloud ?? null }

export function reconcileSyncedCredentials(onlyUid?: string): { removed: number; failed: number } {
  if (!credentialSyncEnabled()) return { removed: 0, failed: 0 }
  const localOptions = keychainOptions(false)
  const cloudOptions = keychainOptions(true)
  const oldCloudKeys = Keychain.keys(cloudOptions).filter(key => key.startsWith(SECRET))
  const cloudKeys = [...new Set([...scopedSecretKeys(true), ...oldCloudKeys])]
  const ready: { uid: string; key: string; obsolete: { key: string; sync: boolean }[] }[] = []
  let failed = 0, removed = 0
  for (const account of accounts().filter(item => !onlyUid || item.uid === onlyUid)) {
    const uid = account.uid
    const canonical = cloudSecretKey(uid, account.nickname)
    const local = accountKeyCandidates(false).filter(key => isAccountKey(key, uid))
      .map(key => ({ key, sync: false, raw: Keychain.get(key, localOptions) }))
    const synced = [...new Set([canonical, ...cloudKeys.filter(key => isAccountKey(key, uid))])]
      .map(key => ({ key, sync: true, raw: Keychain.get(key, cloudOptions) }))
    const candidates = [...synced, ...local].map(item => ({ ...item, value: parsedCredential(item.raw) }))
      .filter(item => item.value?.uid === uid)
    const best = candidates.reduce<(typeof candidates)[number] | null>((chosen, item) =>
      !chosen || (item.value?.expiresAt ?? 0) > (chosen.value?.expiresAt ?? 0) ? item : chosen, null)
    if (!best) { failed++; continue }
    const canonicalRaw = Keychain.get(canonical, cloudOptions)
    const canonicalValue = parsedCredential(canonicalRaw)
    if (canonicalValue?.uid !== uid || (canonicalValue.expiresAt ?? 0) < (best.value?.expiresAt ?? 0)) {
      if (!Keychain.set(canonical, best.raw!, keychainWriteOptions(true)) || Keychain.get(canonical, cloudOptions) !== best.raw) {
        failed++
        continue
      }
    }
    ready.push({ uid, key: canonical, obsolete: candidates
      .filter(item => !item.sync || item.key !== canonical)
      .map(item => ({ key: item.key, sync: item.sync })) })
  }
  if (!ready.length) return { removed, failed }
  const index = cloudIndex()
  const nextIndex = [...index.filter(item => !ready.some(entry => entry.uid === item.uid)),
    ...ready.map(({ uid, key }) => ({ uid, key }))]
  if (JSON.stringify(index) !== JSON.stringify(nextIndex)) {
    try { writeCloudIndex(nextIndex) }
    catch { return { removed, failed: failed + ready.length } }
  }
  for (const entry of ready) {
    const canonicalRaw = Keychain.get(entry.key, cloudOptions)
    if (parsedCredential(canonicalRaw)?.uid !== entry.uid) { failed++; continue }
    for (const item of entry.obsolete) {
      const options = keychainOptions(item.sync)
      if (Keychain.remove(item.key, options) && !Keychain.contains(item.key, options)) removed++
      else failed++
    }
  }
  return { removed, failed }
}

function credentialEntry(uid: string): { key: string; raw: string; value: Credential } | null {
  const nickname = accounts().find(item => item.uid === uid)?.nickname ?? uid
  const read = (key: string, synchronizable: boolean) => {
    const raw = Keychain.get(key, keychainOptions(synchronizable))
    const value = parsedCredential(raw)
    return value?.uid === uid ? { key, raw: raw!, value } : null
  }
  const active = credentialSyncEnabled()
  let best: { key: string; raw: string; value: Credential } | null = null
  for (const synchronizable of [active, !active]) {
    for (const key of [synchronizable ? cloudSecretKey(uid, nickname) : secretKey(uid, nickname), SECRET + uid, ...secretKeys(uid, synchronizable)]) {
      const found = read(key, synchronizable)
      if (found && (!best || found.value.expiresAt > best.value.expiresAt)) best = found
    }
  }
  return best
}

export function credential(uid: string): Credential | null { return credentialEntry(uid)?.value ?? null }

export function saveCredential(value: Credential) {
  if (!/^[\w-]{1,64}$/.test(value.uid)) throw new Error("账号 UID 无效")
  const synchronizable = credentialSyncEnabled()
  const key = synchronizable ? cloudSecretKey(value.uid, value.nickname) : secretKey(value.uid, value.nickname)
  const options = keychainOptions(synchronizable)
  const previous = Keychain.get(key, options)
  const oldKeys = secretKeys(value.uid, synchronizable)
  const raw = JSON.stringify(value)
  if (!Keychain.set(key, raw, keychainWriteOptions(synchronizable))) throw new Error("凭据保存失败")
  if (Keychain.get(key, options) !== raw) {
    if (previous === null) Keychain.remove(key, options)
    else Keychain.set(key, previous, keychainWriteOptions(synchronizable))
    throw new Error("凭据保存后无法读取")
  }
  const oldAccounts = accounts()
  const existing = oldAccounts.find(item => item.uid === value.uid)
  const next = oldAccounts.filter(item => item.uid !== value.uid)
  next.push({ ...existing, uid: value.uid, nickname: value.nickname, site: value.site, enterpriseId: value.enterpriseId, error: undefined })
  if (!Storage.set(ACCOUNTS, next)) {
    if (previous === null) Keychain.remove(key, options)
    else Keychain.set(key, previous, keychainWriteOptions(synchronizable))
    throw new Error("账号列表保存失败")
  }
  if (synchronizable) {
    try {
      const index = cloudIndex()
      if (index.find(item => item.uid === value.uid)?.key !== key)
        writeCloudIndex([...index.filter(item => item.uid !== value.uid), { uid: value.uid, key }])
    }
    catch (error) {
      Storage.set(ACCOUNTS, oldAccounts)
      if (previous === null) Keychain.remove(key, options)
      else Keychain.set(key, previous, keychainWriteOptions(true))
      throw error
    }
    try { reconcileSyncedCredentials(value.uid) }
    catch { console.warn("旧本机凭据暂未清理") }
  }
  if (!synchronizable) for (const oldKey of oldKeys) if (oldKey !== key) Keychain.remove(oldKey, options)
}

export async function setCredentialSyncEnabled(
  enabled: boolean,
  onProgress?: (completed: number, total: number, phase: string) => void,
): Promise<number> {
  if (enabled === credentialSyncEnabled()) return enabled ? restoreSyncedAccounts() : 0
  const currentAccounts = accounts()
  const total = currentAccounts.length + 2
  let completed = 0
  const progress = (phase: string) => onProgress?.(completed, total, phase)
  progress(enabled ? "正在检查登录凭据" : "正在保留本机凭据")
  await new Promise<void>(resolve => setTimeout(resolve, 80))
  if (!enabled) {
    if (!Storage.set(CREDENTIAL_SYNC, false)) throw new Error("iCloud 同步设置保存失败")
    Storage.remove(CREDENTIAL_CLEANUP)
    for (const account of currentAccounts) {
      try {
        const value = credential(account.uid)
        if (value) {
          const key = secretKey(value.uid, value.nickname)
          const raw = JSON.stringify(value)
          if (!Keychain.set(key, raw, keychainWriteOptions(false)) || Keychain.get(key, keychainOptions(false)) !== raw)
            console.warn("本机凭据副本暂未写入；原凭据已保留")
        }
      } catch { console.warn("本机凭据副本暂未写入；原凭据已保留") }
      completed++
      progress(`已检查 ${account.nickname}`)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    completed = total
    progress("已关闭同步，原凭据已保留")
    return 0
  }

  const written: { key: string; previous: string | null }[] = []
  const index = cloudIndex()
  const entries: CloudIndexEntry[] = []
  const previousIndex = Keychain.get(CLOUD_INDEX, keychainOptions(true))
  let indexWritten = false
  try {
    for (const account of currentAccounts) {
      const value = credential(account.uid)
      if (!value) throw new Error(`账号「${account.nickname}」的登录凭据不可读取；请先重新登录`)
      const key = cloudSecretKey(value.uid, value.nickname)
      const raw = JSON.stringify(value)
      const previous = Keychain.get(key, keychainOptions(true))
      if (previous !== raw) {
        if (!Keychain.set(key, raw, keychainWriteOptions(true))) throw new Error(`可同步凭据写入失败：${account.nickname}`)
        written.push({ key, previous })
        if (Keychain.get(key, keychainOptions(true)) !== raw) throw new Error(`可同步凭据回读失败：${account.nickname}`)
      }
      entries.push({ uid: value.uid, key })
      completed++
      progress(`已写入 ${account.nickname}`)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    if (entries.length) {
      writeCloudIndex([...index.filter(item => !entries.some(entry => entry.uid === item.uid)), ...entries])
      indexWritten = true
    }
    completed++
    progress("已检查同步账号索引")
    if (!Storage.set(CREDENTIAL_SYNC, true)) throw new Error("iCloud 同步设置保存失败")
  } catch (error) {
    if (indexWritten) {
      if (previousIndex === null) Keychain.remove(CLOUD_INDEX, keychainOptions(true))
      else Keychain.set(CLOUD_INDEX, previousIndex, keychainWriteOptions(true))
    }
    for (const item of written) {
      if (item.previous === null) Keychain.remove(item.key, keychainOptions(true))
      else Keychain.set(item.key, item.previous, keychainWriteOptions(true))
    }
    throw error
  }
  const added = restoreSyncedAccounts()
  try {
    const cleanup = reconcileSyncedCredentials()
    if (cleanup.failed) console.warn(`${cleanup.failed} 条旧凭据暂未清理`)
  } catch { console.warn("旧本机凭据暂未清理") }
  completed = total
  progress("同步凭据已写入，旧本机凭据已检查")
  return added
}

export function migrateCredentialKeys(): { migrated: number; failed: number } {
  if (credentialSyncEnabled()) return { migrated: 0, failed: 0 }
  Storage.remove(CREDENTIAL_CLEANUP)
  let migrated = 0, failed = 0
  const options = keychainOptions(false)
  const keys = new Set(accountKeyCandidates(false))
  const entries = new Map<string, { key: string; raw: string; value: Credential }[]>()
  for (const key of keys) {
    const raw = Keychain.get(key, options)
    const value = parsedCredential(raw)
    if (!value || !key.startsWith(SECRET) || !isAccountKey(key, value.uid)) continue
    entries.set(value.uid, [...(entries.get(value.uid) ?? []), { key, raw: raw!, value }])
  }
  for (const [uid, items] of entries) {
    const account = accounts().find(item => item.uid === uid)
    const desired = secretKey(uid, account?.nickname || items[0].value.nickname || uid)
    const source = items.reduce((best, item) => item.value.expiresAt > best.value.expiresAt ? item : best)
    if (!account) {
      try { saveCredential(source.value) } catch { failed++; continue }
    } else if (source.key !== desired &&
      (!Keychain.set(desired, source.raw, keychainWriteOptions(false)) || Keychain.get(desired, options) !== source.raw)) { failed++; continue }
    for (const item of items) {
      if (item.key === desired) continue
      if (!Keychain.contains(item.key, options)) { migrated++; continue }
      if (Keychain.remove(item.key, options) && !Keychain.contains(item.key, options)) migrated++
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
  const modes = [false, true]
  const oldAccounts = accounts()
  const previous = modes.flatMap(sync => secretKeys(uid, sync).map(key => ({ key, sync, raw: Keychain.get(key, keychainOptions(sync)) })))
  for (const { key, sync } of previous) {
    if (!Keychain.remove(key, keychainOptions(sync))) {
      for (const item of previous) if (item.raw !== null) Keychain.set(item.key, item.raw, keychainWriteOptions(item.sync))
      throw new Error("凭据删除失败")
    }
  }
  if (!Storage.set(ACCOUNTS, oldAccounts.filter(item => item.uid !== uid))) {
    for (const item of previous) if (item.raw !== null) Keychain.set(item.key, item.raw, keychainWriteOptions(item.sync))
    throw new Error("账号列表保存失败")
  }
  const index = cloudIndex()
  if (index.some(item => item.uid === uid)) {
    try { writeCloudIndex(index.filter(item => item.uid !== uid)) }
    catch (error) {
      Storage.set(ACCOUNTS, oldAccounts)
      for (const item of previous) if (item.raw !== null) Keychain.set(item.key, item.raw, keychainWriteOptions(item.sync))
      throw error
    }
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
