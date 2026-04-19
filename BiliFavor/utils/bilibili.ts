import { fetch, type Cookie, type Response } from "scripting"

import type {
  BiliAuthSession,
  BiliFavoriteAuthor,
  BiliFollowedAuthor,
  BiliInlinePlaybackSource,
  BiliUserProfile,
  VideoDynamicFeed,
  VideoDynamicItem,
} from "../types"

const BILIBILI_WEB_ORIGIN = "https://www.bilibili.com"
const DEFAULT_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Referer: `${BILIBILI_WEB_ORIGIN}/`,
  Origin: BILIBILI_WEB_ORIGIN,
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Scripting/1.0",
}

export const BILIBILI_WEBVIEW_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15"

const BILIBILI_WEBVIEW_LOGIN_URL = "https://passport.bilibili.com/login"

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

function buildQueryString(params: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value != null && String(value) !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")
}

function buildSortedQueryString(params: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value != null && String(value) !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of String(cookieHeader ?? "").split(";")) {
    const entry = part.trim()
    if (!entry) continue
    const index = entry.indexOf("=")
    if (index <= 0) continue
    const name = entry.slice(0, index).trim()
    const value = entry.slice(index + 1).trim()
    if (!name || !value) continue
    map.set(name, value)
  }
  return map
}

function mergeCookieHeaders(...headers: Array<string | null | undefined>): string {
  const map = new Map<string, string>()
  for (const header of headers) {
    for (const [name, value] of parseCookieHeader(String(header ?? "")).entries()) {
      map.set(name, value)
    }
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
}

export class BiliAuthError extends Error {
}

type BiliApiResponse<T> = {
  code: number
  message: string
  ttl: number
  data: T
}

type CurrentUserPayload = {
  isLogin: boolean
  mid: number | string
  uname: string
  face: string
  level_info?: {
    current_level?: number
  }
  vip_label?: {
    text?: string
  }
  wbi_img?: {
    img_url?: string
    sub_url?: string
  }
}

type DynamicFeedPayload = {
  has_more: boolean
  items: any[]
  offset: string
  update_baseline: string
}

type FollowingsPayload = {
  list?: any[]
  total?: number
}

type SearchUserPayload = {
  result?: any[]
}

type VideoViewPayload = {
  aid?: number | string
  bvid?: string
  cid?: number | string
  title?: string
  dimension?: {
    width?: number | string
    height?: number | string
    rotate?: number | string
  }
  pages?: Array<{
    cid?: number | string
    page?: number
    part?: string
    dimension?: {
      width?: number | string
      height?: number | string
      rotate?: number | string
    }
  }>
}

type PlayUrlPayload = {
  quality?: number
  format?: string
  accept_quality?: number[]
  durl?: Array<{
    url?: string
    backup_url?: string[]
  }>
}

type QrGeneratePayload = {
  url: string
  qrcode_key: string
}

type QrPollPayload = {
  url: string
  refresh_token: string
  timestamp: number
  code: number
  message: string
}

function buildWebViewSyncGetScript(url: string): string {
  const escapedUrl = JSON.stringify(url)

  return `
    return (function () {
      try {
        var xhr = new XMLHttpRequest()
        xhr.open("GET", ${escapedUrl}, false)
        xhr.withCredentials = true
        xhr.send(null)
        return xhr.responseText || ""
      } catch (error) {
        return "__SCRIPTING_WEBVIEW_ERROR__" + String(error)
      }
    })()
  `
}

function unwrapWebViewResponse(raw: string, context: string): string {
  const text = String(raw ?? "")
  if (text.startsWith("__SCRIPTING_WEBVIEW_ERROR__")) {
    throw new Error(`${context}：${text.replace("__SCRIPTING_WEBVIEW_ERROR__", "").trim()}`)
  }
  return text
}

async function createPreparedBiliWebViewController(url: string) {
  const controller = new WebViewController()
  controller.setCustomUserAgent(BILIBILI_WEBVIEW_USER_AGENT)
  const loaded = await controller.loadURL(url)
  if (!loaded) {
    controller.dispose()
    throw new Error(`WebView 未能载入 ${url}`)
  }
  return controller
}

async function requestWebViewJsonWithController<T>(
  controller: any,
  url: string,
  context: string
): Promise<BiliApiResponse<T>> {
  const raw = await controller.evaluateJavaScript(buildWebViewSyncGetScript(url)) as string
  const text = unwrapWebViewResponse(raw, context)
  return JSON.parse(text) as BiliApiResponse<T>
}

async function requestWebViewJson<T>(url: string, context: string): Promise<BiliApiResponse<T>> {
  const controller = await createPreparedBiliWebViewController(BILIBILI_WEB_ORIGIN)
  try {
    return await requestWebViewJsonWithController<T>(controller, url, context)
  } finally {
    controller.dispose()
  }
}

export function buildCookieHeader(cookies: Cookie[]): string {
  const names = new Set<string>()
  const parts: string[] = []

  for (const cookie of cookies) {
    const name = String(cookie?.name ?? "").trim()
    const value = String(cookie?.value ?? "").trim()
    if (!name || !value || names.has(name)) continue
    names.add(name)
    parts.push(`${name}=${value}`)
  }

  return parts.join("; ")
}

export function toAbsoluteUrl(url: string): string {
  const value = String(url ?? "").trim()
  if (!value) return ""
  if (value.startsWith("//")) return `https:${value}`
  if (value.startsWith("/")) return `${BILIBILI_WEB_ORIGIN}${value}`
  return value
}

function getFileStem(url: string): string {
  const value = String(url ?? "").trim()
  if (!value) return ""
  const fileName = value.split("/").pop()?.split("?")[0] ?? ""
  const dotIndex = fileName.indexOf(".")
  return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName
}

function getWbiMixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`
  return WBI_MIXIN_KEY_ENC_TAB
    .map((index) => raw[index] ?? "")
    .join("")
    .slice(0, 32)
}

function sanitizeWbiValue(value: string | number | boolean): string {
  return String(value).replace(/[!'()*]/g, "")
}

async function fetchWbiKeys(cookieHeader: string): Promise<{
  imgKey: string
  subKey: string
}> {
  const { payload } = await requestJson<CurrentUserPayload>(
    "https://api.bilibili.com/x/web-interface/nav",
    { cookieHeader }
  )
  const data = ensureBiliSuccess(payload, "获取 WBI 参数失败")
  const imgKey = getFileStem(String(data?.wbi_img?.img_url ?? ""))
  const subKey = getFileStem(String(data?.wbi_img?.sub_url ?? ""))

  if (!imgKey || !subKey) {
    throw new Error("当前账号未返回可用的 WBI 参数")
  }

  return {
    imgKey,
    subKey,
  }
}

async function fetchWbiContext(cookieHeader?: string): Promise<{
  imgKey: string
  subKey: string
  cookieHeader: string
}> {
  const { payload, response } = await requestJson<CurrentUserPayload>(
    "https://api.bilibili.com/x/web-interface/nav",
    { cookieHeader }
  )
  const data = ensureBiliSuccess(payload, "获取 WBI 参数失败")
  const imgKey = getFileStem(String(data?.wbi_img?.img_url ?? ""))
  const subKey = getFileStem(String(data?.wbi_img?.sub_url ?? ""))

  if (!imgKey || !subKey) {
    throw new Error("当前环境未返回可用的 WBI 参数")
  }

  return {
    imgKey,
    subKey,
    cookieHeader: mergeCookieHeaders(cookieHeader, buildCookieHeader(response.cookies ?? [])),
  }
}

async function requestSignedWbiJson<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  cookieHeader?: string
): Promise<{
  payload: BiliApiResponse<T>
  response: Response
}> {
  const { imgKey, subKey, cookieHeader: resolvedCookieHeader } = await fetchWbiContext(cookieHeader)
  const mixinKey = getWbiMixinKey(imgKey, subKey)
  const preparedParams: Record<string, string> = {}

  for (const [key, value] of Object.entries({
    ...params,
    wts: Math.round(Date.now() / 1000),
  })) {
    if (value == null || String(value) === "") continue
    preparedParams[key] = sanitizeWbiValue(value)
  }

  const query = buildSortedQueryString(preparedParams)
  const signData = Data.fromString(`${query}${mixinKey}`)
  if (!signData) {
    throw new Error("生成 WBI 签名数据失败")
  }
  const wRid = Crypto.md5(signData).toHexString()
  const signedUrl = `${path}?${query}&w_rid=${wRid}`

  return requestJson<T>(signedUrl, { cookieHeader: resolvedCookieHeader })
}

function withCookie(cookieHeader?: string, headers?: Record<string, string>): Record<string, string> {
  return {
    ...DEFAULT_HEADERS,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(headers ?? {}),
  }
}

async function requestJson<T>(
  url: string,
  options?: {
    cookieHeader?: string
    headers?: Record<string, string>
  }
): Promise<{
  payload: BiliApiResponse<T>
  response: Response
}> {
  const response = await fetch(url, {
    method: "GET",
    headers: withCookie(options?.cookieHeader, options?.headers),
  })

  const payload = await response.json() as BiliApiResponse<T>
  return {
    payload,
    response,
  }
}

async function requestFormJson<T>(
  url: string,
  body: Record<string, string | number | boolean | null | undefined>,
  options?: {
    cookieHeader?: string
    headers?: Record<string, string>
  }
): Promise<{
  payload: BiliApiResponse<T>
  response: Response
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: withCookie(options?.cookieHeader, {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...(options?.headers ?? {}),
    }),
    body: buildQueryString(body),
  })

  const payload = await response.json() as BiliApiResponse<T>
  return {
    payload,
    response,
  }
}

function getCookieValue(cookieHeader: string, name: string): string {
  const target = `${String(name ?? "").trim()}=`
  if (!target.trim()) return ""
  return String(cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(target))
    ?.slice(target.length)
    .trim() ?? ""
}

function ensureBiliSuccess<T>(payload: BiliApiResponse<T>, fallbackMessage: string): T {
  if (payload?.code === 0) return payload.data
  if (payload?.code === -101) {
    throw new BiliAuthError("登录已失效，请重新扫码登录")
  }
  throw new Error(String(payload?.message ?? fallbackMessage))
}

function normalizeBadge(raw: any, fallbackText: string) {
  return {
    text: String(raw?.text ?? fallbackText).trim() || fallbackText,
    color: String(raw?.color ?? "#FFFFFF").trim() || "#FFFFFF",
    backgroundColor: String(raw?.bg_color ?? "#FB7299").trim() || "#FB7299",
  }
}

function stripHtmlTags(value: any): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .trim()
}

function formatRelativePublishedLabel(timestampSeconds: number): string {
  const ts = Math.max(0, Math.floor(Number(timestampSeconds) || 0))
  if (!ts) return ""

  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 172800) return "昨天"

  return new Date(ts * 1000).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  })
}

function mapVideoDynamicItem(raw: any): VideoDynamicItem | null {
  const author = raw?.modules?.module_author ?? {}
  const major = raw?.modules?.module_dynamic?.major ?? {}
  const majorType = String(major?.type ?? "")

  if (majorType !== "MAJOR_TYPE_ARCHIVE" && majorType !== "MAJOR_TYPE_UGC_SEASON") {
    return null
  }

  const content = majorType === "MAJOR_TYPE_ARCHIVE" ? major?.archive : major?.ugc_season
  const title = String(content?.title ?? "").trim()
  const jumpUrl = toAbsoluteUrl(String(content?.jump_url ?? ""))
  const aid = String(content?.aid ?? "").trim()

  if (!title || !jumpUrl || !aid) return null

  const badge = normalizeBadge(content?.badge, majorType === "MAJOR_TYPE_ARCHIVE" ? "投稿视频" : "合集更新")

  return {
    id: String(raw?.id_str ?? `${majorType}-${aid}`),
    authorMid: String(author?.mid ?? "").trim(),
    authorName: String(author?.name ?? "未知 UP").trim() || "未知 UP",
    authorFace: toAbsoluteUrl(String(author?.face ?? "")),
    authorAction: String(author?.pub_action ?? "").trim(),
    publishedLabel: String(author?.pub_time ?? "").trim(),
    publishedTs: author?.pub_ts == null ? null : Number(author.pub_ts) || null,
    title,
    description: String(content?.desc ?? "").trim(),
    cover: toAbsoluteUrl(String(content?.cover ?? "")),
    durationText: String(content?.duration_text ?? "").trim(),
    playText: String(content?.stat?.play ?? "0"),
    danmakuText: String(content?.stat?.danmaku ?? "0"),
    badgeText: badge.text,
    badgeColor: badge.color,
    badgeBackgroundColor: badge.backgroundColor,
    jumpUrl,
    bvid: String(content?.bvid ?? "").trim(),
    aid,
    majorType,
  }
}

export async function fetchCurrentUser(cookieHeader: string): Promise<BiliUserProfile> {
  const { payload } = await requestJson<CurrentUserPayload>(
    "https://api.bilibili.com/x/web-interface/nav",
    { cookieHeader }
  )
  const data = ensureBiliSuccess(payload, "获取账号信息失败")

  if (!data?.isLogin) {
    throw new BiliAuthError("当前 Cookie 未登录")
  }

  return {
    mid: String(data?.mid ?? "").trim(),
    uname: String(data?.uname ?? "").trim() || "哔哩哔哩用户",
    face: toAbsoluteUrl(String(data?.face ?? "")),
    level: Number(data?.level_info?.current_level ?? 0) || 0,
    vipLabel: String(data?.vip_label?.text ?? "").trim(),
  }
}

export async function presentBiliWebViewLogin(): Promise<void> {
  const controller = await createPreparedBiliWebViewController(BILIBILI_WEBVIEW_LOGIN_URL)
  try {
    await controller.present({
      fullscreen: false,
      navigationTitle: "网页登录",
    })
  } finally {
    controller.dispose()
  }
}

export async function fetchCurrentUserViaWebView(): Promise<BiliUserProfile> {
  const payload = await requestWebViewJson<CurrentUserPayload>(
    "https://api.bilibili.com/x/web-interface/nav",
    "获取网页登录账号信息失败"
  )
  const data = ensureBiliSuccess(payload, "获取网页登录账号信息失败")

  if (!data?.isLogin) {
    throw new BiliAuthError("当前网页登录未登录")
  }

  return {
    mid: String(data?.mid ?? "").trim(),
    uname: String(data?.uname ?? "").trim() || "哔哩哔哩用户",
    face: toAbsoluteUrl(String(data?.face ?? "")),
    level: Number(data?.level_info?.current_level ?? 0) || 0,
    vipLabel: String(data?.vip_label?.text ?? "").trim(),
  }
}

function mapFollowedAuthor(raw: any): BiliFollowedAuthor | null {
  const mid = String(raw?.mid ?? "").trim()
  const uname = String(raw?.uname ?? "").trim()
  if (!mid || !uname) return null

  return {
    mid,
    uname,
    face: toAbsoluteUrl(String(raw?.face ?? "")),
    sign: String(raw?.sign ?? "").trim(),
    special: Number(raw?.special ?? 0) === 1,
  }
}

function mapFavoriteAuthor(raw: any): BiliFavoriteAuthor | null {
  const mid = String(raw?.mid ?? "").trim()
  const uname = stripHtmlTags(raw?.uname)
  if (!mid || !uname) return null

  return {
    mid,
    uname,
    face: toAbsoluteUrl(String(raw?.upic ?? raw?.face ?? "")),
    sign: stripHtmlTags(raw?.usign),
    fans: Math.max(0, Number(raw?.fans ?? 0) || 0),
    videos: Math.max(0, Number(raw?.videos ?? 0) || 0),
    officialVerifyDesc: stripHtmlTags(raw?.official_verify?.desc),
  }
}

function mapFavoriteAuthorVideoItem(raw: any, author: BiliFavoriteAuthor): VideoDynamicItem | null {
  const bvid = String(raw?.bvid ?? "").trim()
  const aid = String(raw?.aid ?? "").trim()
  const title = stripHtmlTags(raw?.title)
  if (!title || (!bvid && !aid)) return null

  const jumpUrl = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : (String(raw?.arcurl ?? "").trim() || (aid ? `https://www.bilibili.com/video/av${aid}` : ""))
  if (!jumpUrl) return null

  const publishedTs = Math.max(0, Number(raw?.created ?? raw?.pubdate ?? 0) || 0) || null

  return {
    id: `favorite-${author.mid}-${bvid || aid}`,
    authorMid: author.mid,
    authorName: author.uname,
    authorFace: author.face,
    authorAction: "投稿了视频",
    publishedLabel: publishedTs ? formatRelativePublishedLabel(publishedTs) : "",
    publishedTs,
    title,
    description: stripHtmlTags(raw?.description ?? raw?.desc),
    cover: toAbsoluteUrl(String(raw?.pic ?? "")),
    durationText: String(raw?.length ?? raw?.duration ?? "").trim(),
    playText: String(raw?.play ?? "0").trim() || "0",
    danmakuText: String(raw?.comment ?? raw?.dm ?? "0").trim() || "0",
    badgeText: "收藏 UP",
    badgeColor: "#FFFFFF",
    badgeBackgroundColor: "#FB7299",
    jumpUrl: toAbsoluteUrl(jumpUrl),
    bvid,
    aid,
    majorType: "MAJOR_TYPE_ARCHIVE",
  }
}

export async function fetchAllFollowedAuthors(
  cookieHeader: string,
  vmid: string
): Promise<BiliFollowedAuthor[]> {
  const userMid = String(vmid ?? "").trim()
  if (!userMid) {
    throw new Error("缺少当前账号 mid，无法获取关注列表")
  }

  const pageSize = 50
  const totalPagesLimit = 100
  const result: BiliFollowedAuthor[] = []
  const seen = new Set<string>()
  let expectedTotalPages = totalPagesLimit

  for (let pn = 1; pn <= totalPagesLimit; pn += 1) {
    const params = buildQueryString({
      vmid: userMid,
      order_type: "",
      ps: pageSize,
      pn,
    })

    const { payload } = await requestJson<FollowingsPayload>(
      `https://api.bilibili.com/x/relation/followings?${params}`,
      { cookieHeader }
    )
    const data = ensureBiliSuccess(payload, "获取关注列表失败")
    const total = Number(data?.total ?? 0) || 0
    if (total > 0) {
      expectedTotalPages = Math.min(totalPagesLimit, Math.max(1, Math.ceil(total / pageSize)))
    }
    const current = Array.isArray(data?.list)
      ? data.list
        .map((item) => mapFollowedAuthor(item))
        .filter(Boolean) as BiliFollowedAuthor[]
      : []

    for (const item of current) {
      if (seen.has(item.mid)) continue
      seen.add(item.mid)
      result.push(item)
    }

    if (current.length < pageSize || pn >= expectedTotalPages) break
  }

  return result
    .sort((left, right) => {
      if (left.special !== right.special) return left.special ? -1 : 1
      return left.uname.localeCompare(right.uname, "zh-Hans-CN")
    })
}

export async function fetchAllFollowedAuthorsViaWebView(vmid: string): Promise<BiliFollowedAuthor[]> {
  const userMid = String(vmid ?? "").trim()
  if (!userMid) {
    throw new Error("缺少当前账号 mid，无法获取关注列表")
  }

  const pageSize = 50
  const totalPagesLimit = 100
  const result: BiliFollowedAuthor[] = []
  const seen = new Set<string>()
  let expectedTotalPages = totalPagesLimit
  const controller = await createPreparedBiliWebViewController(BILIBILI_WEB_ORIGIN)

  try {
    for (let pn = 1; pn <= totalPagesLimit; pn += 1) {
      const params = buildQueryString({
        vmid: userMid,
        order_type: "",
        ps: pageSize,
        pn,
      })

      const payload = await requestWebViewJsonWithController<FollowingsPayload>(
        controller,
        `https://api.bilibili.com/x/relation/followings?${params}`,
        "获取网页登录关注列表失败"
      )
      const data = ensureBiliSuccess(payload, "获取网页登录关注列表失败")
      const total = Number(data?.total ?? 0) || 0
      if (total > 0) {
        expectedTotalPages = Math.min(totalPagesLimit, Math.max(1, Math.ceil(total / pageSize)))
      }
      const current = Array.isArray(data?.list)
        ? data.list
          .map((item) => mapFollowedAuthor(item))
          .filter(Boolean) as BiliFollowedAuthor[]
        : []

      for (const item of current) {
        if (seen.has(item.mid)) continue
        seen.add(item.mid)
        result.push(item)
      }

      if (current.length < pageSize || pn >= expectedTotalPages) break
    }
  } finally {
    controller.dispose()
  }

  return result
    .sort((left, right) => {
      if (left.special !== right.special) return left.special ? -1 : 1
      return left.uname.localeCompare(right.uname, "zh-Hans-CN")
    })
}

export async function searchFavoriteAuthors(
  keyword: string,
  cookieHeader?: string
): Promise<BiliFavoriteAuthor[]> {
  const trimmedKeyword = String(keyword ?? "").trim()
  if (!trimmedKeyword) return []

  const { payload } = await requestSignedWbiJson<SearchUserPayload>(
    "https://api.bilibili.com/x/web-interface/wbi/search/type",
    {
      search_type: "bili_user",
      keyword: trimmedKeyword,
      user_type: 1,
      order: "fans",
      order_sort: 0,
      page: 1,
    },
    cookieHeader
  )
  const data = ensureBiliSuccess(payload, "搜索 UP 主失败")
  const seen = new Set<string>()

  return (Array.isArray(data?.result) ? data.result : [])
    .map((item) => mapFavoriteAuthor(item))
    .filter((item): item is BiliFavoriteAuthor => Boolean(item))
    .filter((item) => {
      if (seen.has(item.mid)) return false
      seen.add(item.mid)
      return true
    })
}

export async function fetchFavoriteAuthorVideos(
  author: BiliFavoriteAuthor,
  options?: {
    page?: number
    pageSize?: number
    keyword?: string
    cookieHeader?: string
  }
): Promise<VideoDynamicFeed> {
  const mid = String(author?.mid ?? "").trim()
  if (!mid) {
    throw new Error("缺少 UP 主 UID")
  }

  const { payload } = await requestSignedWbiJson<any>(
    "https://api.bilibili.com/x/space/wbi/arc/search",
    {
      mid,
      pn: Math.max(1, Number(options?.page ?? 1) || 1),
      ps: Math.max(1, Math.min(30, Number(options?.pageSize ?? 10) || 10)),
      order: "pubdate",
      keyword: String(options?.keyword ?? "").trim() || undefined,
    },
    options?.cookieHeader
  )
  const data = ensureBiliSuccess(payload, "获取收藏 UP 视频失败")
  const list = data?.list ?? {}
  const page = data?.page ?? {}
  const items = Array.isArray(list?.vlist)
    ? list.vlist
      .map((item: any) => mapFavoriteAuthorVideoItem(item, author))
      .filter(Boolean) as VideoDynamicItem[]
    : []

  items.sort((left, right) => (right.publishedTs ?? 0) - (left.publishedTs ?? 0))

  const currentPage = Math.max(1, Number(page?.pn ?? options?.page ?? 1) || 1)
  const pageSize = Math.max(1, Number(page?.ps ?? options?.pageSize ?? 10) || 10)
  const totalCount = Math.max(0, Number(page?.count ?? items.length) || 0)
  const hasMore = currentPage * pageSize < totalCount

  return {
    items,
    hasMore,
    offset: hasMore ? String(currentPage + 1) : "",
    updateBaseline: "",
  }
}

export async function fetchFavoriteAuthorsFeed(
  authors: BiliFavoriteAuthor[],
  options?: {
    pageSizePerAuthor?: number
    keyword?: string
    cookieHeader?: string
  }
): Promise<VideoDynamicFeed> {
  const cleanAuthors = authors.filter((item) => Boolean(String(item?.mid ?? "").trim()))
  if (cleanAuthors.length === 0) {
    return {
      items: [],
      hasMore: false,
      offset: "",
      updateBaseline: "",
    }
  }

  const feeds = await Promise.all(cleanAuthors.map((author) =>
    fetchFavoriteAuthorVideos(author, {
      page: 1,
      pageSize: options?.pageSizePerAuthor ?? 8,
      keyword: options?.keyword,
      cookieHeader: options?.cookieHeader,
    })
  ))

  const map = new Map<string, VideoDynamicItem>()
  for (const item of feeds.flatMap((feed) => feed.items)) {
    map.set(item.id, item)
  }

  return {
    items: [...map.values()].sort((left, right) => (right.publishedTs ?? 0) - (left.publishedTs ?? 0)),
    hasMore: false,
    offset: "",
    updateBaseline: "",
  }
}

export async function fetchVideoDynamics(cookieHeader: string): Promise<VideoDynamicFeed> {
  return fetchVideoDynamicsPage(cookieHeader)
}

export async function fetchVideoDynamicsPage(
  cookieHeader: string,
  offset?: string
): Promise<VideoDynamicFeed> {
  const params = buildQueryString({
    type: "video",
    platform: "web",
    web_location: "333.1365",
    features: "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete",
    offset: String(offset ?? "").trim() || undefined,
  })

  const { payload } = await requestJson<DynamicFeedPayload>(
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?${params}`,
    { cookieHeader }
  )
  const data = ensureBiliSuccess(payload, "获取视频动态失败")

  const items = Array.isArray(data?.items)
    ? data.items
      .map((item) => mapVideoDynamicItem(item))
      .filter(Boolean) as VideoDynamicItem[]
    : []

  items.sort((left, right) => (right.publishedTs ?? 0) - (left.publishedTs ?? 0))

  return {
    items,
    hasMore: Boolean(data?.has_more),
    offset: String(data?.offset ?? ""),
    updateBaseline: String(data?.update_baseline ?? ""),
  }
}

export async function fetchVideoDynamicsPageViaWebView(offset?: string): Promise<VideoDynamicFeed> {
  const params = buildQueryString({
    type: "video",
    platform: "web",
    web_location: "333.1365",
    features: "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete",
    offset: String(offset ?? "").trim() || undefined,
  })

  const payload = await requestWebViewJson<DynamicFeedPayload>(
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?${params}`,
    "获取网页登录视频动态失败"
  )
  const data = ensureBiliSuccess(payload, "获取网页登录视频动态失败")

  const items = Array.isArray(data?.items)
    ? data.items
      .map((item) => mapVideoDynamicItem(item))
      .filter(Boolean) as VideoDynamicItem[]
    : []

  items.sort((left, right) => (right.publishedTs ?? 0) - (left.publishedTs ?? 0))

  return {
    items,
    hasMore: Boolean(data?.has_more),
    offset: String(data?.offset ?? ""),
    updateBaseline: String(data?.update_baseline ?? ""),
  }
}

function pickVideoCid(data: VideoViewPayload): string {
  const primaryCid = String(data?.cid ?? "").trim()
  if (primaryCid) return primaryCid

  const pages = Array.isArray(data?.pages) ? data.pages : []
  const firstPage = pages.find((page) => Number(page?.page ?? 0) === 1) ?? pages[0]
  const pageCid = String(firstPage?.cid ?? "").trim()
  if (pageCid) return pageCid

  throw new Error("没有找到可播放的分 P 信息")
}

function resolveVideoDimension(data: VideoViewPayload, cid: string): {
  width: number
  height: number
  rotate: number
  preferredOrientation: "portrait" | "landscape" | "unknown"
} {
  const pages = Array.isArray(data?.pages) ? data.pages : []
  const matchedPage = pages.find((page) => String(page?.cid ?? "").trim() === cid)
  const rawDimension = matchedPage?.dimension ?? data?.dimension ?? {}
  const width = Math.max(0, Number(rawDimension?.width ?? 0) || 0)
  const height = Math.max(0, Number(rawDimension?.height ?? 0) || 0)
  const rotate = Number(rawDimension?.rotate ?? 0) || 0
  const effectiveWidth = rotate === 1 ? height : width
  const effectiveHeight = rotate === 1 ? width : height

  let preferredOrientation: "portrait" | "landscape" | "unknown" = "unknown"
  if (effectiveWidth > 0 && effectiveHeight > 0) {
    preferredOrientation = effectiveHeight > effectiveWidth ? "portrait" : "landscape"
  }

  return {
    width,
    height,
    rotate,
    preferredOrientation,
  }
}

export async function fetchInlinePlaybackSource(
  cookieHeader: string,
  item: Pick<VideoDynamicItem, "aid" | "bvid">
): Promise<BiliInlinePlaybackSource> {
  const viewParams = buildQueryString({
    bvid: item.bvid,
    aid: item.aid,
  })
  const { payload: viewPayload } = await requestJson<VideoViewPayload>(
    `https://api.bilibili.com/x/web-interface/view?${viewParams}`,
    { cookieHeader }
  )
  const viewData = ensureBiliSuccess(viewPayload, "获取视频信息失败")
  const cid = pickVideoCid(viewData)
  const dimension = resolveVideoDimension(viewData, cid)

  const { payload: playPayload } = await requestSignedWbiJson<PlayUrlPayload>(
    "https://api.bilibili.com/x/player/wbi/playurl",
    {
      bvid: item.bvid,
      avid: item.aid,
      cid,
      qn: 80,
      platform: "html5",
      high_quality: 1,
      fnval: 1,
      fnver: 0,
      fourk: 1,
      try_look: 1,
      otype: "json",
    },
    cookieHeader
  )
  const playData = ensureBiliSuccess(playPayload, "获取视频播放地址失败")
  const firstSegment = Array.isArray(playData?.durl) ? playData.durl[0] : null
  const directUrl = toAbsoluteUrl(String(firstSegment?.url ?? ""))
  const backupUrl = toAbsoluteUrl(String(firstSegment?.backup_url?.[0] ?? ""))
  const sourceUrl = directUrl || backupUrl

  if (!sourceUrl) {
    throw new Error("当前视频暂时无法解析出可直接播放的地址")
  }

  return {
    aid: String(viewData?.aid ?? item.aid ?? "").trim(),
    bvid: String(viewData?.bvid ?? item.bvid ?? "").trim(),
    cid,
    url: sourceUrl,
    quality: Number(playData?.quality ?? 0) || 0,
    format: String(playData?.format ?? "").trim(),
    width: dimension.width,
    height: dimension.height,
    rotate: dimension.rotate,
    preferredOrientation: dimension.preferredOrientation,
  }
}

export async function reportPlaybackProgress(
  cookieHeader: string,
  source: Pick<BiliInlinePlaybackSource, "aid" | "cid">,
  progressSeconds: number
): Promise<void> {
  const aid = String(source?.aid ?? "").trim()
  const cid = String(source?.cid ?? "").trim()
  const csrf = getCookieValue(cookieHeader, "bili_jct")
  const progress = Math.max(0, Math.floor(Number(progressSeconds) || 0))

  if (!aid || !cid || !csrf) return

  const { payload } = await requestFormJson<Record<string, never>>(
    "https://api.bilibili.com/x/v2/history/report",
    {
      aid,
      cid,
      progress,
      platform: "android",
      csrf,
    },
    { cookieHeader }
  )
  ensureBiliSuccess(payload, "上报观看进度失败")
}

export async function requestQrLogin(): Promise<{
  url: string
  qrcodeKey: string
  expiresAt: number
}> {
  const { payload } = await requestJson<QrGeneratePayload>(
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
  )
  const data = ensureBiliSuccess(payload, "获取登录二维码失败")

  return {
    url: String(data?.url ?? "").trim(),
    qrcodeKey: String(data?.qrcode_key ?? "").trim(),
    expiresAt: Date.now() + 180_000,
  }
}

export async function pollQrLogin(qrcodeKey: string): Promise<
  | {
    status: "waiting_scan" | "waiting_confirm" | "expired"
    message: string
  }
  | {
    status: "success"
    session: BiliAuthSession
  }
> {
  const params = buildQueryString({
    qrcode_key: qrcodeKey,
  })
  const { payload, response } = await requestJson<QrPollPayload>(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?${params}`
  )
  const data = ensureBiliSuccess(payload, "轮询登录二维码失败")

  if (data?.code === 86101) {
    return {
      status: "waiting_scan",
      message: "等待哔哩哔哩客户端扫码",
    }
  }
  if (data?.code === 86090) {
    return {
      status: "waiting_confirm",
      message: "已扫码，请在手机上确认登录",
    }
  }
  if (data?.code === 86038) {
    return {
      status: "expired",
      message: "二维码已失效，请重新获取",
    }
  }
  if (data?.code !== 0) {
    throw new Error(String(data?.message ?? "二维码登录失败"))
  }

  const cookieHeader = buildCookieHeader(response.cookies ?? [])
  if (!cookieHeader) {
    throw new Error("登录成功，但没有拿到 Cookie")
  }

  return {
    status: "success",
    session: {
      id: "",
      cookieHeader,
      refreshToken: String(data?.refresh_token ?? "").trim(),
      updatedAt: Date.now(),
      user: null,
      loginMethod: "cookie",
    },
  }
}
