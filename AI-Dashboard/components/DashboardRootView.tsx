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
import { createDashboardRefreshLimiter, runDashboardRefreshQueue } from "../services/dashboard_refresh_queue"
import {
  AccountQuotaState,
  DashboardSettings,
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderRouteCategory,
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
import { CodexResetCardsSheet } from "./CodexResetCardsBadge"
import type { CodexResetCards } from "../utils/codex_reset_cards"
import { AddAccountSheet } from "./AddAccountSheet"
import { glassCardSurface } from "./GlassCardSurface"
import { providerCardFill } from "./ProviderCardBackground"
import { DashboardAnimationContext } from "../utils/dashboard_metric_animation"
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

type AccountRefresh = {
  account: SubscriptionAccount
  pending: boolean
  result: Promise<AccountQuotaState | undefined>
}

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

  const [{ tab: activeTab, dashboardVisit, homeTabVisible }, setTabSelection] = useState({
    tab: 0,
    dashboardVisit: 0,
    homeTabVisible: true,
  })
  const setActiveTab = (tab: number) => setTabSelection((previous) => previous.tab === tab ? previous : {
    ...previous,
    tab,
    dashboardVisit: previous.dashboardVisit + (tab === 0 ? 1 : 0),
  })
  const dashboardActive = activeTab === 0 && homeTabVisible
  const [settings, setSettingsState] = useState<DashboardSettings>(() => {
    const saved = loadDashboardSettings()
    setLocalizationPreference(saved.languagePreference)
    return saved
  })
  const dashboardAnimation = useMemo(() => ({
    active: dashboardActive,
    visit: dashboardVisit,
    enabled: settings.dashboardAnimationsEnabled,
  }), [dashboardActive, dashboardVisit, settings.dashboardAnimationsEnabled])
  const settingsRef = useRef(settings)
  const setSettings = (next: DashboardSettings) => {
    settingsRef.current = next
    setSettingsState(next)
  }
  const [keychainSyncBusy, setKeychainSyncBusy] = useState(false)
  const [keychainSyncProgress, setKeychainSyncProgress] = useState<{
    completed: number
    total: number
    phase: string
  } | null>(null)
  const [keychainSyncError, setKeychainSyncError] = useState<string | null>(null)
  const keychainSyncBusyRef = useRef(false)
  const [realAccounts, setRealAccountsState] = useState<SubscriptionAccount[]>(
    () => {
      const list = loadStoredAccounts()
      migrateLegacyAccountKeychainKeys(list)
      return list
    }
  )
  const [demoAccounts, setDemoAccounts] = useState<SubscriptionAccount[]>(() =>
    createDefaultDemoAccounts()
  )
  const demoAccountsRef = useRef(demoAccounts)
  demoAccountsRef.current = demoAccounts
  const [latestRealAccounts] = useState(() => new Map(realAccounts.map((account) => [account.id, account])))
  const setRealAccounts = (accounts: SubscriptionAccount[]) => {
    latestRealAccounts.clear()
    for (const account of accounts) latestRealAccounts.set(account.id, account)
    setRealAccountsState(accounts)
  }
  const saveRealAccountOrder = (ordered: SubscriptionAccount[]) => {
    // Native list moves can hand back copies. Preserve the current account records during a reorder.
    const next = ordered.map((account) => latestRealAccounts.get(account.id) ?? account)
    setRealAccounts(next)
    saveStoredAccounts(next)
  }
  const [cachedSnapshotsRef] = useState(() => ({ current: loadStoredSnapshots() }))
  const [accountRefreshes] = useState(() => new Map<string, AccountRefresh>())
  const [withRefreshSlot] = useState(createDashboardRefreshLimiter)
  const allAccountsRefresh = useRef<{ task: Promise<void>; isManual: boolean } | undefined>(undefined)

  const [accountStates, setAccountStates] = useState<
    Record<string, AccountQuotaState>
  >(() => {
    const initial: Record<string, AccountQuotaState> = {}
    for (const acc of demoAccounts) {
      initial[acc.id] = {
        type: "loaded",
        snapshot: generateDemoSnapshot(acc.id, acc.provider, acc.region),
      }
    }
    for (const acc of realAccounts) {
      const snap = cachedSnapshotsRef.current[acc.id]
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
  const accountsBeforeEdit = useRef<string[] | null>(null)
  const [startAddWithPicker, setStartAddWithPicker] = useState<boolean>(true)
  const [preselectedProviderForAdd, setPreselectedProviderForAdd] =
    useState<ProviderId | undefined>(undefined)
  const [addSheetNonce, setAddSheetNonce] = useState<number>(0)
  const [selectedAccountForDetail, setSelectedAccountForDetail] =
    useState<SubscriptionAccount | null>(null)
  const [selectedResetCards, setSelectedResetCards] = useState<{
    account: SubscriptionAccount
    cards: CodexResetCards
  } | null>(null)

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
    accountsBeforeEdit.current = list.map((account) => account.id)
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

  const finishEditAccountsSheet = () => {
    accountsBeforeEdit.current = null
    if (isHomeScreen) {
      setHomeRoute(null)
    } else {
      setIsEditSheetPresented(false)
    }
  }

  const cancelEditAccountsSheet = () => {
    const originalIds = accountsBeforeEdit.current
    if (originalIds) {
      const current = settings.isDemoMode ? demoAccountsRef.current : [...latestRealAccounts.values()]
      const currentById = new Map(current.map((account) => [account.id, account]))
      // Cancel restores the order of surviving accounts. Deletions have already removed their credentials.
      const originalOrder = originalIds.flatMap((id) => {
        const account = currentById.get(id)
        return account ? [account] : []
      })
      const restored = reorderSublistInMasterByItems(current, originalOrder, originalOrder)
      if (restored.some((account, i) => account.id !== current[i].id)) {
        if (settings.isDemoMode) {
          setDemoAccounts(restored)
        } else {
          saveRealAccountOrder(restored)
        }
        reloadAllWidgets()
      }
    }
    finishEditAccountsSheet()
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
      // Let queries finish saving any rotated credentials before moving them between stores.
      await Promise.allSettled([
        allAccountsRefresh.current?.task,
        ...Array.from(accountRefreshes.values(), (refresh) => refresh.result),
      ])
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

  const previousSnapshot = (id: string, state?: AccountQuotaState) => (
    state?.type === "loaded" ? state.snapshot
      : state?.type === "loading" || state?.type === "failed" ? state.previous
      : cachedSnapshotsRef.current[id]
  )

  const fetchAccountState = async (account: SubscriptionAccount): Promise<AccountQuotaState | undefined> => {
    const isCurrent = () => latestRealAccounts.get(account.id) === account
    if (!isCurrent()) return
    const previous = cachedSnapshotsRef.current[account.id]
    try {
      const envelope = loadEnvelopeFromKeychain(
        account.credentialKeychainKey,
        account.preferssynchronizableKeychain
      )
      if (!envelope) {
        recordWidgetRefreshFailure(account.id, "missingCredential")
        return { type: "failed", failure: "missingCredential", previous }
      }
      const result = await queryProviderQuota(account, envelope)
      if (!isCurrent()) return
      if (result.updatedCredential) {
        saveEnvelopeToKeychain(
          account.credentialKeychainKey,
          result.updatedCredential,
          account.preferssynchronizableKeychain
        )
      }
      cachedSnapshotsRef.current[account.id] = result.snapshot
      recordWidgetRefreshSuccess(account.id)
      return { type: "loaded", snapshot: result.snapshot }
    } catch (error) {
      if (!isCurrent()) return
      const failure = error instanceof QuotaQueryError ? error.code : "network"
      const detail = error instanceof QuotaQueryError ? error.detail : error instanceof Error ? error.message : undefined
      recordWidgetRefreshFailure(account.id, failure, failure === "rateLimited" ? 429 : undefined)
      return { type: "failed", failure, detail, previous }
    }
  }

  const startAccountRefresh = (account: SubscriptionAccount, afterPending = false): AccountRefresh => {
    const existing = accountRefreshes.get(account.id)
    if (existing?.pending && !afterPending && existing.account === account) return existing
    const result = (existing?.pending ? existing.result : Promise.resolve())
      .then(() => withRefreshSlot(() => fetchAccountState(account)))
      .finally(() => { refresh.pending = false })
    const refresh = { account, pending: true, result }
    accountRefreshes.set(account.id, refresh)
    return refresh
  }

  const canPublishRefresh = (refresh: AccountRefresh) => (
    accountRefreshes.get(refresh.account.id) === refresh && latestRealAccounts.get(refresh.account.id) === refresh.account
  )

  const refreshSingleAccount = async (account: SubscriptionAccount, forceRealAccount = false) => {
    if (keychainSyncBusyRef.current) return
    if (settingsRef.current.isDemoMode && !forceRealAccount) {
      const snapshot = generateDemoSnapshot(account.id, account.provider, account.region)
      setAccountStates((prev) => ({ ...prev, [account.id]: { type: "loaded", snapshot } }))
      reloadAllWidgets()
      return
    }

    const current = latestRealAccounts.get(account.id)
    if (!current) return
    setAccountStates((prev) => ({
      ...prev,
      [current.id]: { type: "loading", previous: previousSnapshot(current.id, prev[current.id]) },
    }))
    const refresh = startAccountRefresh(current, forceRealAccount)
    const state = await refresh.result
    if (!state || !canPublishRefresh(refresh)) return
    setAccountStates((prev) => ({ ...prev, [current.id]: state }))
    if (state.type === "loaded") {
      saveStoredSnapshots(cachedSnapshotsRef.current)
      reloadAllWidgets()
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

  const refreshAllAccounts = (options?: { isManual?: boolean }): Promise<void> => {
    if (keychainSyncBusyRef.current) return Promise.resolve()
    const isManual = options?.isManual ?? false
    const pending = allAccountsRefresh.current
    if (pending) {
      if (isManual && !pending.isManual) {
        pending.isManual = true
        setIsRefreshingAll(true)
      }
      return pending.task
    }
    const isDemoMode = settingsRef.current.isDemoMode
    const accounts = isDemoMode ? demoAccountsRef.current : [...latestRealAccounts.values()]
    const enabledAccounts = accounts.filter((account) => account.isEnabled)
    if (enabledAccounts.length === 0) return Promise.resolve()
    if (isManual) setIsRefreshingAll(true)

    const performRefresh = async () => {
      if (accounts.some((account) => account.provider === "codex")) {
        void fetchCodexResetStatus(true).then((status) => {
          if (status) setCodexResetStatus(status)
        })
      }
      if (isDemoMode) {
        setAccountStates((prev) => {
          const next = { ...prev }
          for (const account of enabledAccounts) {
            next[account.id] = {
              type: "loaded",
              snapshot: generateDemoSnapshot(account.id, account.provider, account.region),
            }
          }
          return next
        })
      } else {
        // Keep cached values visible during both manual and automatic refreshes.
        if (isManual) {
          setAccountStates((prev) => {
            const next = { ...prev }
            for (const { id } of enabledAccounts) {
              next[id] = { type: "loading", previous: previousSnapshot(id, prev[id]) }
            }
            return next
          })
        }
        const earlierRefreshes = new Map(accountRefreshes)
        let hasNewSnapshots = false
        await runDashboardRefreshQueue(enabledAccounts, async (account) => {
          if (latestRealAccounts.get(account.id) !== account) return
          // An individual refresh may have already finished while this account was waiting in line.
          const latest = accountRefreshes.get(account.id)
          const refresh = latest?.account === account && latest !== earlierRefreshes.get(account.id)
            ? latest
            : startAccountRefresh(account)
          const state = await refresh.result
          if (!state) return
          if (state.type === "loaded") hasNewSnapshots = true
          return { refresh, state }
        }, (results) => {
          setAccountStates((prev) => {
            let next = prev
            for (const { refresh, state } of results) {
              if (!canPublishRefresh(refresh) || prev[refresh.account.id] === state) continue
              if (next === prev) next = { ...prev }
              next[refresh.account.id] = state
            }
            return next
          })
        })
        if (hasNewSnapshots) saveStoredSnapshots(cachedSnapshotsRef.current)
      }
      reloadAllWidgets()
      if (refresh.isManual) HapticFeedback.lightImpact()
    }

    const task = Promise.resolve().then(performRefresh).finally(() => {
      allAccountsRefresh.current = undefined
      if (refresh.isManual) setIsRefreshingAll(false)
    })
    const refresh = { task, isManual }
    allAccountsRefresh.current = refresh
    return task
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

  // 首页 UI 常驻。用宿主 Tab 事件暂停或重播动画，并在切回时静默刷新。
  useEffect(() => {
    if (!isHomeScreen) return
    if (typeof Script === "undefined" || typeof Script.onHomeTabEvent !== "function") return

    const unsubscribe = Script.onHomeTabEvent((event) => {
      if (event === "reselected") return
      const visible = event === "selected"
      setTabSelection((previous) => ({
        ...previous,
        homeTabVisible: visible,
        dashboardVisit: previous.dashboardVisit + (visible && previous.tab === 0 ? 1 : 0),
      }))
      if (visible) void refreshAllAccounts({ isManual: false })
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
    const target = latestRealAccounts.get(accountId) ?? realAccounts.find((a) => a.id === accountId)
    if (target) {
      removeEnvelopeFromKeychain(
        target.credentialKeychainKey,
        target.preferssynchronizableKeychain
      )
    }
    const nextAccounts = [...latestRealAccounts.values()].filter((a) => a.id !== accountId)
    accountRefreshes.delete(accountId)
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
    saveRealAccountOrder(next)
    HapticFeedback.lightImpact()
    reloadAllWidgets()
  }

  const handleEditAccountsReorder = (ordered: SubscriptionAccount[]) => {
    if (settings.isDemoMode) {
      setDemoAccounts(ordered)
    } else {
      saveRealAccountOrder(ordered)
    }
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
            onOpenCodexResetCards={(cards) => setSelectedResetCards({ account: acc, cards })}
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
          onUpdateAccount={(updated, newEnvelope) => {
            if (settings.isDemoMode) {
              setDemoAccounts((prev) =>
                prev.map((a) => (a.id === updated.id ? updated : a))
              )
            } else {
              const nextAccount = newEnvelope ? { ...updated } : updated
              const next = realAccounts.map((a) =>
                a.id === updated.id ? nextAccount : a
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
          onReorderAccounts={handleEditAccountsReorder}
          onDeleteAccount={handleDeleteAccount}
          onDismiss={finishEditAccountsSheet}
          onCancel={cancelEditAccountsSheet}
        />
      )
    }
    return <Text> </Text>
  }

  const resetCardsState = selectedResetCards ? accountStates[selectedResetCards.account.id] : undefined
  const resetCardsSnapshot = resetCardsState?.type === "loaded" ? resetCardsState.snapshot
    : resetCardsState?.type === "loading" || resetCardsState?.type === "failed" ? resetCardsState.previous
      : undefined
  const closeResetCards = () => setSelectedResetCards((current) => current === selectedResetCards ? null : current)
  const resetCardsSheet = {
    isPresented: selectedResetCards !== null,
    onChanged: (open: boolean) => {
      if (!open) closeResetCards()
    },
    content: selectedResetCards ? (
      <CodexResetCardsSheet
        key={selectedResetCards.account.id}
        cards={resetCardsSnapshot?.codexResetCards ?? selectedResetCards.cards}
        onRedeem={!settings.isDemoMode && resetCardsSnapshot?.codexResetCards
          ? (creditID) => redeemAccountResetCredit(selectedResetCards.account, creditID)
          : undefined}
        onDismiss={closeResetCards}
      />
    ) : <EmptyView />,
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
          ? [
              resetCardsSheet,
              {
                isPresented: releaseNotes.isPresented,
                onChanged: releaseNotes.onChanged,
                content: releaseNotes.content,
              },
            ]
          : [
              resetCardsSheet,
              {
                isPresented: isEditSheetPresented,
                onChanged: setIsEditSheetPresented,
                content: (
                  <AccountOrderEditSheet
                    accounts={currentAccounts}
                    onReorderAccounts={handleEditAccountsReorder}
                    onDeleteAccount={handleDeleteAccount}
                    onDismiss={finishEditAccountsSheet}
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
                    onUpdateAccount={(updated, newEnvelope) => {
                      if (settings.isDemoMode) {
                        setDemoAccounts((prev) =>
                          prev.map((a) => (a.id === updated.id ? updated : a))
                        )
                      } else {
                        const nextAccount = newEnvelope ? { ...updated } : updated
                        const next = realAccounts.map((a) =>
                          a.id === updated.id ? nextAccount : a
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
                  } else {
                    setHomeRoute(null)
                  }
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
      return (
        <DashboardAnimationContext.Provider value={dashboardAnimation}>
          {dashboardList}
        </DashboardAnimationContext.Provider>
      )
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
          <DashboardAnimationContext.Provider value={dashboardAnimation}>
            {dashboardList}
          </DashboardAnimationContext.Provider>
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
