import { getDashboardLanguage, localize, setLocalizationPreference } from "../utils/localization"
import {
  AppEvents,
  Button,
  ContentUnavailableView,
  Device,
  EmptyView,
  ForEach,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  Script,
  Section,
  Spacer,
  Tab,
  TabView,
  Text,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
  VStack,
} from "scripting"
import {
  QuotaQueryError,
  queryProviderQuota,
} from "../providers"
import { redeemCodexResetCredit } from "../providers/codex"
import { refreshCredentialIfNeeded } from "../services/provider_auth"
import {
  AccountQuotaState,
  DashboardSettings,
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderRouteCategory,
  QuotaSnapshot,
  SubscriptionAccount,
} from "../models/types"
import {
  loadDashboardSettings,
  loadEnvelopeFromKeychain,
  loadStoredAccounts,
  loadStoredSnapshots,
  migrateLegacyAccountKeychainKeys,
  removeEnvelopeFromKeychain,
  saveDashboardSettings,
  saveEnvelopeToKeychain,
  saveStoredAccounts,
  saveStoredSnapshots,
  setDashboardKeychainSyncEnabled,
} from "../utils/credential_store"
import {
  createDefaultDemoAccounts,
  generateDemoSnapshot,
} from "../utils/demo_mode"
import {
  recordWidgetRefreshFailure,
  recordWidgetRefreshSuccess,
  requestWidgetReloadAfterStorage,
} from "../services/refresh_service"
import { getProviderMeta } from "../utils/providers_catalog"
import {
  adaptiveProminentButtonStyle,
  routeCategorySymbol,
  routeCategoryTitle,
} from "../utils/theme"
import { AccountDetailSheet } from "./AccountDetailSheet"
import { AccountOrderEditSheet } from "./AccountOrderEditSheet"
import { AccountQuotaRow } from "./AccountQuotaRow"
import { AddAccountSheet } from "./AddAccountSheet"
import { glassCardSurface } from "./GlassCardSurface"
import { providerCardFill } from "./ProviderCardBackground"
import { DashboardOverviewSection } from "./DashboardOverviewSection"
import { ProviderCatalogView } from "./ProviderCatalogView"
import { useReleaseNotesSheet } from "./ReleaseNotesSheet"
import { SettingsView } from "./SettingsView"
import {
  CodexResetStatus,
  fetchCodexResetStatus,
  getSimulatedDemoCodexResetStatus,
} from "../services/codex_reset_feed"

const ROUTE_ORDER: ProviderRouteCategory[] = [
  "direct_api",
  "gateway",
  "device_oauth",
  "google_oauth",
  "web_session",
]

const TAB_ITEMS = [
  { id: 0, title: "额度看板", icon: "chart.bar.doc.horizontal.fill" },
  { id: 1, title: "供应商目录", icon: "square.grid.2x2.fill" },
  { id: 2, title: "设置", icon: "gearshape.fill" },
] as const

type DashboardHomeRoute =
  | { kind: "detail"; account: SubscriptionAccount; zoomSourceID: string }
  | {
      kind: "add"
      provider?: ProviderId
      startWithPicker: boolean
      nonce: number
      zoomSourceID: string
    }
  | { kind: "edit"; zoomSourceID: string }
  | null

function reorderSublistInMasterByItems(
  master: SubscriptionAccount[],
  sublist: SubscriptionAccount[],
  reorderedSublist: SubscriptionAccount[]
): SubscriptionAccount[] {
  const subIdSet = new Set(sublist.map((a) => a.id))
  let subCursor = 0
  return master.map((item) => {
    if (subIdSet.has(item.id)) {
      const replacement = reorderedSublist[subCursor]
      subCursor++
      return replacement ?? item
    }
    return item
  })
}

interface DashboardAccountListSectionProps {
  header: any
  items: SubscriptionAccount[]
  onReorder: (reorderedSublist: SubscriptionAccount[]) => void
  renderRow: (account: SubscriptionAccount) => any
}

function DashboardAccountListSection(props: DashboardAccountListSectionProps) {
  const { header, items, onReorder, renderRow } = props
  const itemsObservable = useObservable<SubscriptionAccount[]>(() => items)
  const skipNextSync = useRef(false)
  const currentItemsRef = useRef(items)
  currentItemsRef.current = items

  useEffect(() => {
    itemsObservable.setValue(items)
  }, [items])

  useEffect(() => {
    const listener = (nextItems: SubscriptionAccount[]) => {
      if (skipNextSync.current) {
        skipNextSync.current = false
        return
      }
      const prev = currentItemsRef.current
      if (
        nextItems.length === prev.length &&
        nextItems.every((item, i) => item.id === prev[i]?.id)
      ) {
        return
      }
      onReorder(nextItems)
    }

    itemsObservable.subscribe(listener)
    return () => {
      itemsObservable.unsubscribe(listener)
    }
  }, [itemsObservable, onReorder])

  const handleMove = (indices: number[], newOffset: number) => {
    skipNextSync.current = true
    const current = [...itemsObservable.value]
    const moving = indices.map((i) => current[i]).filter(Boolean)
    if (moving.length === 0) return
    const rest = current.filter((_, i) => !indices.includes(i))
    const insertAt = Math.max(0, Math.min(rest.length, newOffset))
    rest.splice(insertAt, 0, ...moving)
    itemsObservable.setValue(rest)
    onReorder(rest)
  }

  return (
    <Section header={header}>
      <ForEach
        data={itemsObservable}
        editActions="move"
        onMove={handleMove}
        builder={(acc) => renderRow(acc)}
      />
    </Section>
  )
}

export function DashboardRootView(props: {
  isHomeScreen?: boolean
  zoomNamespace?: any
} = {}) {
  const isHomeScreen = props.isHomeScreen ?? false
  const supportsZoom = Number.parseInt(Device.systemVersion, 10) >= 18
  const homeZoomNamespace =
    isHomeScreen && supportsZoom ? props.zoomNamespace : undefined
  const homeZoomTransition = (sourceID: string) =>
    homeZoomNamespace
      ? { type: "zoom" as const, sourceID, namespace: homeZoomNamespace }
      : undefined
  const homeZoomSource = (sourceID: string) =>
    homeZoomNamespace
      ? { id: sourceID, namespace: homeZoomNamespace }
      : undefined

  const dismiss = Navigation.useDismiss()
  const [homeRoute, setHomeRoute] = useState<DashboardHomeRoute>(null)

  const [activeTab, setActiveTab] = useState<number>(0)
  const [settings, setSettings] = useState<DashboardSettings>(() => {
    const saved = loadDashboardSettings()
    setLocalizationPreference(saved.languagePreference)
    return saved
  })
  const [keychainSyncBusy, setKeychainSyncBusy] = useState(false)
  const [keychainSyncProgress, setKeychainSyncProgress] = useState<{
    completed: number
    total: number
    phase: string
  } | null>(null)
  const [keychainSyncError, setKeychainSyncError] = useState<string | null>(null)
  const keychainSyncBusyRef = useRef(false)
  const [realAccounts, setRealAccounts] = useState<SubscriptionAccount[]>(
    () => {
      const list = loadStoredAccounts()
      migrateLegacyAccountKeychainKeys(list)
      return list
    }
  )
  const [demoAccounts, setDemoAccounts] = useState<SubscriptionAccount[]>(() =>
    createDefaultDemoAccounts()
  )
  const cachedSnapshotsRef = useRef<Record<string, QuotaSnapshot>>(
    loadStoredSnapshots()
  )

  const [accountStates, setAccountStates] = useState<
    Record<string, AccountQuotaState>
  >(() => {
    const initial: Record<string, AccountQuotaState> = {}
    for (const acc of createDefaultDemoAccounts()) {
      initial[acc.id] = {
        type: "loaded",
        snapshot: generateDemoSnapshot(acc.id, acc.provider, acc.region),
      }
    }
    const storedSnaps = loadStoredSnapshots()
    for (const acc of loadStoredAccounts()) {
      const snap = storedSnaps[acc.id]
      if (snap) {
        initial[acc.id] = { type: "loaded", snapshot: snap }
      }
    }
    return initial
  })

  const [searchQuery, setSearchQuery] = useState<string>("")
  const [isRefreshingAll, setIsRefreshingAll] = useState<boolean>(false)

  // 弹窗状态：添加账号 Sheet、账号排序编辑 Sheet 与 账号详情 Sheet
  const [isAddSheetPresented, setIsAddSheetPresented] = useState<boolean>(false)
  const [isEditSheetPresented, setIsEditSheetPresented] = useState<boolean>(false)
  const [accountsBeforeEdit, setAccountsBeforeEdit] = useState<SubscriptionAccount[]>([])
  const [startAddWithPicker, setStartAddWithPicker] = useState<boolean>(true)
  const [preselectedProviderForAdd, setPreselectedProviderForAdd] =
    useState<ProviderId | undefined>(undefined)
  const [addSheetNonce, setAddSheetNonce] = useState<number>(0)
  const [selectedAccountForDetail, setSelectedAccountForDetail] =
    useState<SubscriptionAccount | null>(null)

  // 更新日志弹窗 (Changelog Sheet)
  const releaseNotes = useReleaseNotesSheet()

  // Codex 专用第三方重置状态 (Reset Status / Forecast)
  const [codexResetStatus, setCodexResetStatus] =
    useState<CodexResetStatus | null>(null)

  const openAddAccountFlow = (
    provider?: ProviderId,
    sourceID: string = "dashboard-add-account"
  ) => {
    if (isHomeScreen) {
      setHomeRoute({
        kind: "add",
        provider,
        startWithPicker: !provider,
        nonce: Date.now(),
        zoomSourceID: sourceID,
      })
      return
    }
    setPreselectedProviderForAdd(provider)
    setStartAddWithPicker(!provider)
    setAddSheetNonce((n) => n + 1)
    setIsAddSheetPresented(true)
  }

  const openEditAccountsSheet = (
    sourceID: string = "dashboard-edit-accounts"
  ) => {
    const list = settings.isDemoMode ? demoAccounts : realAccounts
    setAccountsBeforeEdit([...list])
    if (isHomeScreen) {
      setHomeRoute({
        kind: "edit",
        zoomSourceID: sourceID,
      })
      return
    }
    setIsEditSheetPresented(true)
  }

  const openAccountDetail = (
    account: SubscriptionAccount,
    sourceID?: string
  ) => {
    if (isHomeScreen) {
      setHomeRoute({
        kind: "detail",
        account,
        zoomSourceID: sourceID ?? `account-card-${account.id}`,
      })
      return
    }
    setSelectedAccountForDetail(account)
  }

  const renderTabSwitchMenu = () => {
    const currentTab = TAB_ITEMS[activeTab] ?? TAB_ITEMS[0]
    return (
      <Menu
        menuIndicator="hidden"
        label={
          <Image
            systemName={currentTab.icon}
            font="body"
            foregroundStyle="accentColor"
          />
        }
      >
        {TAB_ITEMS.map((item) => (
          <Button
            key={item.id}
            title={localize(item.title)}
            systemImage={item.icon}
            action={() => {
              setActiveTab(item.id)
              HapticFeedback.lightImpact()
            }}
          />
        ))}
      </Menu>
    )
  }

  const cancelEditAccountsSheet = () => {
    if (accountsBeforeEdit.length > 0) {
      if (settings.isDemoMode) {
        setDemoAccounts(accountsBeforeEdit)
      } else {
        setRealAccounts(accountsBeforeEdit)
        saveStoredAccounts(accountsBeforeEdit)
      }
    }
    setIsEditSheetPresented(false)
  }

  const currentAccounts = settings.isDemoMode ? demoAccounts : realAccounts

  useEffect(() => {
    let isCancelled = false
    async function loadCodexReset() {
      const hasCodex = currentAccounts.some((a) => a.provider === "codex")
      if (!hasCodex) {
        if (!isCancelled) setCodexResetStatus(null)
        return
      }
      try {
        const status = await fetchCodexResetStatus()
        if (!isCancelled) {
          if (status) {
            setCodexResetStatus(status)
          } else if (settings.isDemoMode) {
            setCodexResetStatus(getSimulatedDemoCodexResetStatus())
          }
        }
      } catch {
        if (!isCancelled && settings.isDemoMode) {
          setCodexResetStatus(getSimulatedDemoCodexResetStatus())
        }
      }
    }
    void loadCodexReset()
    return () => {
      isCancelled = true
    }
  }, [currentAccounts, settings.isDemoMode])

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return currentAccounts
    return currentAccounts.filter((acc) => {
      const meta = getProviderMeta(acc.provider)
      if (acc.displayName.toLowerCase().includes(q)) return true
      if (meta.displayName.toLowerCase().includes(q) || localize(meta.displayName).toLowerCase().includes(q)) return true
      if (acc.provider.toLowerCase().includes(q)) return true
      return meta.aliases.some((a) => a.toLowerCase().includes(q))
    })
  }, [currentAccounts, searchQuery, settings.languagePreference])

  // 与下方卡片列表完全一致的账号顺序（供柱状图横坐标严格对齐跟随）
  const displayedAccounts = useMemo(() => {
    if (!settings.groupByRouteCategory) {
      return filteredAccounts
    }
    return ROUTE_ORDER.flatMap((category) =>
      filteredAccounts.filter(
        (acc) => getProviderMeta(acc.provider).routeCategory === category
      )
    )
  }, [filteredAccounts, settings.groupByRouteCategory])

  const reloadAllWidgets = () => {
    requestWidgetReloadAfterStorage()
  }

  const updateSettings = (next: DashboardSettings) => {
    if (!saveDashboardSettings(next)) return
    setSettings(next)
    reloadAllWidgets()
  }

  const changeKeychainSync = async (enabled: boolean) => {
    if (keychainSyncBusyRef.current) return
    keychainSyncBusyRef.current = true
    setKeychainSyncBusy(true)
    setKeychainSyncError(null)
    try {
      const result = await setDashboardKeychainSyncEnabled(enabled, (completed, total, phase) => {
        setKeychainSyncProgress({ completed, total, phase })
      })
      setRealAccounts(result.accounts)
      setSettings(result.settings)
      if (result.cleanupFailed > 0) {
        setKeychainSyncError(`${result.cleanupFailed} 条旧本机凭据暂未清理；已验证的 iCloud 凭据可以正常使用`)
      }
      reloadAllWidgets()
    } catch (error) {
      setKeychainSyncError(error instanceof Error ? error.message : "钥匙串同步失败，请重试")
    } finally {
      keychainSyncBusyRef.current = false
      setKeychainSyncBusy(false)
      setKeychainSyncProgress(null)
    }
  }

  const hasReconciledKeychainRef = useRef(false)
  useEffect(() => {
    if (hasReconciledKeychainRef.current || !settings.prefersICloudKeychain) return
    hasReconciledKeychainRef.current = true
    void changeKeychainSync(true)
  }, [])

  const codexRedeemRequestIDs = useRef(new Map<string, string>())

  const refreshSingleAccount = async (
    account: SubscriptionAccount,
    forceRealAccount = false
  ) => {
    if (keychainSyncBusyRef.current) return
    const prevState = accountStates[account.id]
    const prevSnapshot =
      prevState?.type === "loaded"
        ? prevState.snapshot
        : prevState?.type === "loading"
          ? prevState.previous
          : prevState?.type === "failed"
            ? prevState.previous
            : cachedSnapshotsRef.current[account.id]

    setAccountStates((prev) => ({
      ...prev,
      [account.id]: { type: "loading", previous: prevSnapshot },
    }))

    if (settings.isDemoMode && !forceRealAccount) {
      const demoSnap = generateDemoSnapshot(
        account.id,
        account.provider,
        account.region
      )
      setAccountStates((prev) => ({
        ...prev,
        [account.id]: { type: "loaded", snapshot: demoSnap },
      }))
      reloadAllWidgets()
      return
    }

    const envelope = loadEnvelopeFromKeychain(
      account.credentialKeychainKey,
      account.preferssynchronizableKeychain
    )
    if (!envelope) {
      recordWidgetRefreshFailure(account.id, "missingCredential")
      setAccountStates((prev) => ({
        ...prev,
        [account.id]: {
          type: "failed",
          failure: "missingCredential",
          previous: prevSnapshot,
        },
      }))
      return
    }

    try {
      const result = await queryProviderQuota(account, envelope)
      if (result.updatedCredential) {
        saveEnvelopeToKeychain(
          account.credentialKeychainKey,
          result.updatedCredential,
          account.preferssynchronizableKeychain
        )
      }
      cachedSnapshotsRef.current = {
        ...cachedSnapshotsRef.current,
        [account.id]: result.snapshot,
      }
      saveStoredSnapshots(cachedSnapshotsRef.current)
      recordWidgetRefreshSuccess(account.id)
      setAccountStates((prev) => ({
        ...prev,
        [account.id]: { type: "loaded", snapshot: result.snapshot },
      }))
      reloadAllWidgets()
    } catch (err) {
      const code =
        err instanceof QuotaQueryError ? err.code : "network"
      const detail =
        err instanceof QuotaQueryError
          ? err.detail
          : err instanceof Error
            ? err.message
            : undefined
      const isRateLimit = code === "rateLimited"
      recordWidgetRefreshFailure(account.id, code, isRateLimit ? 429 : undefined)
      setAccountStates((prev) => ({
        ...prev,
        [account.id]: {
          type: "failed",
          failure: code,
          detail,
          previous: prevSnapshot,
        },
      }))
    }
  }

  const redeemAccountResetCredit = async (account: SubscriptionAccount, creditID: string) => {
    if (keychainSyncBusyRef.current || loadDashboardSettings().isDemoMode) {
      throw new Error(localize("当前无法使用重置卡，请稍后再试"))
    }
    const current = loadStoredAccounts().find((item) => item.id === account.id && item.provider === "codex")
    if (!current || current.credentialKeychainKey !== account.credentialKeychainKey) {
      throw new Error(localize("账号已变更，请重新打开重置卡明细"))
    }
    const { credentialKeychainKey, preferssynchronizableKeychain } = current
    const envelope = loadEnvelopeFromKeychain(credentialKeychainKey, preferssynchronizableKeychain)
    if (!envelope || envelope.provider !== "codex" || !envelope.accessToken.trim()) {
      throw new QuotaQueryError("missingCredential")
    }
    const refreshed = await refreshCredentialIfNeeded(envelope)
    if (keychainSyncBusyRef.current ||
        loadEnvelopeFromKeychain(credentialKeychainKey, preferssynchronizableKeychain)?.accessToken !== envelope.accessToken) {
      throw new Error(localize("账号已变更，请重新打开重置卡明细"))
    }
    if (refreshed) {
      saveEnvelopeToKeychain(credentialKeychainKey, refreshed, preferssynchronizableKeychain)
    }

    const requestKey = JSON.stringify([account.id, creditID])
    const requestID = codexRedeemRequestIDs.current.get(requestKey) ?? UUID.string()
    codexRedeemRequestIDs.current.set(requestKey, requestID)
    try {
      const outcome = await redeemCodexResetCredit(refreshed ?? envelope, creditID, requestID)
      if (outcome === "nothing_to_reset" || outcome === "no_credit") {
        codexRedeemRequestIDs.current.delete(requestKey)
      }
      return outcome
    } finally {
      void refreshSingleAccount(current, true)
    }
  }

  // 全部账号刷新（支持手动操作与启动时静默无感拉取）
  const refreshAllAccounts = async (options?: { isManual?: boolean }) => {
    if (keychainSyncBusyRef.current) return
    const isManual = options?.isManual ?? false
    if (isRefreshingAll) return
    const enabledList = currentAccounts.filter((a) => a.isEnabled)
    if (enabledList.length === 0) return

    if (isManual) {
      setIsRefreshingAll(true)
    }

    try {
      if (currentAccounts.some((a) => a.provider === "codex")) {
        void fetchCodexResetStatus(true).then((st) => {
          if (st) setCodexResetStatus(st)
        })
      }

      if (settings.isDemoMode) {
        setAccountStates((prev) => {
          const next = { ...prev }
          for (const acc of enabledList) {
            next[acc.id] = {
              type: "loaded",
              snapshot: generateDemoSnapshot(acc.id, acc.provider, acc.region),
            }
          }
          return next
        })
        reloadAllWidgets()
        if (isManual) {
          HapticFeedback.lightImpact()
        }
        return
      }

      // 仅在用户手动触发时设置各卡片为 loading 状态；启动自动刷新保持现有卡片稳定显示，绝不闪烁或重置视图
      if (isManual) {
        setAccountStates((prev) => {
          const next = { ...prev }
          for (const acc of enabledList) {
            const prevState = prev[acc.id]
            const prevSnapshot =
              prevState?.type === "loaded"
                ? prevState.snapshot
                : prevState?.type === "loading"
                  ? prevState.previous
                  : prevState?.type === "failed"
                    ? prevState.previous
                    : cachedSnapshotsRef.current[acc.id]
            next[acc.id] = { type: "loading", previous: prevSnapshot }
          }
          return next
        })
      }

      const updatedSnapshots: Record<string, QuotaSnapshot> = {}
      const stateUpdates: Record<string, AccountQuotaState> = {}

      await Promise.allSettled(
        enabledList.map(async (acc) => {
          const envelope = loadEnvelopeFromKeychain(
            acc.credentialKeychainKey,
            acc.preferssynchronizableKeychain
          )
          const fallbackSnap =
            cachedSnapshotsRef.current[acc.id] ??
            (accountStates[acc.id]?.type === "loaded"
              ? (accountStates[acc.id] as { snapshot: QuotaSnapshot }).snapshot
              : undefined)

          if (!envelope) {
            recordWidgetRefreshFailure(acc.id, "missingCredential")
            stateUpdates[acc.id] = {
              type: "failed",
              failure: "missingCredential",
              previous: fallbackSnap,
            }
            return
          }

          try {
            const result = await queryProviderQuota(acc, envelope)
            if (result.updatedCredential) {
              saveEnvelopeToKeychain(
                acc.credentialKeychainKey,
                result.updatedCredential,
                acc.preferssynchronizableKeychain
              )
            }
            recordWidgetRefreshSuccess(acc.id)
            updatedSnapshots[acc.id] = result.snapshot
            stateUpdates[acc.id] = {
              type: "loaded",
              snapshot: result.snapshot,
            }
          } catch (err) {
            const code =
              err instanceof QuotaQueryError ? err.code : "network"
            const detail =
              err instanceof QuotaQueryError
                ? err.detail
                : err instanceof Error
                  ? err.message
                  : undefined
            const isRateLimit = code === "rateLimited"
            recordWidgetRefreshFailure(acc.id, code, isRateLimit ? 429 : undefined)

            stateUpdates[acc.id] = {
              type: "failed",
              failure: code,
              detail,
              previous: fallbackSnap,
            }
          }
        })
      )

      // 批量单次落盘快照，消除逐个账号写入带来的数十次磁盘 I/O
      if (Object.keys(updatedSnapshots).length > 0) {
        cachedSnapshotsRef.current = {
          ...cachedSnapshotsRef.current,
          ...updatedSnapshots,
        }
        saveStoredSnapshots(cachedSnapshotsRef.current)
      }

      // 批量单次更新账号状态，避免列表反复重渲染引发页面重置与滚动归零
      setAccountStates((prev) => ({
        ...prev,
        ...stateUpdates,
      }))

      reloadAllWidgets()

      if (isManual) {
        HapticFeedback.lightImpact()
      }
    } finally {
      if (isManual) {
        setIsRefreshingAll(false)
      }
    }
  }

  // 脚本运行模式：启动应用时自动刷新已启用账号（受用户设置控制，默认开启，显示加载状态）
  const hasScriptAutoRefreshedRef = useRef<boolean>(false)
  useEffect(() => {
    if (isHomeScreen) return
    if (keychainSyncBusyRef.current) return
    if (settings.autoRefreshOnLaunch && !hasScriptAutoRefreshedRef.current) {
      hasScriptAutoRefreshedRef.current = true
      void refreshAllAccounts({ isManual: true })
    }
  }, [isHomeScreen, settings.autoRefreshOnLaunch, settings.isDemoMode, keychainSyncBusy])

  // 首页 UI 模式：常驻启动首次挂载时无条件自动刷新已添加供应商（后台静默拉取）
  const hasHomeAutoRefreshedRef = useRef<boolean>(false)
  useEffect(() => {
    if (!isHomeScreen) return
    if (keychainSyncBusyRef.current) return
    if (!hasHomeAutoRefreshedRef.current) {
      hasHomeAutoRefreshedRef.current = true
      void refreshAllAccounts({ isManual: false })
    }
  }, [isHomeScreen, settings.isDemoMode, keychainSyncBusy])

  // 首页 UI 模式：监听从其他系统 Tab 切回 Home Tab 事件，自动静默刷新一次额度
  useEffect(() => {
    if (!isHomeScreen) return
    if (typeof Script === "undefined" || typeof Script.onHomeTabEvent !== "function") return

    const unsubscribe = Script.onHomeTabEvent((event) => {
      if (event === "selected") {
        void refreshAllAccounts({ isManual: false })
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [isHomeScreen])

  // 应用退入后台时（用户滑回桌面），立即同步刷新一次桌面小组件
  useEffect(() => {
    if (typeof AppEvents === "undefined" || !AppEvents.scenePhase) return
    const onScenePhase = (phase: string) => {
      if (phase === "background" || phase === "inactive") {
        requestWidgetReloadAfterStorage(200)
      }
    }
    AppEvents.scenePhase.addListener(onScenePhase)
    return () => {
      AppEvents.scenePhase.removeListener(onScenePhase)
    }
  }, [])

  const handleDeleteAccount = (accountId: string) => {
    if (settings.isDemoMode) {
      setDemoAccounts((prev) => prev.filter((a) => a.id !== accountId))
      HapticFeedback.lightImpact()
      reloadAllWidgets()
      return
    }
    const target = realAccounts.find((a) => a.id === accountId)
    if (target) {
      removeEnvelopeFromKeychain(
        target.credentialKeychainKey,
        target.preferssynchronizableKeychain
      )
    }
    const nextAccounts = realAccounts.filter((a) => a.id !== accountId)
    setRealAccounts(nextAccounts)
    saveStoredAccounts(nextAccounts)
    const copy = { ...cachedSnapshotsRef.current }
    delete copy[accountId]
    cachedSnapshotsRef.current = copy
    saveStoredSnapshots(copy)
    HapticFeedback.lightImpact()
    reloadAllWidgets()
  }

  const handleSublistReordered = (
    sublist: SubscriptionAccount[],
    reorderedSublist: SubscriptionAccount[]
  ) => {
    if (settings.isDemoMode) {
      setDemoAccounts((prev) =>
        reorderSublistInMasterByItems(prev, sublist, reorderedSublist)
      )
      HapticFeedback.lightImpact()
      return
    }
    const next = reorderSublistInMasterByItems(
      realAccounts,
      sublist,
      reorderedSublist
    )
    setRealAccounts(next)
    saveStoredAccounts(next)
    HapticFeedback.lightImpact()
    reloadAllWidgets()
  }

  const handleMoveAccountsInEdit = (indices: number[], newOffset: number) => {
    if (settings.isDemoMode) {
      setDemoAccounts((prev) => {
        const next = [...prev]
        const moving = indices.map((i) => next[i]).filter(Boolean)
        const rest = next.filter((_, i) => !indices.includes(i))
        const insertAt = Math.max(0, Math.min(rest.length, newOffset))
        rest.splice(insertAt, 0, ...moving)
        return rest
      })
      HapticFeedback.lightImpact()
      reloadAllWidgets()
      return
    }
    const next = [...realAccounts]
    const moving = indices.map((i) => next[i]).filter(Boolean)
    const rest = next.filter((_, i) => !indices.includes(i))
    const insertAt = Math.max(0, Math.min(rest.length, newOffset))
    rest.splice(insertAt, 0, ...moving)
    setRealAccounts(next)
    saveStoredAccounts(next)
    HapticFeedback.lightImpact()
    reloadAllWidgets()
  }

  const handleAccountCreated = (
    newAccount: SubscriptionAccount,
    _envelope: ProviderCredentialEnvelope
  ) => {
    setIsAddSheetPresented(false)
    setHomeRoute(null)
    if (settings.isDemoMode) {
      // 如果用户在演示模式保存了真实账号，自动切换到真实模式并立即刷新该账号
      updateSettings({ ...settings, isDemoMode: false })
    }
    const nextAccounts = [newAccount, ...realAccounts]
    setRealAccounts(nextAccounts)
    saveStoredAccounts(nextAccounts)
    void refreshSingleAccount(newAccount, true)
  }

  const handleQuickAddFromCatalog = (provider: ProviderId) => {
    if (settings.isDemoMode) {
      const meta = getProviderMeta(provider)
      const id = `demo-${provider}-${Date.now()}`
      const defaultRegion = meta.requiresRegion
        ? meta.regions?.[0]?.id ?? "cn"
        : undefined
      const newDemo: SubscriptionAccount = {
        id,
        provider,
        displayName: meta.displayName,
        credentialKeychainKey: `demo.credential.${id}`,
        createdAt: new Date().toISOString(),
        isEnabled: true,
        preferssynchronizableKeychain: false,
        region: defaultRegion,
      }
      setDemoAccounts((prev) => [newDemo, ...prev])
      setAccountStates((prev) => ({
        ...prev,
        [id]: {
          type: "loaded",
          snapshot: generateDemoSnapshot(id, provider, defaultRegion),
        },
      }))
      HapticFeedback.notificationSuccess()
      setActiveTab(0)
      return
    }
    if (isHomeScreen) {
      setHomeRoute({
        kind: "add",
        provider,
        startWithPicker: false,
        nonce: Date.now(),
        zoomSourceID: `catalog-add-${provider}`,
      })
      setActiveTab(0)
      return
    }
    openAddAccountFlow(provider, `catalog-add-${provider}`)
  }

  const renderAccountRowWithSwipe = (acc: SubscriptionAccount) => {
    const state: AccountQuotaState = accountStates[acc.id] ?? { type: "idle" }
    return (
      <VStack
        key={acc.id}
        alignment="leading"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        listRowInsets={0}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
        contentShape={{
          kind: "dragPreview",
          shape: { type: "rect", cornerRadius: 16, style: "continuous" },
        }}
        trailingSwipeActions={{
          allowsFullSwipe: true,
          actions: [
            <Button
              title={localize("删除")}
              systemImage="trash"
              role="destructive"
              tint="red"
              action={() => handleDeleteAccount(acc.id)}
            />,
            <Button
              title={localize("设置")}
              systemImage="slider.horizontal.3"
              tint="systemBlue"
              action={() => openAccountDetail(acc, `account-card-${acc.id}`)}
            />,
            <Button
              title={localize("刷新")}
              systemImage="arrow.clockwise"
              tint="systemTeal"
              action={() => refreshSingleAccount(acc)}
            />,
          ],
        }}
      >
        <VStack
          alignment="leading"
          padding={{ horizontal: 16, vertical: 10 }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          {...glassCardSurface(providerCardFill(acc.provider), 16)}
        >
          <AccountQuotaRow
            account={acc}
            state={state}
            protectAccountIdentity={settings.protectAccountIdentity}
            codexResetStatus={codexResetStatus}
            zoomSource={homeZoomSource(`account-card-${acc.id}`)}
            onRefresh={() => refreshSingleAccount(acc)}
            onOpenDetail={() => openAccountDetail(acc, `account-card-${acc.id}`)}
            onRedeemCodexResetCard={acc.provider === "codex" && !settings.isDemoMode
              ? (creditID) => redeemAccountResetCredit(acc, creditID)
              : undefined}
          />
        </VStack>
      </VStack>
    )
  }

  const renderHomeRouteContent = () => {
    if (!homeRoute) return <Text> </Text>
    if (homeRoute.kind === "detail") {
      const acc = homeRoute.account
      return (
        <AccountDetailSheet
          key={acc.id}
          account={acc}
          state={accountStates[acc.id] ?? { type: "idle" }}
          isDemoMode={settings.isDemoMode}
          codexResetStatus={codexResetStatus}
          embedded={true}
          zoomNamespace={homeZoomNamespace}
          navigationTransition={homeZoomTransition(homeRoute.zoomSourceID)}
          onClose={() => setHomeRoute(null)}
          onUpdateAccount={(updated) => {
            if (settings.isDemoMode) {
              setDemoAccounts((prev) =>
                prev.map((a) => (a.id === updated.id ? updated : a))
              )
            } else {
              const next = realAccounts.map((a) =>
                a.id === updated.id ? updated : a
              )
              if (!saveStoredAccounts(next)) throw new Error("账号信息保存失败，原登录凭据已保留")
              setRealAccounts(next)
              refreshSingleAccount(updated)
            }
          }}
          onDeleteAccount={handleDeleteAccount}
          onRefreshAccount={refreshSingleAccount}
        />
      )
    }
    if (homeRoute.kind === "add") {
      return (
        <AddAccountSheet
          key={homeRoute.nonce}
          initialProviderId={homeRoute.provider}
          defaultSynchronizable={settings.prefersICloudKeychain}
          startWithPicker={homeRoute.startWithPicker}
          embedded={true}
          zoomNamespace={homeZoomNamespace}
          navigationTransition={homeZoomTransition(homeRoute.zoomSourceID)}
          onCancel={() => setHomeRoute(null)}
          onAccountCreated={handleAccountCreated}
        />
      )
    }
    if (homeRoute.kind === "edit") {
      return (
        <AccountOrderEditSheet
          accounts={currentAccounts}
          embedded={true}
          navigationTransition={homeZoomTransition(homeRoute.zoomSourceID)}
          onReorderAccounts={(reordered) => {
            if (settings.isDemoMode) {
              setDemoAccounts(reordered)
            } else {
              setRealAccounts(reordered)
              saveStoredAccounts(reordered)
            }
            HapticFeedback.lightImpact()
            reloadAllWidgets()
          }}
          onMoveAccounts={handleMoveAccountsInEdit}
          onDeleteAccount={handleDeleteAccount}
          onDismiss={() => setHomeRoute(null)}
          onCancel={() => {
            cancelEditAccountsSheet()
            setHomeRoute(null)
          }}
        />
      )
    }
    return <Text> </Text>
  }

  const dashboardList = (
    <List
      navigationTitle={localize("AI 额度看板")}
      tint="systemIndigo"
      listStyle="insetGroup"
      listRowSpacing={10}
      listRowSeparator="hidden"
      searchable={{
        value: searchQuery,
        onChanged: setSearchQuery,
        prompt: localize("筛选账号名称或 AI 供应商"),
      }}
      refreshable={() => refreshAllAccounts({ isManual: true })}
      toolbar={{
        topBarLeading: (
          <HStack spacing={12}>
            {isHomeScreen ? (
              renderTabSwitchMenu()
            ) : (
              <Button
                title={localize("退出")}
                systemImage="xmark"
                action={() => dismiss()}
              />
            )}
            <Button
              title={localize("编辑")}
              systemImage="pencil"
              matchedTransitionSource={homeZoomSource("dashboard-edit-accounts")}
              action={() => openEditAccountsSheet("dashboard-edit-accounts")}
            />
          </HStack>
        ),
        topBarTrailing: (
          <HStack spacing={12}>
            <Button
              title={localize("全部刷新")}
              systemImage="arrow.clockwise"
              disabled={isRefreshingAll || currentAccounts.length === 0}
              action={() => refreshAllAccounts({ isManual: true })}
            />
            <Button
              title={localize("添加账号")}
              systemImage="plus"
              matchedTransitionSource={homeZoomSource("dashboard-add-account")}
              action={() => openAddAccountFlow(undefined, "dashboard-add-account")}
            />
          </HStack>
        ),
      }}
      sheet={
        isHomeScreen
          ? {
              isPresented: releaseNotes.isPresented,
              onChanged: releaseNotes.onChanged,
              content: releaseNotes.content,
            }
          : [
              {
                isPresented: isEditSheetPresented,
                onChanged: setIsEditSheetPresented,
                content: (
                  <AccountOrderEditSheet
                    accounts={currentAccounts}
                    onReorderAccounts={(reordered) => {
                      if (settings.isDemoMode) {
                        setDemoAccounts(reordered)
                      } else {
                        setRealAccounts(reordered)
                        saveStoredAccounts(reordered)
                      }
                      HapticFeedback.lightImpact()
                      reloadAllWidgets()
                    }}
                    onMoveAccounts={handleMoveAccountsInEdit}
                    onDeleteAccount={handleDeleteAccount}
                    onDismiss={() => setIsEditSheetPresented(false)}
                    onCancel={cancelEditAccountsSheet}
                  />
                ),
              },
              {
                isPresented: selectedAccountForDetail !== null,
                onChanged: (open) => {
                  if (!open) setSelectedAccountForDetail(null)
                },
                content: selectedAccountForDetail ? (
                  <AccountDetailSheet
                    key={selectedAccountForDetail.id}
                    account={selectedAccountForDetail}
                    state={
                      accountStates[selectedAccountForDetail.id] ?? {
                        type: "idle",
                      }
                    }
                    isDemoMode={settings.isDemoMode}
                    codexResetStatus={codexResetStatus}
                    onClose={() => setSelectedAccountForDetail(null)}
                    onUpdateAccount={(updated) => {
                      if (settings.isDemoMode) {
                        setDemoAccounts((prev) =>
                          prev.map((a) => (a.id === updated.id ? updated : a))
                        )
                      } else {
                        const next = realAccounts.map((a) =>
                          a.id === updated.id ? updated : a
                        )
                        if (!saveStoredAccounts(next)) throw new Error("账号信息保存失败，原登录凭据已保留")
                        setRealAccounts(next)
                        refreshSingleAccount(updated)
                      }
                    }}
                    onDeleteAccount={handleDeleteAccount}
                    onRefreshAccount={refreshSingleAccount}
                  />
                ) : (
                  <Text>{localize("未选择账号")}</Text>
                ),
              },
            ]
      }
      navigationDestination={
        isHomeScreen
          ? {
              isPresented: Boolean(homeRoute),
              onChanged: (open) => {
                if (!open) {
                  if (homeRoute?.kind === "edit") {
                    cancelEditAccountsSheet()
                  }
                  setHomeRoute(null)
                }
              },
              content: renderHomeRouteContent(),
            }
          : undefined
      }
    >
      <DashboardOverviewSection
        accounts={displayedAccounts}
        accountStates={accountStates}
        isDemoMode={settings.isDemoMode}
        protectAccountIdentity={settings.protectAccountIdentity}
        zoomNamespace={homeZoomNamespace}
        onSelectAccount={(acc) => openAccountDetail(acc, `overview-account-${acc.id}`)}
        onOpenEditSheet={() => openEditAccountsSheet("overview-edit-accounts")}
      />

      {filteredAccounts.length === 0 ? (
        <Section>
          <VStack
            alignment="center"
            spacing={12}
            listRowSeparator="hidden"
            frame={{ maxWidth: "infinity", alignment: "center" }}
          >
            <ContentUnavailableView
              title={
                localize(searchQuery.trim()
                  ? "没有匹配的供应商账号"
                  : "尚未添加 AI 供应商账号")
              }
              systemImage="sparkles.rectangle.stack"
              description={
                localize(searchQuery.trim()
                  ? "请尝试更换搜索关键词，或在「供应商目录」中添加新平台"
                  : "支持 DeepSeek、OpenAI Codex、Claude、Anthropic、WorkBuddy、火山方舟、MiniMax、New API 等 78 家 AI 平台")
              }
            />
            <Button
              buttonStyle={adaptiveProminentButtonStyle()}
              frame={{ maxWidth: "infinity", alignment: "center" }}
              matchedTransitionSource={homeZoomSource("dashboard-empty-add-account")}
              action={() => openAddAccountFlow(undefined, "dashboard-empty-add-account")}
            >
              <HStack
                frame={{ maxWidth: "infinity", alignment: "center" }}
                alignment="center"
                spacing={6}
                padding={{ vertical: 4 }}
              >
                <Image systemName="plus.circle.fill" font="subheadline" />
                <Text
                  font="subheadline"
                  fontWeight="semibold"
                  lineLimit={getDashboardLanguage() === "en" ? undefined : 1}
                  multilineTextAlignment="center"
                >
                  {localize("添加第一个 AI 供应商账号")}</Text>
              </HStack>
            </Button>
          </VStack>
        </Section>
      ) : settings.groupByRouteCategory ? (
        ROUTE_ORDER.map((category) => {
          const groupItems = filteredAccounts.filter(
            (acc) =>
              getProviderMeta(acc.provider).routeCategory === category
          )
          if (groupItems.length === 0) return null
          return (
            <DashboardAccountListSection
              key={category}
              header={
                <HStack spacing={6}>
                  <Image
                    systemName={routeCategorySymbol(category)}
                    font="caption"
                    foregroundStyle="accentColor"
                  />
                  <Text>{localize(`${routeCategoryTitle(category)} (${groupItems.length})`)}</Text>
                  <Spacer />
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {localize("长按拖动排序")}</Text>
                </HStack>
              }
              items={groupItems}
              onReorder={(reorderedSublist) =>
                handleSublistReordered(groupItems, reorderedSublist)
              }
              renderRow={renderAccountRowWithSwipe}
            />
          )
        })
      ) : (
        <DashboardAccountListSection
          header={
            <HStack spacing={6}>
              <Image
                systemName="wallet.bifold"
                font="caption"
                foregroundStyle="accentColor"
              />
              <Text>{localize("订阅额度与 API 钱包")}</Text>
              <Spacer />
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {localize("长按卡片拖动排序")}</Text>
            </HStack>
          }
          items={filteredAccounts}
          onReorder={(reorderedSublist) =>
            handleSublistReordered(filteredAccounts, reorderedSublist)
          }
          renderRow={renderAccountRowWithSwipe}
        />
      )}
    </List>
  )

  if (isHomeScreen) {
    if (activeTab === 0) {
      return dashboardList
    }
    if (activeTab === 1) {
      return (
        <ProviderCatalogView
          isDemoMode={settings.isDemoMode}
          configuredAccounts={currentAccounts}
          defaultSynchronizable={settings.prefersICloudKeychain}
          isHomeScreen={true}
          zoomNamespace={homeZoomNamespace}
          tabSwitchMenu={renderTabSwitchMenu()}
          onQuickAddAccount={handleQuickAddFromCatalog}
          onAccountCreated={handleAccountCreated}
          onDismiss={() => {}}
        />
      )
    }
    return (
      <SettingsView
        settings={settings}
        realAccountCount={realAccounts.length}
        demoAccountCount={demoAccounts.length}
        isHomeScreen={true}
        zoomNamespace={homeZoomNamespace}
        tabSwitchMenu={renderTabSwitchMenu()}
        changelogContent={releaseNotes.rawContent}
        onUpdateSettings={updateSettings}
        keychainSyncBusy={keychainSyncBusy}
        keychainSyncProgress={keychainSyncProgress}
        keychainSyncError={keychainSyncError}
        onSetKeychainSync={changeKeychainSync}
        onResetDemoAccounts={() => {
          const defaults = createDefaultDemoAccounts()
          setDemoAccounts(defaults)
          setAccountStates((prev) => {
            const next = { ...prev }
            for (const acc of defaults) {
              next[acc.id] = {
                type: "loaded",
                snapshot: generateDemoSnapshot(
                  acc.id,
                  acc.provider,
                  acc.region
                ),
              }
            }
            return next
          })
          HapticFeedback.notificationSuccess()
        }}
        onClearSnapshotCache={() => {
          cachedSnapshotsRef.current = {}
          saveStoredSnapshots({})
          setAccountStates({})
        }}
        onDismiss={() => {}}
      />
    )
  }

  return (
    <TabView
      tabIndex={activeTab}
      onTabIndexChanged={setActiveTab}
      tint="systemIndigo"
      sheet={[
        {
          isPresented: isAddSheetPresented,
          onChanged: setIsAddSheetPresented,
          content: (
            <AddAccountSheet
              key={`add-sheet-${addSheetNonce}`}
              initialProviderId={preselectedProviderForAdd}
              defaultSynchronizable={settings.prefersICloudKeychain}
              startWithPicker={startAddWithPicker}
              onCancel={() => setIsAddSheetPresented(false)}
              onAccountCreated={handleAccountCreated}
            />
          ),
        },
        {
          isPresented: releaseNotes.isPresented,
          onChanged: releaseNotes.onChanged,
          content: releaseNotes.content,
        },
      ]}
    >
      <Tab title={localize("额度看板")} systemImage="chart.bar.doc.horizontal.fill" value={0}>
        <NavigationStack>
          {dashboardList}
        </NavigationStack>
      </Tab>

      <Tab title={localize("供应商目录")} systemImage="square.grid.2x2.fill" value={1}>
        <ProviderCatalogView
          isDemoMode={settings.isDemoMode}
          configuredAccounts={currentAccounts}
          defaultSynchronizable={settings.prefersICloudKeychain}
          onQuickAddAccount={handleQuickAddFromCatalog}
          onDismiss={() => dismiss()}
        />
      </Tab>

      <Tab title={localize("设置")} systemImage="gearshape.fill" value={2}>
        <SettingsView
          settings={settings}
          realAccountCount={realAccounts.length}
          demoAccountCount={demoAccounts.length}
          onUpdateSettings={updateSettings}
          keychainSyncBusy={keychainSyncBusy}
          keychainSyncProgress={keychainSyncProgress}
          keychainSyncError={keychainSyncError}
          onSetKeychainSync={changeKeychainSync}
          onResetDemoAccounts={() => {
            const defaults = createDefaultDemoAccounts()
            setDemoAccounts(defaults)
            setAccountStates((prev) => {
              const next = { ...prev }
              for (const acc of defaults) {
                next[acc.id] = {
                  type: "loaded",
                  snapshot: generateDemoSnapshot(
                    acc.id,
                    acc.provider,
                    acc.region
                  ),
                }
              }
              return next
            })
            HapticFeedback.notificationSuccess()
          }}
          onClearSnapshotCache={() => {
            cachedSnapshotsRef.current = {}
            saveStoredSnapshots({})
            setAccountStates({})
          }}
          onOpenChangelog={releaseNotes.show}
          onDismiss={() => dismiss()}
        />
      </Tab>
    </TabView>
  )
}
