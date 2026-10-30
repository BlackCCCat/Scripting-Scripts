import { accounts, credential, localClaimTimes, recordLocalClaim, rememberCheckinStatus, saveCredential, saveModelCatalog, todayInChina, updateAccount, type Account, type Credential, type ModelEntry, type Site } from "./store"

// Keep site and client versions together: the upstream's login and chat code changes these independently.
const SITES: Record<Site, { api: string; origin: string }> = {
  cn: { api: "https://copilot.tencent.com", origin: "https://www.codebuddy.cn" },
  intl: { api: "https://www.codebuddy.ai", origin: "https://www.codebuddy.ai" },
  workbuddy: { api: "https://www.workbuddy.ai", origin: "https://www.workbuddy.ai" },
}
const LOGIN_VERSION = "2.176.0"
const LOGIN_UA = `CLI/${LOGIN_VERSION} CodeBuddy/${LOGIN_VERSION}`
const CHAT_CN = "https://www.workbuddy.cn"
const BILLING_CN = "https://www.workbuddy.cn"
const MP_UA = "Mozilla/5.0 (Linux; Android 14; MicroMessenger/8.0.49 WeChat/0.8.0 MiniProgramEnv/android; wkbrowser xweb)"
const CLI_VERSION = "2.165.0"
const CHAT_UA: Record<Site, string> = {
  cn: `WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/${CLI_VERSION}`,
  intl: `WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/${CLI_VERSION}`,
  workbuddy: `WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/${CLI_VERSION}`,
}

export type LoginSession = { site: Site; state: string; url: string; startedAt: number }
export type GrowthTask = {
  task_code: string; title: string; task_desc: string; description: string
  current?: number; target?: number; accept_status: string; claimed: boolean
  claimable: boolean; has_reward: boolean; locked: boolean; miniprogram: boolean
  completedAt?: number; claimedAt?: number
}

export class UpstreamError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) { super(message) }
}

function loginPending(error: unknown): boolean {
  return error instanceof UpstreamError
    ? error.code === 11217 || error.code === 12151 || error.status >= 500
    : error instanceof TypeError
}

async function envelope(url: string, options: { method?: string; headers?: Record<string, string>; body?: unknown; timeout?: number } = {}): Promise<any> {
  const response = await fetch(url, {
    method: options.method ?? "GET", timeout: options.timeout ?? 30,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const raw = await response.text()
  let payload: any
  try { payload = JSON.parse(raw) } catch { throw new UpstreamError(`上游返回了无法解析的内容（HTTP ${response.status}）`, response.status) }
  if (!response.ok || payload?.code !== 0) {
    throw new UpstreamError(String(payload?.msg ?? payload?.message ?? `上游 HTTP ${response.status}`).slice(0, 180), response.status, Number(payload?.code))
  }
  return payload.data
}

function loginHeaders(site: Site): Record<string, string> {
  const origin = SITES[site].origin
  return { Origin: origin, Referer: `${origin}/`, "X-Requested-With": "XMLHttpRequest", "User-Agent": LOGIN_UA }
}

export async function beginLogin(site: Site): Promise<LoginSession> {
  const data = await envelope(`${SITES[site].api}/v2/plugin/auth/state?platform=CLI`, { method: "POST", body: {}, headers: loginHeaders(site) })
  if (typeof data?.state !== "string" || typeof data?.authUrl !== "string") throw new Error("上游未返回授权链接")
  const url = new URL(data.authUrl)
  if (url.protocol !== "https:") throw new Error("授权链接不是 HTTPS")
  if (!url.searchParams.has("version")) url.searchParams.set("version", LOGIN_VERSION)
  return { site, state: data.state, url: url.toString(), startedAt: Date.now() }
}

export async function pollLogin(session: LoginSession, expectedUid?: string): Promise<Credential | null> {
  if (Date.now() - session.startedAt > 15 * 60_000) throw new Error("授权已过期，请重新发起")
  const base = SITES[session.site].api
  let token: any
  try { token = await envelope(`${base}/v2/plugin/auth/token?state=${encodeURIComponent(session.state)}`, { headers: loginHeaders(session.site) }) }
  catch (error) {
    if (loginPending(error)) return null
    throw error
  }
  if (!token?.accessToken) return null
  let info: any
  try { info = await envelope(`${base}/v2/plugin/login/account?state=${encodeURIComponent(session.state)}`, { headers: { ...loginHeaders(session.site), Authorization: `Bearer ${token.accessToken}` } }) }
  catch (error) {
    if (loginPending(error)) return null
    throw error
  }
  if (!/^[\w-]{1,64}$/.test(info?.uid ?? "")) throw new Error("上游返回的 UID 无效")
  if (expectedUid && info.uid !== expectedUid) throw new Error(`授权账号 UID 不匹配：${info.uid}`)
  const value: Credential = {
    uid: info.uid, nickname: String(info.nickname || info.uid), site: session.site,
    domain: String(token.domain || ""), enterpriseId: String(info.enterpriseId || ""),
    accessToken: token.accessToken, refreshToken: String(token.refreshToken || ""),
    expiresAt: Date.now() + Number(token.expiresIn || 0) * 1000,
  }
  saveCredential(value)
  return value
}

const refreshing = new Map<string, Promise<Credential>>()
const checkingIn = new Map<string, Promise<boolean>>()

async function stableId(uid: string, purpose: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`wb2a:${purpose}:${uid}`))
  return Array.from(new Uint8Array(digest)).slice(0, 18).map(byte => byte.toString(16).padStart(2, "0")).join("")
}

function randomHex(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, "0")).join("")
}

export function timeOrderedId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = Date.now()
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256
    time = Math.floor(time / 256)
  }
  bytes[6] = bytes[6] & 0x0f | 0x70
  bytes[8] = bytes[8] & 0x3f | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function hostFrom(value: string): string {
  try { return new URL(value).hostname } catch { return value.replace(/^https?:\/\//, "").split(/[/:]/)[0] }
}

function jwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1]
    if (!part) return {}
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")
    return JSON.parse(atob(padded))
  } catch { return {} }
}

function jwtClaim(token: string, name: string): string {
  const value = jwtPayload(token)[name]
  return typeof value === "string" ? value : ""
}

export async function freshCredential(uid: string): Promise<Credential> {
  const saved = credential(uid)
  if (!saved) throw new Error("账号凭据不存在，请重新登录")
  if (saved.expiresAt > Date.now() + 5 * 60_000) return saved
  if (!saved.refreshToken) throw new Error("导入的 Access Token 已过期或即将过期，请重新授权或导入含刷新令牌的凭据")
  const inFlight = refreshing.get(uid)
  if (inFlight) return inFlight
  const promise = (async () => {
    const base = chatBase(saved)
    const data = await envelope(`${base}/v2/plugin/auth/token/refresh`, {
      method: "POST", body: {}, headers: {
        Accept: "application/json, text/plain, */*", Authorization: `Bearer ${saved.accessToken}`,
        "X-Requested-With": "XMLHttpRequest", "X-Request-ID": randomHex(),
        "X-Refresh-Token": saved.refreshToken, "X-User-Id": uid, "X-Domain": hostFrom(base),
        "X-Product": "SaaS", "User-Agent": CHAT_UA[saved.site],
        "X-Auth-Refresh-Source": "plugin", ...(saved.enterpriseId ? { "X-Enterprise-Id": saved.enterpriseId } : {}),
      },
    })
    if (!data?.accessToken) throw new Error("刷新登录态失败，请重新授权")
    const next = { ...saved, accessToken: data.accessToken, refreshToken: data.refreshToken || saved.refreshToken,
      domain: data.domain || saved.domain, expiresAt: Number(data.expiresIn) > 0 ? Date.now() + Number(data.expiresIn) * 1000 : saved.expiresAt }
    saveCredential(next)
    return next
  })()
  refreshing.set(uid, promise)
  try { return await promise } finally { refreshing.delete(uid) }
}

function parseImportedCredential(raw: string, site: Site): Credential {
  let source: any
  try { source = JSON.parse(raw) } catch { throw new Error("所选钥匙串内容不是有效的凭据 JSON") }
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("所选钥匙串内容不是账号凭据")
  if (source.provider && source.provider !== "workBuddy") throw new Error("所选记录不是 WorkBuddy 凭据")
  const auth = source.auth && typeof source.auth === "object" ? source.auth : source
  const account = source.account && typeof source.account === "object" ? source.account : source
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {}
  const knownUids = [account.uid, auth.uid, metadata.uid, source.uid].filter(value => value != null).map(value => String(value).trim())
  const accountUid = knownUids[0]
  if (!accountUid) throw new Error("所选凭据没有 UID")
  if (!/^[\w-]{1,64}$/.test(accountUid)) throw new Error("账号 UID 无效")
  for (const knownUid of knownUids) {
    if (knownUid !== accountUid) throw new Error("填写的 UID 与所选凭据不一致")
  }
  const accessToken = String(auth.accessToken ?? auth.access_token ?? "").trim()
  if (!accessToken) throw new Error("所选记录没有 Access Token")
  const refreshToken = String(auth.refreshToken ?? auth.refresh_token ?? "").trim()
  const domain = String(auth.domain ?? metadata.domain ?? "").trim()
  const region = String(metadata.region ?? source.region ?? "").trim()
  if (region && region !== (site === "cn" ? "cn" : "global")) throw new Error("选择的站点与凭据区域不一致")
  if (source.site && source.site !== site) throw new Error("选择的站点与凭据站点不一致")
  const host = hostFrom(domain).toLowerCase()
  const validHost = site === "cn" ? /^(?:[\w-]+\.)*(?:codebuddy\.cn|workbuddy\.cn|copilot\.tencent\.com)$/ :
    site === "intl" ? /^(?:[\w-]+\.)*codebuddy\.ai$/ : /^(?:[\w-]+\.)*workbuddy\.ai$/
  if (domain && !validHost.test(host)) throw new Error("选择的站点与凭据域名不一致")
  const rawExpiry = auth.expiresAt ?? auth.expires_at
  const parsedExpiry = rawExpiry == null ? 0 : typeof rawExpiry === "string" && !/^\d+$/.test(rawExpiry) ? Date.parse(rawExpiry) : Number(rawExpiry)
  if (rawExpiry != null && (!Number.isFinite(parsedExpiry) || parsedExpiry <= 0)) throw new Error("所选凭据的过期时间无效")
  const absoluteExpiry = parsedExpiry > 0 ? (parsedExpiry < 1e11 ? parsedExpiry * 1000 : parsedExpiry) : 0
  const tokenExpiry = Number(jwtPayload(accessToken).exp) * 1000
  const expiresIn = Number(auth.expiresIn ?? auth.expires_in)
  const knownExpiry = [absoluteExpiry, Number.isFinite(tokenExpiry) ? tokenExpiry : 0].filter(value => value > 0)
  const expiry = (knownExpiry.length ? Math.min(...knownExpiry) : 0)
    || (Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60_000)
  if (expiry <= Date.now()) throw new Error("所选凭据已过期，请重新授权")
  const value: Credential = {
    uid: accountUid, nickname: String(account.nickname ?? metadata.nickname ?? accountUid).trim() || accountUid,
    site, domain: domain || (site === "cn" ? "www.workbuddy.cn" : site === "intl" ? "www.codebuddy.ai" : "www.workbuddy.ai"),
    enterpriseId: String(account.enterpriseId ?? account.enterprise_id ?? metadata.enterpriseId ?? ""),
    accessToken, refreshToken, expiresAt: expiry,
  }
  return value
}

export function parseKeychainWorkBuddy(raw: string, fallbackSite: Site): Credential | null {
  let source: any
  try { source = JSON.parse(raw) } catch { return null }
  if (!source || typeof source !== "object" || Array.isArray(source) || source.provider && source.provider !== "workBuddy") return null
  const auth = source.auth && typeof source.auth === "object" ? source.auth : source
  const account = source.account && typeof source.account === "object" ? source.account : source
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {}
  const domain = hostFrom(String(auth.domain ?? metadata.domain ?? "")).toLowerCase()
  const domainSite: Site | null = /(^|\.)codebuddy\.ai$/.test(domain) ? "intl" : /(^|\.)workbuddy\.ai$/.test(domain) ? "workbuddy"
    : /(^|\.)(?:codebuddy\.cn|workbuddy\.cn|copilot\.tencent\.com)$/.test(domain) ? "cn" : null
  const site: Site | null = source.site === "cn" || source.site === "intl" || source.site === "workbuddy" ? source.site : null
  const token = auth.accessToken ?? auth.access_token
  if (!(source.provider === "workBuddy" || domainSite) || !(account.uid ?? auth.uid ?? metadata.uid ?? source.uid) || typeof token !== "string" || token.trim().length < 16) return null
  const region = metadata.region ?? source.region ?? auth.realm
  const inferred = site ?? domainSite ?? (region === "cn" ? "cn" : region === "global" && fallbackSite === "cn" ? "intl" : fallbackSite)
  return parseImportedCredential(raw, inferred)
}

function chatBase(account: Credential): string {
  if (account.site === "cn") return CHAT_CN
  if (account.domain.endsWith(".codebuddy.ai") || account.domain === "codebuddy.ai") return SITES.intl.api
  if (account.domain.endsWith(".workbuddy.ai") || account.domain === "workbuddy.ai") return SITES.workbuddy.api
  return SITES[account.site].api
}

function billingBase(account: Credential): string { return account.site === "cn" ? BILLING_CN : chatBase(account) }

function billingHeaders(account: Credential): Record<string, string> {
  return {
    Authorization: `Bearer ${account.accessToken}`, "X-Request-ID": randomHex(),
    "X-User-Id": account.uid, "X-Domain": account.domain || hostFrom(billingBase(account)),
    "User-Agent": "axios/1.16.1",
    ...(account.enterpriseId ? { "X-Enterprise-Id": account.enterpriseId, "X-Tenant-Id": account.enterpriseId } : {}),
  }
}

async function accountJSON(uid: string, path: string, method = "GET", body?: unknown, headers?: Record<string, string>, kind: "chat" | "billing" = "chat"): Promise<any> {
  const account = await freshCredential(uid)
  return envelope(`${kind === "billing" ? billingBase(account) : chatBase(account)}${path}`, { method, body, headers: { ...billingHeaders(account), ...headers } })
}

function amount(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0 }

export async function refreshBalance(uid: string): Promise<Account> {
  const account = await freshCredential(uid)
  try {
    let remain = 0, total = 0
    if (account.enterpriseId) {
      const data = await accountJSON(uid, "/v2/billing/meter/get-enterprise-user-usage", "POST", {}, undefined, "billing")
      const limit = Number(data?.limitNum ?? data?.limit_num)
      const used = Number(data?.credit ?? data?.used_num)
      if (!Number.isFinite(limit) || !Number.isFinite(used)) throw new Error("企业额度格式异常")
      total = limit < 0 ? -1 : Math.max(0, Math.round(limit))
      remain = limit < 0 ? -1 : Math.max(0, total - Math.round(used))
    } else if (account.site !== "cn") {
      const data = await accountJSON(uid, "/billing/meter/get-user-resource-summary", "POST", {}, undefined, "billing")
      if (!Array.isArray(data?.Packages)) throw new Error("国际版额度格式异常")
      for (const item of data.Packages) {
        total += amount(item.CycleTotalCapacity)
        remain += amount(item.CycleRemainCapacity)
      }
    } else {
      const now = new Date()
      const body = {
        PageNumber: 1, PageSize: 100, ProductCode: "p_tcaca", Status: [0, 3],
        PackageEndTimeRangeBegin: now.toISOString().slice(0, 19).replace("T", " "),
        PackageEndTimeRangeEnd: new Date(now.getTime() + 100 * 365 * 86400000).toISOString().slice(0, 19).replace("T", " "),
      }
      const data = await accountJSON(uid, "/v2/billing/meter/get-user-resource", "POST", body, undefined, "billing")
      if (!Array.isArray(data?.Response?.Data?.Accounts)) throw new Error("国内版额度格式异常")
      for (const item of data.Response.Data.Accounts) {
        const size = amount(item.CycleCapacitySize || item.CapacitySize)
        const left = amount(item.CycleCapacitySize ? item.CycleCapacityRemain : item.CapacityRemain)
        total += size; remain += Math.min(size, left)
      }
    }
    updateAccount(uid, { credits: remain, total, updatedAt: Date.now(), error: undefined })
  } catch (error) { updateAccount(uid, { error: error instanceof Error ? error.message : String(error) }); throw error }
  return accounts().find(item => item.uid === uid)!
}

export async function checkin(uid: string): Promise<void> {
  const account = await freshCredential(uid)
  if (account.site !== "cn" || account.enterpriseId) throw new Error("该账号不支持国内版个人签到")
  try { await accountJSON(uid, "/v2/billing/meter/daily-checkin", "POST", {}, undefined, "billing") }
  catch (error) {
    if (!(error instanceof UpstreamError && /已签到|already/i.test(error.message))) throw error
  }
  updateAccount(uid, { checkedIn: todayInChina() })
  try { await refreshCheckinStatus(uid, true) } catch { }
  // A balance read can fail after a confirmed check-in; keep the check-in result.
  try { await refreshBalance(uid) } catch { }
}

export async function refreshCheckinStatus(uid: string, force = false): Promise<boolean> {
  const pending = checkingIn.get(uid)
  if (pending && !force) return pending
  const request = (async () => {
    const account = await freshCredential(uid)
    if (account.site !== "cn" || account.enterpriseId) throw new Error("该账号不支持国内版个人签到")
    const data = await accountJSON(uid, "/v2/billing/meter/checkin-activity-status", "POST", {}, undefined, "billing")
    if (typeof data?.today_checked_in !== "boolean") throw new Error("上游未返回今日签到状态")
    // The status read can lag behind a confirmed check-in POST.
    const done = data.today_checked_in || accounts().some(item => item.uid === uid && item.checkedIn === todayInChina())
    updateAccount(uid, { checkedIn: done ? todayInChina() : undefined,
      checkinActive: typeof data.active === "boolean" ? data.active : undefined })
    rememberCheckinStatus(uid)
    return done
  })()
  checkingIn.set(uid, request)
  try { return await request }
  finally { if (checkingIn.get(uid) === request) checkingIn.delete(uid) }
}

export type GiftStatus = { active: boolean; claimed: boolean; creditNum: number; endTime: string }
export type Voucher = { code: string; prizeName: string; validTo: string; grantedAt: string }

export async function giftStatus(uid: string): Promise<GiftStatus> {
  const data = await accountJSON(uid, "/billing/meter/check-gift-claimed", "POST", {}, undefined, "billing")
  if (!data || typeof data !== "object") throw new Error("上游礼包状态格式异常")
  return { active: data.active === true, claimed: data.claimed === true, creditNum: amount(data.credit_num), endTime: String(data.end_time || "") }
}

export async function claimGift(uid: string): Promise<number> {
  const status = await giftStatus(uid)
  if (!status.active || status.claimed || status.creditNum <= 0) throw new Error("当前没有可领取的礼包")
  const result = await accountJSON(uid, "/billing/meter/claim-gift", "POST", {}, undefined, "billing")
  const received = amount(result?.credit)
  if (!received) throw new Error("上游未返回领取积分，请刷新礼包状态确认结果")
  return received
}

export async function vouchers(uid: string): Promise<Voucher[]> {
  const account = await freshCredential(uid)
  if (account.site !== "cn" || account.enterpriseId) return []
  const data = await accountJSON(uid, "/portal/activity/school/vouchers", "GET", undefined, undefined, "billing")
  if (!Array.isArray(data?.items)) throw new Error("上游券码列表格式异常")
  return data.items.filter((item: any) => typeof item?.code === "string" && item.code).map((item: any) => ({
    code: item.code, prizeName: String(item.prize_name || "券码"), validTo: String(item.valid_to || ""), grantedAt: String(item.granted_at || ""),
  }))
}

function taskProgress(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function parseTasks(data: any, miniprogram: boolean): GrowthTask[] {
  if (!Array.isArray(data?.tasks)) throw new Error("上游任务列表格式异常")
  return data.tasks.flatMap((raw: any) => {
    const code = raw?.task_code || raw?.code
    if (typeof code !== "string" || !code) return []
    const progress = raw.progress && typeof raw.progress === "object" ? raw.progress : raw
    const current = taskProgress(progress.current)
    const target = taskProgress(progress.target)
    const claimed = raw.claimed === true || raw.claimed === "true" || raw.accept_status === "claimed"
    const status = String(raw.accept_status || raw.status || "未接受")
    const completedAt = typeof raw.completed_at === "string" ? Date.parse(raw.completed_at) : NaN
    return [{ task_code: code, title: String(raw.title || code), task_desc: String(raw.task_desc || ""),
      description: String(raw.description || ""), current, target, accept_status: status,
      claimed, claimable: !claimed && ((target != null && target > 0 && current != null && current >= target) || ((target == null || target === 0) && status === "completed")),
      has_reward: raw.has_reward === true, locked: raw.locked === true || raw.locked === "true", miniprogram,
      completedAt: Number.isFinite(completedAt) ? completedAt : undefined }]
  })
}

function mergeTaskSources(main: GrowthTask[], extra: GrowthTask[]): GrowthTask[] {
  const merged = new Map(main.map(task => [task.task_code, task]))
  for (const task of extra) {
    const previous = merged.get(task.task_code)
    if (!previous || (task.claimable && (!previous.claimable || !previous.miniprogram)) || (previous.locked && !task.locked)) merged.set(task.task_code, task)
  }
  return [...merged.values()]
}

function growthHeaders(miniprogram = false): Record<string, string> {
  return {
    Origin: CHAT_CN, Referer: `${CHAT_CN}/profile/growth-center`,
    "User-Agent": miniprogram ? MP_UA : CHAT_UA.cn,
    ...(miniprogram ? { "X-Client-Platform": "miniprogram" } : {}),
  }
}

export async function listTasks(uid: string, onWarning?: (message: string) => void): Promise<GrowthTask[]> {
  const account = await freshCredential(uid)
  if (account.enterpriseId) throw new Error("企业账号没有个人成长任务")
  const main = parseTasks(await accountJSON(uid, "/v2/activity/growth/tasks", "GET", undefined, account.site === "cn" ? growthHeaders() : undefined), false)
  if (account.site !== "cn") return withClaimTimes(uid, main)
  try {
    const extra = parseTasks(await accountJSON(uid, "/v2/activity/growth/tasks", "GET", undefined, growthHeaders(true)), true)
    return withClaimTimes(uid, mergeTaskSources(main, extra))
  } catch (error) {
    onWarning?.(`小程序任务读取失败：${error instanceof Error ? error.message : String(error)}`)
    return withClaimTimes(uid, main)
  }
}

function withClaimTimes(uid: string, tasks: GrowthTask[]): GrowthTask[] {
  const times = localClaimTimes()
  return tasks.map(task => task.claimed ? { ...task, claimedAt: times[`${uid}:${task.task_code}`] } : task)
}

function alreadyClaimed(error: unknown): boolean {
  return error instanceof UpstreamError && /\balready[\s_-]*claimed\b|已领取|已领过/i.test(error.message)
}

export async function acceptTask(uid: string, task: GrowthTask): Promise<void> {
  const account = await freshCredential(uid)
  if (account.site !== "cn" || account.enterpriseId) throw new Error("该账号任务只支持查看")
  await accountJSON(uid, "/v2/activity/growth/tasks/accept", "POST", { task_codes: [task.task_code] }, growthHeaders(task.miniprogram))
}

export async function claimTask(uid: string, task: GrowthTask): Promise<void> {
  const account = await freshCredential(uid)
  if (account.site !== "cn" || account.enterpriseId) throw new Error("该账号任务只支持查看")
  if (task.miniprogram) {
    try {
      const result = await accountJSON(uid, `/activity/growth/tasks/${encodeURIComponent(task.task_code)}/claim`, "POST", {}, growthHeaders(true))
      if (result?.already_claimed !== true) recordLocalClaim(uid, task.task_code)
      return
    } catch (error) {
      if (alreadyClaimed(error)) return
      if (!(error instanceof UpstreamError && error.status === 400)) throw error
    }
  }
  const token = await freshCredential(uid)
  try {
    const result = await envelope(`https://www.workbuddy.cn/activity/growth/tasks/${encodeURIComponent(task.task_code)}/claim`, {
      method: "POST", body: {}, headers: {
        Authorization: `Bearer ${token.accessToken}`, Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json", Origin: "https://www.workbuddy.cn",
        Referer: "https://www.workbuddy.cn/profile/growth-center", "X-Client-Platform": "web",
        "User-Agent": CHAT_UA[token.site], "X-User-Id": token.uid,
        "X-Domain": token.domain || hostFrom(billingBase(token)),
        ...(token.enterpriseId ? { "X-Enterprise-Id": token.enterpriseId, "X-Tenant-Id": token.enterpriseId } : {}),
      },
    })
    if (result?.already_claimed !== true) recordLocalClaim(uid, task.task_code)
  } catch (error) { if (!alreadyClaimed(error)) throw error }
}

const text = (error: unknown) => error instanceof Error ? error.message : String(error)

// 与上游 nonChatModel 判据保持一致：嵌入/补全前缀、极小输出、媒体生成模型不可用于对话。
const ROUTER_MODEL_IDS = new Set(["auto", "fast-model", "balanced-model"])
function nonChatModel(id: string, maxOutputTokens: number, tags: string[]): boolean {
  const lower = id.toLowerCase()
  if (ROUTER_MODEL_IDS.has(lower)) return true
  if (["nes-", "completion-", "codewise-"].some(prefix => lower.startsWith(prefix))) return true
  if (maxOutputTokens > 0 && maxOutputTokens <= 256) return true
  return tags.some(tag => ["text-to-image", "image-to-image", "text-to-video", "image-to-video"].includes(tag.toLowerCase().trim()))
}

async function fetchCatalog(uid: string, path: string): Promise<any> {
  const account = await freshCredential(uid)
  return envelope(`${chatBase(account)}${path}`, {
    headers: { ...billingHeaders(account), "User-Agent": CHAT_UA[account.site], "X-Product": "SaaS", Accept: "application/json, text/plain, */*" },
  })
}

// 目录 = /v3/config（全量）与 /console 企业端点（cli agent 过滤）的并集；两路独立容错。
export async function fetchModels(uid: string): Promise<Array<Pick<ModelEntry, "id" | "name">>> {
  const entries = new Map<string, Pick<ModelEntry, "id" | "name">>()
  const collect = (raw: any) => {
    for (const item of Array.isArray(raw) ? raw : []) {
      if (typeof item?.id !== "string" || !item.id || item.disabled === true) continue
      if (nonChatModel(item.id, Number(item.maxOutputTokens) || 0, Array.isArray(item.tags) ? item.tags.map(String) : [])) continue
      if (!entries.has(item.id)) entries.set(item.id, { id: item.id, name: String(item.name || item.id) })
    }
  }
  const errors: string[] = []
  try { collect((await fetchCatalog(uid, "/v3/config"))?.models) }
  catch (error) { errors.push(text(error)) }
  try {
    const data = await fetchCatalog(uid, "/console/enterprises/personal/models")
    const cli = data?.agents?.find((agent: any) => agent?.name === "cli")?.models
    if (Array.isArray(cli)) {
      const byId = new Map((Array.isArray(data.models) ? data.models : []).map((item: any) => [item?.id, item]))
      for (const id of cli) collect([byId.get(id)])
    } else collect(data?.models)
  } catch (error) { errors.push(text(error)) }
  if (!entries.size) throw new Error(errors[0] ? `获取模型列表失败：${errors[0]}` : "上游未返回可用模型")
  return [...entries.values()]
}

export async function refreshModelCatalog(): Promise<ModelEntry[]> {
  const merged = new Map<string, ModelEntry>()
  const errors: string[] = []
  for (const account of accounts()) {
    try {
      const realm = account.site === "cn" ? "cn" : "global"
      for (const entry of await fetchModels(account.uid)) {
        const key = `${realm}:${entry.id}`
        merged.set(key, { ...entry, realm, uids: [...(merged.get(key)?.uids ?? []), account.uid] })
      }
    }
    catch (cause) { errors.push(`${account.nickname}：${text(cause)}`) }
  }
  if (!merged.size) throw new Error(errors[0] || "没有可用账号，请先登录")
  const list = [...merged.values()]
  saveModelCatalog(list)
  return list
}

export async function reportChatActivity(uid: string, modelId = "deepseek-v4.1-flash", modelName = "DeepSeek-V4.1-Flash"): Promise<void> {
  const account = await freshCredential(uid)
  const conversationId = timeOrderedId()
  const requestId = timeOrderedId().replace(/-/g, "")
  const now = Date.now()
  const [machineId, sessionId, qimei36] = await Promise.all([
    stableId(uid, "machine"), stableId(uid, "session"), account.site === "cn" ? stableId(uid, "qimei") : Promise.resolve(""),
  ])
  const version = account.site === "cn" ? "5.9.3" : "5.8.4"
  const event = {
    timezone: "Asia/Shanghai", reportDelay: 2000, userId: uid, username: account.nickname, userNickname: account.nickname,
    product: "SaaS", releaseDate: account.site === "cn" ? 1793093056315 : 1792063084107,
    commit: account.site === "cn" ? "d46924219e79332f49c37ccebf27292f87001b19" : "73952edb48da46bd0b244661efe22f4f247c4977",
    ideName: "WorkBuddy", ideType: "WorkBuddy", ideVersion: version, machineId, sessionId,
    extName: "workbuddy-desktop", extVersion: version, os: "win32", arch: "x64", osVersion: "10.0.28000",
    cpuModel: "11th Gen Intel(R) Core(TM) i5-11320H @ 3.20GHz", cpuCores: 8, memorySize: 16,
    timestamp: now, presentAt: now, ...(qimei36 ? { qimei36 } : {}),
    eventCode: "chat_request_send", mode: "craft", conversationId, requestId, inputLength: 12,
    requestModelId: modelId, requestModelName: modelName,
    isPlan: false, isAutoExecuteTerminal: false, isAutoModify: false, codebaseEnable: false, isMaxMode: true, source: "work",
    mentionContexts: [], knowledgeId: [], knowledgeName: [], codebaseId: "", mentionContextCount: 0,
    command: "", inputAttemptId: timeOrderedId(), recommendId: "", skillId: "",
    traceId: randomHex(), rootRequestId: requestId, parentConversationId: conversationId, agentName: "cli", agentType: "main",
    vcsType: "unknown", vcsRepo: "", vcsBranchName: "", vcsRevId: "", buddyId: "", buddyName: "",
    "codebuddy.session_id": conversationId, "codebuddy.conversation_request_id": requestId,
  }
  await envelope(`${chatBase(account)}/v2/report`, {
    method: "POST", body: [event],
    headers: {
      Accept: "application/json, text/plain, */*", "Content-Type": "application/json;charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest", "X-Request-ID": randomHex(), "X-Product": "SaaS",
      "User-Agent": CHAT_UA[account.site], Authorization: `Bearer ${account.accessToken}`,
      "X-User-Id": uid, "X-Domain": hostFrom(chatBase(account)),
    },
  })
}

export async function adoptFirstBuddy(uid: string): Promise<void> {
  await accountJSON(uid, "/activity/growth/buddy/agreement", "POST", { agree: true })
  await accountJSON(uid, "/activity/growth/buddy/first", "POST", {})
}

export function accountBase(uid: string): string {
  const saved = credential(uid)
  if (!saved) throw new Error("账号不存在")
  return chatBase(saved)
}

function identityHeaders(account: Credential): Record<string, string> {
  const idSource = jwtClaim(account.accessToken, "id_source")
  const tokenSource = jwtClaim(account.accessToken, "token_source")
  const headers: Record<string, string> = {}
  if (idSource) headers["X-Id-Source"] = idSource
  if (!account.enterpriseId && !idSource) return headers
  if (account.enterpriseId && tokenSource) headers["X-Auth-Method"] = tokenSource
  const payload: Record<string, string> = { uin: account.uid }
  if (account.enterpriseId) payload.owner_uin = account.enterpriseId
  if (idSource) payload.id_source = idSource
  if (account.enterpriseId && tokenSource) payload.token_source = tokenSource
  headers["X-Userinfo"] = btoa(JSON.stringify(payload))
  return headers
}

export function chatHeaders(account: Credential, conversationId: string, agentType: "main" | "auxiliary" = "main"): Record<string, string> {
  const version = account.site === "cn" ? "5.9.3" : "5.8.4"
  const brand = account.site === "cn" ? "WorkBuddy" : "workbuddy-ai"
  const messageId = timeOrderedId().replace(/-/g, "")
  const requestId = timeOrderedId().replace(/-/g, "")
  const trace = randomHex()
  const span = randomHex(8)
  const parent = randomHex(8)
  const domain = account.site === "cn" ? hostFrom(CHAT_CN) : "www.workbuddy.ai"
  return {
    "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${account.accessToken}`,
    "X-CodeBuddy-Request": "1", "X-Requested-With": "XMLHttpRequest", "X-User-Id": account.uid,
    "X-Private-Data": account.enterpriseId ? "true" : "false", "X-Product": "SaaS", "X-Agent-Purpose": "conversation",
    "X-IDE-Name": "WorkBuddy", "X-IDE-Type": "WorkBuddy", "X-IDE-Version": version,
    "User-Agent": `WorkBuddy/${version} ${brand}/${version} CLI/${CLI_VERSION}`,
    "X-Conversation-ID": conversationId, "X-Conversation-Request-ID": requestId,
    "X-Conversation-Message-ID": messageId, "X-Request-ID": messageId, "X-Root-Request-ID": requestId,
    "X-Trace-ID": trace, "X-B3-TraceId": trace, "X-B3-SpanId": span, "X-B3-ParentSpanId": parent,
    "X-B3-Sampled": "1", b3: `${trace}-${span}-1-${parent}`, traceparent: `00-${trace}-${span}-01`,
    "X-Agent-Type": agentType, "X-Agent-Intent": "craft", "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": "6.25.0", "X-Stainless-OS": "Windows", "X-Stainless-Arch": "x64",
    "X-Stainless-Runtime": "node", "X-Stainless-Runtime-Version": "v22.21.1", "X-Stainless-Retry-Count": "0",
    "X-Agent-Runtime": "local-agent", "acp-connection-id": timeOrderedId(),
    baggage: `buddyId=,buddyName=,codebuddy.session_id=${conversationId},codebuddy.conversation_request_id=${requestId},x-agent-runtime=local-agent,x-agent-intent=craft`,
    "X-Domain": domain,
    ...identityHeaders(account),
    ...(account.enterpriseId ? { "X-Enterprise-Id": account.enterpriseId } : {}),
  }
}
