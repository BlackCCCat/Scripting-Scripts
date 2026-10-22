import {
  Button,
  ContentUnavailableView,
  ForEach,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Tab,
  TabView,
  Text,
  VStack,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import {
  QuotaQueryError,
  queryProviderQuota,
} from "../providers"
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
  removeEnvelopeFromKeychain,
  saveDashboardSettings,
  saveEnvelopeToKeychain,
  saveStoredAccounts,
  saveStoredSnapshots,
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

function reorderSublistInMaster(
  master: SubscriptionAccount[],
  sublist: SubscriptionAccount[],
  indices: number[],
  newOffset: number
): SubscriptionAccount[] {
  const moving = indices
    .map((i) => sublist[i])
    .filter((item): item is SubscriptionAccount => item !== undefined)
  if (moving.length === 0) return master

  const restSub = sublist.filter((_, idx) => !indices.includes(idx))
  const insertAt = Math.max(0, Math.min(restSub.length, newOffset))
  const reorderedSub = [...restSub]
  reorderedSub.splice(insertAt, 0, ...moving)

  const subIdSet = new Set(sublist.map((a) => a.id))
  let subCursor = 0
  return master.map((item) => {
    if (subIdSet.has(item.id)) {
      const replacement = reorderedSub[subCursor]
      subCursor++
      return replacement ?? item
    }
    return item
  })
}

export function DashboardRootView() {
  const dismiss = Navigation.useDismiss()

  const [activeTab, setActiveTab] = useState<number>(0)
  const [settings, setSettings] = useState<DashboardSettings>(() =>
    loadDashboardSettings()
  )
  const [realAccounts, setRealAccounts] = useState<SubscriptionAccount[]>(() =>
    loadStoredAccounts()
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

  const openAddAccountFlow = (provider?: ProviderId) => {
    setPreselectedProviderForAdd(provider)
    setStartAddWithPicker(!provider)
    setAddSheetNonce((n) => n + 1)
    setIsAddSheetPresented(true)
  }

  const openEditAccountsSheet = () => {
    const list = settings.isDemoMode ? demoAccounts : realAccounts
    setAccountsBeforeEdit([...list])
    setIsEditSheetPresented(true)
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
      if (meta.displayName.toLowerCase().includes(q)) return true
      if (acc.provider.toLowerCase().includes(q)) return true
      return meta.aliases.some((a) => a.toLowerCase().includes(q))
    })
  }, [currentAccounts, searchQuery])

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
    setSettings(next)
    saveDashboardSettings(next)
    reloadAllWidgets()
  }

  const refreshSingleAccount = async (account: SubscriptionAccount) => {
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

    if (settings.isDemoMode) {
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
      const result = await queryProviderQuota(account.id, envelope)
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

  // 全部账号刷新（支持手动操作与启动时静默无感拉取）
  const refreshAllAccounts = async (options?: { isManual?: boolean }) => {
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
            const result = await queryProviderQuota(acc.id, envelope)
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

  // 启动应用时自动刷新已启用账号（静默后台拉取，不触发整页重置与震动，更新后广播小组件同步）
  const hasAutoRefreshedOnLaunchRef = useRef<boolean>(false)
  useEffect(() => {
    if (settings.autoRefreshOnLaunch) {
      if (!hasAutoRefreshedOnLaunchRef.current) {
        hasAutoRefreshedOnLaunchRef.current = true
        void refreshAllAccounts({ isManual: false })
      }
    }
  }, [settings.autoRefreshOnLaunch, settings.isDemoMode])

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

  const handleMoveSublist = (
    sublist: SubscriptionAccount[],
    indices: number[],
    newOffset: number
  ) => {
    if (settings.isDemoMode) {
      setDemoAccounts((prev) =>
        reorderSublistInMaster(prev, sublist, indices, newOffset)
      )
      HapticFeedback.lightImpact()
      return
    }
    const next = reorderSublistInMaster(
      realAccounts,
      sublist,
      indices,
      newOffset
    )
    setRealAccounts(next)
    saveStoredAccounts(next)
    HapticFeedback.lightImpact()
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
    if (settings.isDemoMode) {
      // 如果用户在演示模式保存了真实账号，自动切换到真实模式并立即刷新该账号
      updateSettings({ ...settings, isDemoMode: false })
    }
    const nextAccounts = [newAccount, ...realAccounts]
    setRealAccounts(nextAccounts)
    saveStoredAccounts(nextAccounts)
    refreshSingleAccount(newAccount)
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
    openAddAccountFlow(provider)
  }

  const renderAccountRowWithSwipe = (acc: SubscriptionAccount) => {
    const state: AccountQuotaState = accountStates[acc.id] ?? { type: "idle" }
    return (
      <VStack
        key={acc.id}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        listRowSeparator="hidden"
        trailingSwipeActions={{
          allowsFullSwipe: true,
          actions: [
            <Button
              title="删除"
              systemImage="trash"
              role="destructive"
              tint="red"
              action={() => handleDeleteAccount(acc.id)}
            />,
            <Button
              title="设置"
              systemImage="slider.horizontal.3"
              tint="systemBlue"
              action={() => setSelectedAccountForDetail(acc)}
            />,
            <Button
              title="刷新"
              systemImage="arrow.clockwise"
              tint="systemTeal"
              action={() => refreshSingleAccount(acc)}
            />,
          ],
        }}
      >
        <AccountQuotaRow
          account={acc}
          state={state}
          protectAccountIdentity={settings.protectAccountIdentity}
          codexResetStatus={codexResetStatus}
          onRefresh={() => refreshSingleAccount(acc)}
          onOpenDetail={() => setSelectedAccountForDetail(acc)}
        />
      </VStack>
    )
  }

  return (
    <TabView
      tabIndex={activeTab}
      onTabIndexChanged={setActiveTab}
      tint="accentColor"
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
      <Tab title="额度看板" systemImage="chart.bar.doc.horizontal.fill" value={0}>
        <NavigationStack>
          <List
            navigationTitle="AI 额度看板"
            listStyle="insetGroup"
            searchable={{
              value: searchQuery,
              onChanged: setSearchQuery,
              prompt: "筛选账号名称或 AI 供应商",
            }}
            refreshable={() => refreshAllAccounts({ isManual: true })}
            toolbar={{
              topBarLeading: (
                <HStack spacing={12}>
                  <Button
                    title="退出"
                    systemImage="xmark"
                    action={() => dismiss()}
                  />
                  <Button
                    title="编辑"
                    systemImage="pencil"
                    action={openEditAccountsSheet}
                  />
                </HStack>
              ),
              topBarTrailing: (
                <HStack spacing={12}>
                  <Button
                    title="全部刷新"
                    systemImage="arrow.clockwise"
                    disabled={isRefreshingAll || currentAccounts.length === 0}
                    action={() => refreshAllAccounts({ isManual: true })}
                  />
                  <Button
                    title="添加账号"
                    systemImage="plus"
                    action={() => openAddAccountFlow()}
                  />
                </HStack>
              ),
            }}
            sheet={[
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
                        setRealAccounts(next)
                        saveStoredAccounts(next)
                        refreshSingleAccount(updated)
                      }
                    }}
                    onDeleteAccount={handleDeleteAccount}
                    onRefreshAccount={refreshSingleAccount}
                  />
                ) : (
                  <Text>未选择账号</Text>
                ),
              },
            ]}
          >
            <DashboardOverviewSection
              accounts={displayedAccounts}
              accountStates={accountStates}
              isDemoMode={settings.isDemoMode}
              onToggleDemoMode={(val) =>
                updateSettings({ ...settings, isDemoMode: val })
              }
              onSelectAccount={(acc) => setSelectedAccountForDetail(acc)}
              onOpenEditSheet={openEditAccountsSheet}
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
                      searchQuery.trim()
                        ? "没有匹配的供应商账号"
                        : "尚未添加 AI 供应商账号"
                    }
                    systemImage="sparkles.rectangle.stack"
                    description={
                      searchQuery.trim()
                        ? "请尝试更换搜索关键词，或在「供应商目录」中添加新平台"
                        : "支持 DeepSeek、OpenAI Codex、Claude、WorkBuddy、火山方舟、MiniMax、New API 等 78 家 AI 平台"
                    }
                  />
                  <Button
                    buttonStyle={adaptiveProminentButtonStyle()}
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    action={() => openAddAccountFlow()}
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
                        lineLimit={1}
                        multilineTextAlignment="center"
                      >
                        添加第一个 AI 供应商账号
                      </Text>
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
                  <Section
                    key={category}
                    header={
                      <HStack spacing={6}>
                        <Image
                          systemName={routeCategorySymbol(category)}
                          font="caption"
                          foregroundStyle="accentColor"
                        />
                        <Text>{`${routeCategoryTitle(category)} (${groupItems.length})`}</Text>
                        <Spacer />
                        <Text font="caption2" foregroundStyle="secondaryLabel">
                          长按拖动排序
                        </Text>
                      </HStack>
                    }
                  >
                    <ForEach
                      count={groupItems.length}
                      onMove={(indices, newOffset) =>
                        handleMoveSublist(groupItems, indices, newOffset)
                      }
                      itemBuilder={(idx) => {
                        const acc = groupItems[idx]
                        if (!acc) return <VStack />
                        return renderAccountRowWithSwipe(acc)
                      }}
                    />
                  </Section>
                )
              })
            ) : (
              <Section
                header={
                  <HStack>
                    <Text>订阅额度与 API 钱包</Text>
                    <Spacer />
                    <Text font="caption2" foregroundStyle="secondaryLabel">
                      长按卡片拖动排序
                    </Text>
                  </HStack>
                }
              >
                <ForEach
                  count={filteredAccounts.length}
                  onMove={(indices, newOffset) =>
                    handleMoveSublist(filteredAccounts, indices, newOffset)
                  }
                  itemBuilder={(idx) => {
                    const acc = filteredAccounts[idx]
                    if (!acc) return <VStack />
                    return renderAccountRowWithSwipe(acc)
                  }}
                />
              </Section>
            )}
          </List>
        </NavigationStack>
      </Tab>

      <Tab title="供应商目录" systemImage="square.grid.2x2.fill" value={1}>
        <ProviderCatalogView
          isDemoMode={settings.isDemoMode}
          onQuickAddAccount={handleQuickAddFromCatalog}
          onDismiss={() => dismiss()}
        />
      </Tab>

      <Tab title="设置" systemImage="gearshape.fill" value={2}>
        <SettingsView
          settings={settings}
          realAccountCount={realAccounts.length}
          demoAccountCount={demoAccounts.length}
          onUpdateSettings={updateSettings}
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
