import {
  Navigation,
  Tab,
  TabView,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting"

import { DynamicTabView } from "./DynamicTabView"
import { SettingsTabView } from "./SettingsTabView"
import type {
  BiliAuthSession,
  BiliAuthStore,
  BiliAuthorFilterRule,
  BiliFollowedAuthor,
  BiliLoginMode,
  BiliPreferences,
  QrLoginState,
  VideoDynamicItem,
} from "../types"
import {
  BiliAuthError,
  fetchAllFollowedAuthors,
  fetchAllFollowedAuthorsViaWebView,
  fetchCurrentUser,
  fetchCurrentUserViaWebView,
  fetchVideoDynamicsPage,
  fetchVideoDynamicsPageViaWebView,
  pollQrLogin,
  presentBiliWebViewLogin,
  requestQrLogin,
} from "../utils/bilibili"
import {
  getAuthorFilterRule,
  loadStoredPreferences,
  removeAccountPreferences,
  saveStoredPreferences,
  setAuthorFilterRule,
  setLoginMode,
  setPlaybackMode,
} from "../utils/preferences"
import { loadStoredAuthState, saveStoredAuthState } from "../utils/storage"

const DYNAMIC_TAB = 0
const SETTINGS_TAB = 1

async function alertDialog(message: string): Promise<void> {
  const runtimeDialog = (globalThis as any).Dialog
  if (runtimeDialog?.alert) {
    await runtimeDialog.alert({ message })
  }
}

type RootTab = typeof DYNAMIC_TAB | typeof SETTINGS_TAB

function authMessageFromSession(auth: BiliAuthSession | null): string {
  if (!auth?.updatedAt) return ""
  if (auth.user?.uname) {
    const prefix = auth.loginMethod === "webview" ? "网页登录为" : "已登录为"
    return `${prefix} ${auth.user.uname} · ${new Date(auth.updatedAt).toLocaleString("zh-CN")}`
  }
  return new Date(auth.updatedAt).toLocaleString("zh-CN")
}

function upsertAccount(accounts: BiliAuthSession[], session: BiliAuthSession): BiliAuthSession[] {
  const next = [...accounts]
  const index = next.findIndex((item) =>
    item.id === session.id ||
    item.cookieHeader === session.cookieHeader ||
    (
      Boolean(session.user?.mid) &&
      Boolean(item.user?.mid) &&
      item.user?.mid === session.user?.mid
    )
  )
  if (index >= 0) {
    next[index] = session
    return next
  }
  return [session, ...next]
}

function mergeFeedItems(current: VideoDynamicItem[], incoming: VideoDynamicItem[]): VideoDynamicItem[] {
  const map = new Map<string, VideoDynamicItem>()
  for (const item of current) map.set(item.id, item)
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()].sort((left, right) => (right.publishedTs ?? 0) - (left.publishedTs ?? 0))
}

function buildSessionWithUser(
  cookieHeader: string,
  user: BiliAuthSession["user"],
  existing: BiliAuthSession | null,
  loginMethod: BiliLoginMode = "cookie"
): BiliAuthSession {
  return {
    id: existing?.id && !existing.id.startsWith("pending_") ? existing.id : (user?.mid ?? existing?.id ?? `pending_${Date.now()}`),
    cookieHeader,
    refreshToken: existing?.refreshToken ?? "",
    updatedAt: existing?.updatedAt ?? Date.now(),
    user,
    loginMethod,
  }
}

function buildWebViewSession(
  user: NonNullable<BiliAuthSession["user"]>,
  existing: BiliAuthSession | null
): BiliAuthSession {
  return {
    id: `webview:${user.mid}`,
    cookieHeader: "",
    refreshToken: "",
    updatedAt: Date.now(),
    user,
    loginMethod: "webview",
  }
}

function applyAuthorFilter(items: VideoDynamicItem[], rule: BiliAuthorFilterRule): VideoDynamicItem[] {
  if (rule.mode !== "custom") return items
  const allowedMids = new Set(rule.mids)
  return items.filter((item) => allowedMids.has(item.authorMid))
}

export function HomeView() {
  const dismiss = Navigation.useDismiss()
  const [initialStore] = useState<BiliAuthStore>(() => loadStoredAuthState())
  const [initialPreferences] = useState<BiliPreferences>(() => loadStoredPreferences())
  const activeTab = useObservable<RootTab>(DYNAMIC_TAB)
  const [accounts, setAccounts] = useState<BiliAuthSession[]>(initialStore.accounts)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(initialStore.activeAccountId)
  const [preferences, setPreferences] = useState<BiliPreferences>(initialPreferences)
  const cookieAuth = useMemo(
    () => accounts.find((item) => item.id === activeAccountId) ?? accounts[0] ?? null,
    [accounts, activeAccountId]
  )
  const [webViewAuth, setWebViewAuth] = useState<BiliAuthSession | null>(null)
  const loginMode = preferences.loginMode
  const auth = useMemo(
    () => loginMode === "webview" ? webViewAuth : cookieAuth,
    [cookieAuth, loginMode, webViewAuth]
  )
  const [authValidating, setAuthValidating] = useState(
    Boolean(initialPreferences.loginMode === "webview" || cookieAuth?.cookieHeader)
  )
  const [authMessage, setAuthMessage] = useState<string>(() => {
    if (initialPreferences.loginMode === "webview") {
      return "正在校验网页登录状态…"
    }
    return authMessageFromSession(
      initialStore.accounts.find((item) => item.id === initialStore.activeAccountId) ?? initialStore.accounts[0] ?? null
    )
  })
  const [qrLogin, setQrLogin] = useState<QrLoginState | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [webViewRefreshSeed, setWebViewRefreshSeed] = useState(0)
  const [feedItems, setFeedItems] = useState<VideoDynamicItem[]>([])
  const [feedLoading, setFeedLoading] = useState(false)
  const [feedLoadingMore, setFeedLoadingMore] = useState(false)
  const [feedErrorMessage, setFeedErrorMessage] = useState("")
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [feedOffset, setFeedOffset] = useState<string>("")
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [followedAuthors, setFollowedAuthors] = useState<BiliFollowedAuthor[]>([])
  const [followedAuthorsLoading, setFollowedAuthorsLoading] = useState(false)
  const [followedAuthorsErrorMessage, setFollowedAuthorsErrorMessage] = useState("")
  const [followedAuthorsAccountId, setFollowedAuthorsAccountId] = useState<string | null>(null)
  const latestCookieRef = useRef<string>(cookieAuth?.cookieHeader ?? "")
  const activeAccountRef = useRef<string | null>(auth?.id ?? null)
  const activeLoginModeRef = useRef<BiliLoginMode>(loginMode)
  const qrPollTimerRef = useRef<number | null>(null)
  const currentAuthorFilterRule = useMemo(
    () => getAuthorFilterRule(preferences, auth?.id),
    [preferences, auth?.id]
  )
  const filteredFeedItems = useMemo(
    () => applyAuthorFilter(feedItems, currentAuthorFilterRule),
    [feedItems, currentAuthorFilterRule]
  )

  latestCookieRef.current = cookieAuth?.cookieHeader ?? ""
  activeAccountRef.current = auth?.id ?? null
  activeLoginModeRef.current = loginMode

  function clearQrPollTimer() {
    if (qrPollTimerRef.current != null) {
      clearTimeout(qrPollTimerRef.current)
      qrPollTimerRef.current = null
    }
  }

  function persistAccountState(nextAccounts: BiliAuthSession[], nextActiveAccountId: string | null) {
    saveStoredAuthState({
      accounts: nextAccounts,
      activeAccountId: nextActiveAccountId,
    })
    setAccounts(nextAccounts)
    setActiveAccountId(nextActiveAccountId)
  }

  function persistPreferences(nextPreferences: BiliPreferences) {
    saveStoredPreferences(nextPreferences)
    setPreferences(nextPreferences)
  }

  function clearFeedState() {
    setFeedItems([])
    setFeedLoading(false)
    setFeedLoadingMore(false)
    setFeedErrorMessage("")
    setLastUpdatedAt(null)
    setFeedOffset("")
    setFeedHasMore(false)
  }

  function clearFollowedAuthorsState() {
    setFollowedAuthors([])
    setFollowedAuthorsLoading(false)
    setFollowedAuthorsErrorMessage("")
    setFollowedAuthorsAccountId(null)
  }

  function clearCookieAuthState(message = "已删除当前账号") {
    clearQrPollTimer()
    const currentId = cookieAuth?.id ?? null
    const nextAccounts = currentId ? accounts.filter((item) => item.id !== currentId) : [...accounts]
    const nextActiveAccountId = nextAccounts[0]?.id ?? null
    persistAccountState(nextAccounts, nextActiveAccountId)
    if (currentId) {
      persistPreferences(removeAccountPreferences(preferences, currentId))
    }
    setQrLogin(null)
    clearFeedState()
    clearFollowedAuthorsState()
    setAuthMessage(message)
    latestCookieRef.current = nextAccounts.find((item) => item.id === nextActiveAccountId)?.cookieHeader ?? ""
    activeAccountRef.current = nextActiveAccountId
  }

  function clearWebViewAuthState(message = "网页登录已失效，请重新登录") {
    clearQrPollTimer()
    setWebViewAuth(null)
    setQrLogin(null)
    clearFeedState()
    clearFollowedAuthorsState()
    setAuthMessage(message)
    activeAccountRef.current = null
  }

  function applyIncomingSession(session: BiliAuthSession, message: string) {
    clearQrPollTimer()
    const nextSession: BiliAuthSession = {
      ...session,
      id: session.id && !session.id.startsWith("pending_") ? session.id : `pending_${Date.now()}`,
      updatedAt: session.updatedAt || Date.now(),
      loginMethod: "cookie",
    }
    latestCookieRef.current = nextSession.cookieHeader
    const nextAccounts = upsertAccount(accounts, nextSession)
    persistAccountState(nextAccounts, nextSession.id)
    persistPreferences(setLoginMode(preferences, "cookie"))
    setQrLogin(null)
    setAuthMessage(message)
  }

  function syncResolvedCookieUser(cookieHeader: string, user: NonNullable<BiliAuthSession["user"]>): BiliAuthSession {
    const existing = accounts.find((item) => item.cookieHeader === cookieHeader) ?? cookieAuth ?? null
    const nextSession = buildSessionWithUser(cookieHeader, user, existing, "cookie")
    const nextAccounts = upsertAccount(accounts, nextSession)
    persistAccountState(nextAccounts, nextSession.id)
    latestCookieRef.current = cookieHeader
    activeAccountRef.current = nextSession.id
    activeLoginModeRef.current = "cookie"
    return nextSession
  }

  function syncResolvedWebViewUser(user: NonNullable<BiliAuthSession["user"]>): BiliAuthSession {
    const existing = webViewAuth ?? null
    const nextSession = buildWebViewSession(user, existing)
    setWebViewAuth(nextSession)
    activeAccountRef.current = nextSession.id
    activeLoginModeRef.current = "webview"
    return nextSession
  }

  async function refreshFeedWithCookie(
    cookieHeader: string,
    options?: {
      silent?: boolean
      append?: boolean
      offset?: string
    }
  ) {
    const append = Boolean(options?.append)
    if (append) {
      setFeedLoadingMore(true)
    } else if (!options?.silent) {
      setFeedLoading(true)
    }
    if (!append) setFeedErrorMessage("")

    try {
      const feed = await fetchVideoDynamicsPage(cookieHeader, options?.offset)
      if (latestCookieRef.current !== cookieHeader) return
      setFeedItems((current) => append ? mergeFeedItems(current, feed.items) : feed.items)
      setLastUpdatedAt(Date.now())
      setFeedOffset(feed.offset)
      setFeedHasMore(feed.hasMore)
    } catch (error: any) {
      if (latestCookieRef.current !== cookieHeader) return

      if (error instanceof BiliAuthError) {
        clearCookieAuthState("登录已失效，请重新扫码")
        return
      }

      setFeedErrorMessage(String(error?.message ?? error ?? "获取动态失败"))
    } finally {
      if (latestCookieRef.current === cookieHeader) {
        if (append) {
          setFeedLoadingMore(false)
        } else {
          setFeedLoading(false)
        }
      }
    }
  }

  async function refreshAccountWithCookie(
    cookieHeader: string,
    options?: { silent?: boolean }
  ): Promise<NonNullable<BiliAuthSession["user"]> | null> {
    if (!options?.silent) setAuthValidating(true)

    try {
      const user = await fetchCurrentUser(cookieHeader)
      if (latestCookieRef.current !== cookieHeader) return null

      const nextSession = syncResolvedCookieUser(cookieHeader, user)
      setAuthMessage(`已登录为 ${user.uname} · ${new Date(nextSession.updatedAt).toLocaleString("zh-CN")}`)
      return user
    } catch (error: any) {
      if (latestCookieRef.current !== cookieHeader) return null

      if (error instanceof BiliAuthError) {
        clearCookieAuthState("登录已失效，请重新扫码")
        return null
      }

      setAuthMessage(String(error?.message ?? error ?? "校验登录状态失败"))
      return null
    } finally {
      if (latestCookieRef.current === cookieHeader) {
        setAuthValidating(false)
      }
    }
  }

  async function refreshFeedWithWebView(
    options?: {
      silent?: boolean
      append?: boolean
      offset?: string
    }
  ) {
    const append = Boolean(options?.append)
    const expectedAccountId = activeAccountRef.current
    if (append) {
      setFeedLoadingMore(true)
    } else if (!options?.silent) {
      setFeedLoading(true)
    }
    if (!append) setFeedErrorMessage("")

    try {
      const feed = await fetchVideoDynamicsPageViaWebView(options?.offset)
      if (activeLoginModeRef.current !== "webview" || activeAccountRef.current !== expectedAccountId) return
      setFeedItems((current) => append ? mergeFeedItems(current, feed.items) : feed.items)
      setLastUpdatedAt(Date.now())
      setFeedOffset(feed.offset)
      setFeedHasMore(feed.hasMore)
    } catch (error: any) {
      if (activeLoginModeRef.current !== "webview" || activeAccountRef.current !== expectedAccountId) return

      if (error instanceof BiliAuthError) {
        clearWebViewAuthState("网页登录已失效，请重新登录")
        return
      }

      setFeedErrorMessage(String(error?.message ?? error ?? "获取动态失败"))
    } finally {
      if (activeLoginModeRef.current === "webview" && activeAccountRef.current === expectedAccountId) {
        if (append) {
          setFeedLoadingMore(false)
        } else {
          setFeedLoading(false)
        }
      }
    }
  }

  async function refreshAccountWithWebView(
    options?: { silent?: boolean }
  ): Promise<NonNullable<BiliAuthSession["user"]> | null> {
    const expectedMode = activeLoginModeRef.current
    if (!options?.silent) setAuthValidating(true)

    try {
      const user = await fetchCurrentUserViaWebView()
      if (activeLoginModeRef.current !== expectedMode) return null

      const nextSession = syncResolvedWebViewUser(user)
      setAuthMessage(`网页登录为 ${user.uname} · ${new Date(nextSession.updatedAt).toLocaleString("zh-CN")}`)
      return user
    } catch (error: any) {
      if (activeLoginModeRef.current !== expectedMode) return null

      if (error instanceof BiliAuthError) {
        clearWebViewAuthState("网页登录未登录或已失效")
        return null
      }

      setAuthMessage(String(error?.message ?? error ?? "校验网页登录状态失败"))
      return null
    } finally {
      if (activeLoginModeRef.current === expectedMode) {
        setAuthValidating(false)
      }
    }
  }

  async function loadFollowedAuthorsForCurrentAccount(options?: { force?: boolean }) {
    const accountId = auth?.id ?? null
    if (!auth || !accountId) {
      setFollowedAuthorsErrorMessage("请先登录后再筛选 UP 主")
      return
    }
    if (
      !options?.force &&
      followedAuthorsAccountId === accountId &&
      !followedAuthorsLoading &&
      !followedAuthorsErrorMessage
    ) {
      return
    }

    setFollowedAuthorsLoading(true)
    setFollowedAuthorsErrorMessage("")

    try {
      const resolvedUser = auth.loginMethod === "webview"
        ? (auth.user ?? await refreshAccountWithWebView({ silent: true }))
        : (auth.user ?? await refreshAccountWithCookie(auth.cookieHeader, { silent: true }))
      if (activeAccountRef.current !== accountId) return
      if (!resolvedUser?.mid) {
        throw new Error("当前账号信息还没有同步完成，请稍后再试")
      }

      const authors = auth.loginMethod === "webview"
        ? await fetchAllFollowedAuthorsViaWebView(resolvedUser.mid)
        : await fetchAllFollowedAuthors(auth.cookieHeader, resolvedUser.mid)
      if (activeAccountRef.current !== accountId) return

      setFollowedAuthors(authors)
      setFollowedAuthorsAccountId(accountId)
    } catch (error: any) {
      if (activeAccountRef.current !== accountId) return

      if (error instanceof BiliAuthError) {
        if (auth.loginMethod === "webview") {
          clearWebViewAuthState("网页登录已失效，请重新登录")
        } else {
          clearCookieAuthState("登录已失效，请重新扫码")
        }
        return
      }

      setFollowedAuthorsErrorMessage(String(error?.message ?? error ?? "获取关注列表失败"))
    } finally {
      if (activeAccountRef.current === accountId) {
        setFollowedAuthorsLoading(false)
      }
    }
  }

  async function refreshAll() {
    if (!auth) {
      setFeedErrorMessage("请先在设置里登录")
      return
    }

    if (auth.loginMethod === "webview") {
      await refreshAccountWithWebView()
      if (activeLoginModeRef.current === "webview") {
        await refreshFeedWithWebView({ append: false, offset: "" })
      }
      return
    }

    const cookieHeader = auth.cookieHeader ?? ""
    await refreshAccountWithCookie(cookieHeader)
    if (latestCookieRef.current === cookieHeader) {
      await refreshFeedWithCookie(cookieHeader, { append: false, offset: "" })
    }
  }

  async function loadMoreFeed() {
    if (!auth || !feedHasMore || feedLoading || feedLoadingMore || !feedOffset) return
    if (auth.loginMethod === "webview") {
      await refreshFeedWithWebView({
        append: true,
        offset: feedOffset,
        silent: true,
      })
      return
    }

    const cookieHeader = auth.cookieHeader ?? ""
    if (!cookieHeader) return
    await refreshFeedWithCookie(cookieHeader, {
      append: true,
      offset: feedOffset,
      silent: true,
    })
  }

  async function startWebViewLoginFlow() {
    clearQrPollTimer()
    setLoginBusy(true)
    try {
      await presentBiliWebViewLogin()
      const user = await fetchCurrentUserViaWebView()
      const nextSession = syncResolvedWebViewUser(user)
      persistPreferences(setLoginMode(preferences, "webview"))
      activeLoginModeRef.current = "webview"
      setAuthMessage(`网页登录为 ${user.uname} · ${new Date(nextSession.updatedAt).toLocaleString("zh-CN")}`)
      setWebViewRefreshSeed((current) => current + 1)
    } catch (error: any) {
      setAuthMessage(String(error?.message ?? error ?? "网页登录失败"))
    } finally {
      setLoginBusy(false)
    }
  }

  async function startQrLoginFlow() {
    clearQrPollTimer()
    setLoginBusy(true)
    try {
      const result = await requestQrLogin()
      setQrLogin({
        phase: "waiting_scan",
        url: result.url,
        qrcodeKey: result.qrcodeKey,
        message: "请使用哔哩哔哩手机客户端扫码",
        expiresAt: result.expiresAt,
      })
      setAuthMessage("已生成新的登录二维码")
    } catch (error: any) {
      setQrLogin({
        phase: "error",
        url: "",
        qrcodeKey: "",
        message: String(error?.message ?? error ?? "获取登录二维码失败"),
        expiresAt: null,
      })
      setAuthMessage("获取登录二维码失败")
    } finally {
      setLoginBusy(false)
    }
  }

  async function clearAuthByUser() {
    if (loginMode === "webview") {
      clearWebViewAuthState("已清除当前网页登录状态")
      return
    }
    clearCookieAuthState()
  }

  useEffect(() => {
    if (loginMode !== "cookie") {
      setAuthValidating(false)
      return
    }

    const cookieHeader = cookieAuth?.cookieHeader ?? ""
    latestCookieRef.current = cookieHeader

    if (!cookieHeader) {
      setAuthValidating(false)
      return
    }

    let cancelled = false

    ;(async () => {
      setAuthValidating(true)
      try {
        const user = await fetchCurrentUser(cookieHeader)
        if (cancelled || latestCookieRef.current !== cookieHeader) return

        const nextSession = syncResolvedCookieUser(cookieHeader, user)
        setAuthMessage(`已登录为 ${user.uname} · ${new Date(nextSession.updatedAt).toLocaleString("zh-CN")}`)
        clearFeedState()
        await refreshFeedWithCookie(cookieHeader, { silent: false, append: false, offset: "" })
      } catch (error: any) {
        if (cancelled || latestCookieRef.current !== cookieHeader) return

        if (error instanceof BiliAuthError) {
          clearCookieAuthState("登录已失效，请重新扫码")
          return
        }

        setAuthMessage(String(error?.message ?? error ?? "校验登录状态失败"))
      } finally {
        if (!cancelled && latestCookieRef.current === cookieHeader) {
          setAuthValidating(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [cookieAuth?.cookieHeader, loginMode])

  useEffect(() => {
    if (loginMode !== "webview") {
      setAuthValidating(false)
      return
    }

    let cancelled = false

    ;(async () => {
      setAuthValidating(true)
      try {
        const user = await fetchCurrentUserViaWebView()
        if (cancelled || activeLoginModeRef.current !== "webview") return

        const nextSession = syncResolvedWebViewUser(user)
        setAuthMessage(`网页登录为 ${user.uname} · ${new Date(nextSession.updatedAt).toLocaleString("zh-CN")}`)
        clearFeedState()
        await refreshFeedWithWebView({ silent: false, append: false, offset: "" })
      } catch (error: any) {
        if (cancelled || activeLoginModeRef.current !== "webview") return

        if (error instanceof BiliAuthError) {
          clearWebViewAuthState("网页登录未登录，请先完成网页登录")
          return
        }

        setAuthMessage(String(error?.message ?? error ?? "校验网页登录状态失败"))
      } finally {
        if (!cancelled && activeLoginModeRef.current === "webview") {
          setAuthValidating(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loginMode, webViewRefreshSeed])

  useEffect(() => {
    if (!qrLogin?.qrcodeKey) return
    if (qrLogin.phase !== "waiting_scan" && qrLogin.phase !== "waiting_confirm") return

    const currentQrCodeKey = qrLogin.qrcodeKey
    const currentQrPhase = qrLogin.phase
    let cancelled = false
    clearQrPollTimer()

    async function runPoll() {
      try {
        const result = await pollQrLogin(currentQrCodeKey)
        if (cancelled) return

        if (result.status === "success") {
          applyIncomingSession(result.session, "登录成功，正在同步账号信息")
          return
        }

        setQrLogin((current) => {
          if (!current || current.qrcodeKey !== currentQrCodeKey) return current
          return {
            ...current,
            phase: result.status,
            message: result.message,
          }
        })

        if (result.status === "waiting_scan" || result.status === "waiting_confirm") {
          qrPollTimerRef.current = setTimeout(
            () => { void runPoll() },
            result.status === "waiting_confirm" ? 1000 : 1600
          ) as any
          return
        }

        clearQrPollTimer()
      } catch (error: any) {
        if (cancelled) return
        clearQrPollTimer()
        setQrLogin((current) => {
          if (!current || current.qrcodeKey !== currentQrCodeKey) return current
          return {
            ...current,
            phase: "error",
            message: String(error?.message ?? error ?? "登录轮询失败"),
          }
        })
      }
    }

    qrPollTimerRef.current = setTimeout(
      () => { void runPoll() },
      currentQrPhase === "waiting_confirm" ? 1000 : 1600
    ) as any

    return () => {
      cancelled = true
      clearQrPollTimer()
    }
  }, [qrLogin?.qrcodeKey, qrLogin?.phase])

  useEffect(() => {
    if (!auth?.id) {
      clearFeedState()
      clearFollowedAuthorsState()
      return
    }
    latestCookieRef.current = auth.cookieHeader
    activeAccountRef.current = auth.id
    clearFeedState()
    clearFollowedAuthorsState()
  }, [auth?.id, loginMode])

  return (
    <TabView
      selection={activeTab as any}
      tint="#FB7299"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="动态" systemImage="play.square.stack.fill" value={DYNAMIC_TAB}>
        <DynamicTabView
          auth={auth}
          loginMode={loginMode}
          isLoggedIn={loginMode === "webview" ? Boolean(webViewAuth?.user?.mid) : Boolean(cookieAuth?.cookieHeader)}
          isAuthChecking={loginMode === "webview" ? authValidating && !webViewAuth?.user?.mid : authValidating && !cookieAuth?.cookieHeader}
          items={filteredFeedItems}
          totalItemCount={feedItems.length}
          isFilterActive={currentAuthorFilterRule.mode === "custom"}
          followedAuthors={followedAuthors}
          followedAuthorsLoading={followedAuthorsLoading}
          followedAuthorsErrorMessage={followedAuthorsErrorMessage}
          authorFilterRule={currentAuthorFilterRule}
          playbackMode={preferences.playbackMode}
          isLoading={feedLoading}
          errorMessage={feedErrorMessage}
          lastUpdatedAt={lastUpdatedAt}
          onRefresh={refreshAll}
          onExit={dismiss}
          onOpenSettings={() => activeTab.setValue(SETTINGS_TAB)}
          hasMore={feedHasMore}
          isLoadingMore={feedLoadingMore}
          onLoadMore={loadMoreFeed}
          onOpenFilter={() => loadFollowedAuthorsForCurrentAccount()}
          onRetryFollowedAuthors={() => loadFollowedAuthorsForCurrentAccount({ force: true })}
          onUpdateAuthorFilterRule={async (rule) => {
            const accountId = auth?.id ?? null
            if (!accountId) return
            persistPreferences(setAuthorFilterRule(preferences, accountId, rule))
          }}
        />
      </Tab>

      <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
        <SettingsTabView
          auth={auth}
          accounts={accounts}
          loginMode={loginMode}
          validating={authValidating}
          loginBusy={loginBusy}
          qrLogin={qrLogin}
          authMessage={authMessage}
          playbackMode={preferences.playbackMode}
          onExit={dismiss}
          onPlaybackModeChange={async (mode) => {
            persistPreferences(setPlaybackMode(preferences, mode))
          }}
          onLoginModeChange={async (mode) => {
            persistPreferences(setLoginMode(preferences, mode))
            if (mode === "webview") {
              setAuthMessage("正在校验网页登录状态…")
              setWebViewRefreshSeed((current) => current + 1)
              return
            }
            setAuthMessage(authMessageFromSession(cookieAuth))
          }}
          onStartQrLogin={startQrLoginFlow}
          onStartWebViewLogin={startWebViewLoginFlow}
          onRefreshAccount={async () => {
            if (!auth) {
              await alertDialog("当前还没有可用登录，请先完成二维码登录或网页登录")
              return
            }
            if (auth.loginMethod === "webview") {
              setWebViewRefreshSeed((current) => current + 1)
              await refreshAccountWithWebView()
              return
            }
            await refreshAccountWithCookie(auth.cookieHeader)
          }}
          onClearAuth={clearAuthByUser}
          onCancelQrLogin={() => {
            clearQrPollTimer()
            setQrLogin((current) => {
              if (!current) return null
              return {
                ...current,
                phase: "cancelled",
                url: "",
                expiresAt: null,
                message: "已取消本次扫码登录",
              }
            })
            setAuthMessage("已取消当前二维码")
          }}
          onSwitchAccount={async (accountId: string) => {
            if (accountId === cookieAuth?.id && loginMode === "cookie") return
            const next = accounts.find((item) => item.id === accountId) ?? null
            if (!next) return
            persistAccountState(accounts, next.id)
            persistPreferences(setLoginMode(preferences, "cookie"))
            setAuthMessage(`已切换到 ${next.user?.uname ?? "该账号"}`)
          }}
        />
      </Tab>
    </TabView>
  )
}
