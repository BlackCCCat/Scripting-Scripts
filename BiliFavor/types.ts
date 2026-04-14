export type BiliUserProfile = {
  mid: string
  uname: string
  face: string
  level: number
  vipLabel: string
}

export type BiliLoginMode = "cookie" | "webview"

export type BiliAuthSession = {
  id: string
  cookieHeader: string
  refreshToken: string
  updatedAt: number
  user: BiliUserProfile | null
  loginMethod: BiliLoginMode
}

export type BiliAuthStore = {
  activeAccountId: string | null
  accounts: BiliAuthSession[]
}

export type BiliPlaybackMode = "external" | "inline"

export type BiliFollowedAuthor = {
  mid: string
  uname: string
  face: string
  sign: string
  special: boolean
}

export type BiliAuthorFilterRule = {
  mode: "all" | "custom"
  mids: string[]
}

export type BiliPreferences = {
  loginMode: BiliLoginMode
  playbackMode: BiliPlaybackMode
  authorFiltersByAccount: Record<string, BiliAuthorFilterRule>
}

export type VideoDynamicItem = {
  id: string
  authorMid: string
  authorName: string
  authorFace: string
  authorAction: string
  publishedLabel: string
  publishedTs: number | null
  title: string
  description: string
  cover: string
  durationText: string
  playText: string
  danmakuText: string
  badgeText: string
  badgeColor: string
  badgeBackgroundColor: string
  jumpUrl: string
  bvid: string
  aid: string
  majorType: "MAJOR_TYPE_ARCHIVE" | "MAJOR_TYPE_UGC_SEASON"
}

export type VideoDynamicFeed = {
  items: VideoDynamicItem[]
  hasMore: boolean
  offset: string
  updateBaseline: string
}

export type QrLoginPhase =
  | "generating"
  | "waiting_scan"
  | "waiting_confirm"
  | "expired"
  | "cancelled"
  | "error"

export type QrLoginState = {
  phase: QrLoginPhase
  url: string
  qrcodeKey: string
  message: string
  expiresAt: number | null
}

export type BiliInlinePlaybackSource = {
  aid: string
  bvid: string
  cid: string
  url: string
  quality: number
  format: string
  width: number
  height: number
  rotate: number
  preferredOrientation: "portrait" | "landscape" | "unknown"
}
