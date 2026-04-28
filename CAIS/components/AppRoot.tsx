import {
  AppEvents,
  Button,
  ForEach,
  Group,
  HStack,
  Image,
  List,
  NavigationStack,
  Section,
  Script,
  Tab,
  TabView,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useObservable,
  useState,
  Form,
  Navigation,
  type ScenePhase,
} from "scripting"

import type { CaisSettings, ClipGroup, ClipItem, MonitorStatus } from "../types"
import { captureCurrentClipboard, startClipboardMonitor, stopClipboardMonitor } from "../services/clipboard_capture"
import { currentChangeCount, writeClipToPasteboard } from "../services/pasteboard_adapter"
import {
  clearAllClips,
  clearFavoriteClips,
  editClipContent,
  getClipGroups,
  getFullClipContent,
  markCopied,
  softDeleteClip,
  toggleFavorite,
  togglePinned,
  updateClipTitle,
  addFavoriteFromInput,
} from "../storage/clip_repository"
import { initializeDatabase } from "../storage/database"
import { loadSettings, saveSettings } from "../storage/settings_store"
import { readClipDataVersion } from "../storage/change_signal"
import { formatDateTime, withHaptic } from "../utils/common"
import { renderRuntimeTemplate } from "../utils/template"
import { ClipRow } from "./ClipRow"
import { PipStatusView } from "./PipStatusView"
import { SettingsView } from "./SettingsView"
import { readPipControlState, writePipControlState } from "../services/pip_control"

const TAB_FAVORITES = 0
const TAB_CLIPS = 1
const TAB_SETTINGS = 2
const APP_GROUP_PAGE_SIZE = 300
type ClearScope = "all" | "favorites"
let intentionalMinimize = false
let appRefreshGeneration = 0
let appMonitorStopper: (() => void) | null = null

function renderClipOutput(item: ClipItem, content: string): string {
  return item.manualFavorite ? renderRuntimeTemplate(content) : content
}

function EmptyState(props: {
  title: string
  message: string
  systemImage: string
}) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "center" as any }}
      padding={{ top: 32, bottom: 32 }}
      spacing={10}
    >
      <Image systemName={props.systemImage} font="largeTitle" foregroundStyle="secondaryLabel" />
      <Text font="headline">{props.title}</Text>
      <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">{props.message}</Text>
    </VStack>
  )
}

function StatusCard(props: {
  status: MonitorStatus
}) {
  return (
    <VStack frame={{ maxWidth: "infinity", alignment: "leading" as any }} spacing={7}>
      <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <VStack frame={{ maxWidth: "infinity", alignment: "leading" as any }} spacing={3}>
          <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>PiP 状态</Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            {props.status.active ? "PiP 监听运行中" : "PiP 监听未启动"}
          </Text>
        </VStack>
      </HStack>
      <Text
        font="caption"
        foregroundStyle="secondaryLabel"
        multilineTextAlignment="leading"
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      >
        [{formatDateTime(props.status.lastCheckedAt)}] {props.status.lastMessage}
      </Text>
    </VStack>
  )
}

function AddFavoriteView() {
  const dismiss = Navigation.useDismiss()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  return (
    <NavigationStack>
      <Form
        navigationTitle="添加收藏"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.72, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="取消" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" disabled={!content.trim()} action={() => {
            dismiss({ title, content })
          }} />
        }}
      >
        <Section>
          <TextField title="标题" value={title} prompt="可选，留空则自动生成" onChanged={setTitle} />
        </Section>
        <Section
          header={<Text>内容</Text>}
          footer={<Text>{"可使用 {{text}}、{{date}}、{{time}}、{{datetime}}、{{timestamp}}。"}</Text>}
        >
          <TextField
            title=""
            value={content}
            prompt="输入你想收藏的内容"
            axis="vertical"
            frame={{ minHeight: 120, maxWidth: "infinity", alignment: "topLeading" as any }}
            onChanged={setContent}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}

function ImageViewerView(props: {
  item: ClipItem
}) {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.item.title || "图片"}
        navigationBarTitleDisplayMode="inline"
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
        padding={16}
        toolbar={{
          topBarTrailing: <Button title="完成" action={() => dismiss(null)} />,
        }}
      >
        {props.item.imagePath ? (
          <Image
            filePath={props.item.imagePath}
            resizable
            scaleToFit
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
          />
        ) : (
          <Text foregroundStyle="secondaryLabel">图片文件不可读取</Text>
        )}
      </VStack>
    </NavigationStack>
  )
}

export function AppRoot() {
  const activeTab = useObservable(TAB_CLIPS)
  const pipPresented = useObservable(false)
  const deleteDialogPresented = useObservable(false)
  const clearDialogPresented = useObservable(false)
  const toastPresented = useObservable(false)
  const [settings, setSettings] = useState<CaisSettings>(() => loadSettings())
  const [favoriteGroups, setFavoriteGroups] = useState<ClipGroup[]>([])
  const [clipboardGroups, setClipboardGroups] = useState<ClipGroup[]>([])
  const [pendingDeleteItem, setPendingDeleteItem] = useState<ClipItem | null>(null)
  const [pendingDeleteTab, setPendingDeleteTab] = useState<number | null>(null)
  const [pendingClearScope, setPendingClearScope] = useState<ClearScope>("all")
  const [addCustomActionToken, setAddCustomActionToken] = useState(0)
  const [query, setQuery] = useState("")
  const [searchVisible, setSearchVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    active: false,
    lastMessage: "未启动",
  })

  useEffect(() => {
    deleteDialogPresented.setValue(false)
    setPendingDeleteItem(null)
    setPendingDeleteTab(null)
  }, [activeTab.value])

  useEffect(() => {
    void boot()
    const handleScenePhase = (phase: ScenePhase) => {
      if (phase === "active") void refresh(true)
    }
    AppEvents.scenePhase.addListener(handleScenePhase)
    const removeResume = Script.onResume?.((details) => {
      const pipCommand = details.queryParameters?.pip
      if (pipCommand === "0") {
        deactivatePipFromExternal({ exitAfter: true })
        return
      }
      if (details.queryParameters?.pip === "1") {
        void activatePipFromApp()
        return
      }
      void refresh(true)
    })
    const removeMinimize = Script.onMinimize?.(() => {
      if (intentionalMinimize) {
        intentionalMinimize = false
        return
      }
      Script.exit()
    })
    return () => {
      AppEvents.scenePhase.removeListener(handleScenePhase)
      removeResume?.()
      removeMinimize?.()
      stopPipMonitor()
    }
  }, [])

  useEffect(() => {
    let lastSeenCommandAt = 0
    const timer = (globalThis as any).setInterval?.(() => {
      const state = readPipControlState()
      if (!state.command || state.updatedAt <= lastSeenCommandAt) return
      lastSeenCommandAt = state.updatedAt
      if (state.command === "stop") {
        deactivatePipFromExternal()
      } else if (state.command === "start") {
        void activatePipFromApp()
      }
    }, 500)
    return () => {
      if (timer) (globalThis as any).clearInterval?.(timer)
    }
  }, [])

  useEffect(() => {
    let lastSeenClipDataVersion = readClipDataVersion()
    const timer = (globalThis as any).setInterval?.(() => {
      const version = readClipDataVersion()
      if (version <= lastSeenClipDataVersion) return
      lastSeenClipDataVersion = version
      void refresh(true)
    }, 700)
    return () => {
      if (timer) (globalThis as any).clearInterval?.(timer)
    }
  }, [])

  useEffect(() => {
    const timer = (globalThis as any).setTimeout?.(() => {
      void refresh(true)
    }, 180)
    return () => {
      if (timer) (globalThis as any).clearTimeout?.(timer)
    }
  }, [query])

  async function boot() {
    setLoading(true)
    try {
      await initializeDatabase()
      await captureCurrentClipboard(settings)
      await refresh(true)
      if (Script.queryParameters?.pip === "1") {
        await activatePipFromApp()
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function refresh(_force = false, currentSettings = settings) {
    const generation = ++appRefreshGeneration
    const groupLimit = Math.min(currentSettings.maxItems, APP_GROUP_PAGE_SIZE)
    const search = query.trim()
    const [nextFavoriteGroups, nextClipboardGroups] = await Promise.all([
      getClipGroups("favorites", search, groupLimit),
      getClipGroups("clipboard", search, groupLimit),
    ])
    if (generation !== appRefreshGeneration) return
    setFavoriteGroups(nextFavoriteGroups)
    setClipboardGroups(nextClipboardGroups)
  }

  function updateSettings(nextSettings: CaisSettings) {
    const next = saveSettings(nextSettings)
    setSettings(next)
    void refresh(true, next)
  }

  function showToast(message: string) {
    setToastMessage(message)
    toastPresented.setValue(false)
    ;(globalThis as any).setTimeout?.(() => {
      toastPresented.setValue(true)
    }, 0)
  }

  function toastOptions() {
    return {
      isPresented: toastPresented,
      message: toastMessage,
      duration: 1.2,
      position: "bottom" as any,
    }
  }

  async function captureNow() {
    setLoading(true)
    try {
      const result = await captureCurrentClipboard(settings)
      const message =
        result.status === "created" ? `已采集：${result.item.title}` :
        result.status === "updated" ? `已更新：${result.item.title}` :
        result.reason
      setMonitorStatus((status) => ({
        ...status,
        lastMessage: message,
        lastCheckedAt: Date.now(),
        lastCapturedAt: result.status === "skipped" ? status.lastCapturedAt : Date.now(),
      }))
      await refresh()
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function copyItem(item: ClipItem) {
    try {
      const fullContent = renderClipOutput(item, await getFullClipContent(item.id))
      await writeClipToPasteboard(item, fullContent)
      await markCopied(item)
      setMonitorStatus((status) => ({
        ...status,
        lastMessage: `已复制：${item.title}`,
        lastCheckedAt: Date.now(),
      }))
      showToast("已复制")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "复制失败") })
    }
  }

  function requestDeleteItem(item: ClipItem) {
    setPendingDeleteItem(item)
    setPendingDeleteTab(activeTab.value)
    deleteDialogPresented.setValue(true)
  }

  function dismissDeleteDialog() {
    deleteDialogPresented.setValue(false)
    setPendingDeleteItem(null)
    setPendingDeleteTab(null)
  }

  async function confirmDeleteItem() {
    const item = pendingDeleteItem
    dismissDeleteDialog()
    if (!item) return
    await softDeleteClip(item)
    await refresh()
  }

  function requestClear(scope: ClearScope) {
    setPendingClearScope(scope)
    clearDialogPresented.setValue(true)
  }

  async function confirmClear() {
    const scope = pendingClearScope
    clearDialogPresented.setValue(false)
    if (scope === "favorites") {
      await clearFavoriteClips()
    } else {
      await clearAllClips()
    }
    await refresh()
  }

  async function editItemTitle(item: ClipItem) {
    const title = await Dialog.prompt({
      title: "增加标题",
      message: "留空时继续使用正文内容作为标题。",
      defaultValue: item.title,
      placeholder: "输入标题",
      cancelLabel: "取消",
      confirmLabel: "保存",
      selectAll: true,
    })
    if (title == null) return
    await updateClipTitle(item, title)
    await refresh()
  }

  async function editItem(item: ClipItem) {
    if (item.kind === "image") {
      await Dialog.alert({ message: "图片条目暂不支持编辑文本内容" })
      return
    }
    const fullContent = await getFullClipContent(item.id)
    const controller = new EditorController({
      content: fullContent,
      ext: "txt",
      readOnly: false,
    })
    const initialChangeCount = await currentChangeCount()
    try {
      await controller.present({
        navigationTitle: "编辑内容",
        scriptName: "CAIS",
        fullscreen: false,
      })
      let needsRefresh = false
      if (await currentChangeCount() !== initialChangeCount) {
        await captureCurrentClipboard(settings)
        needsRefresh = true
      }
      const nextContent = controller.content
      if (nextContent !== fullContent) {
        await editClipContent(item, nextContent)
        needsRefresh = true
      }
      if (needsRefresh) await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "编辑失败") })
    } finally {
      controller.dispose()
    }
  }

  async function viewImageItem(item: ClipItem) {
    await Navigation.present({
      element: <ImageViewerView item={item} />,
      modalPresentationStyle: "pageSheet",
    })
  }

  function startPipMonitor() {
    const status = { active: true, lastMessage: "监听启动中", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
    writePipControlState({ active: true, command: undefined })
    if (appMonitorStopper) return
    appMonitorStopper = startClipboardMonitor(settings, (next) => {
      setMonitorStatus(next)
      if (next.lastCapturedAt) void refresh()
    })
  }

  function stopPipMonitor() {
    if (appMonitorStopper) {
      appMonitorStopper()
      appMonitorStopper = null
    } else {
      stopClipboardMonitor()
    }
    setMonitorStatus({ active: false, lastMessage: "监听已停止", lastCheckedAt: Date.now() })
    writePipControlState({ active: false, command: undefined })
  }

  function togglePip() {
    const next = !pipPresented.value
    pipPresented.setValue(next)
    if (next) {
      startPipMonitor()
    } else {
      stopPipMonitor()
    }
  }

  function deactivatePipFromExternal(options: { exitAfter?: boolean } = {}) {
    pipPresented.setValue(false)
    stopPipMonitor()
    if (options.exitAfter) {
      ;(globalThis as any).setTimeout?.(() => {
        Script.exit()
      }, 250)
    }
  }

  async function minimizeScript() {
    if (!Script.supportsMinimization?.()) {
      return
    }
    try {
      intentionalMinimize = true
      const ok = await Script.minimize()
      if (!ok) intentionalMinimize = false
    } catch (error: any) {
      intentionalMinimize = false
      await Dialog.alert({ message: String(error?.message ?? error ?? "最小化失败") })
    }
  }

  async function activatePipFromApp() {
    pipPresented.setValue(true)
    startPipMonitor()
    if (Script.supportsMinimization?.()) {
      ;(globalThis as any).setTimeout?.(() => {
        void (async () => {
          intentionalMinimize = true
          try {
            const ok = await Script.minimize()
            if (!ok) intentionalMinimize = false
          } catch {
            intentionalMinimize = false
          }
        })()
      }, 900)
    }
  }

  function renderClipRow(item: ClipItem, options: { allowDelete: boolean } = { allowDelete: true }) {
    return (
      <HStack
        key={item.id}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        background="rgba(0,0,0,0.001)"
        contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
        onTapGesture={withHaptic(() => copyItem(item))}
        contextMenu={{
          menuItems: (
            <Group>
              <Button title="增加标题" systemImage="textformat" action={() => void editItemTitle(item)} />
              {item.kind === "image" ? (
                <Button title="查看" systemImage="photo" action={() => void viewImageItem(item)} />
              ) : (
                <Button title="编辑" systemImage="square.and.pencil" action={() => void editItem(item)} />
              )}
            </Group>
          ),
        }}
        leadingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            ...(item.manualFavorite ? [] : [
              <Button
                title=""
                systemImage={item.favorite ? "star.slash" : "star"}
                tint="systemYellow"
                action={() => void toggleFavorite(item).then(() => refresh())}
              />,
            ]),
            <Button
              title=""
              systemImage={item.pinned ? "pin.slash" : "pin"}
              tint="systemOrange"
              action={() => void togglePinned(item).then(() => refresh())}
            />,
          ],
        }}
        trailingSwipeActions={options.allowDelete ? {
          allowsFullSwipe: false,
          actions: [
            <Button
              title=""
              systemImage="trash"
              tint="systemRed"
              action={() => requestDeleteItem(item)}
            />,
          ],
        } : undefined}
        confirmationDialog={pendingDeleteItem?.id === item.id && pendingDeleteTab === activeTab.value ? {
          title: "是否删除？",
          isPresented: deleteDialogPresented,
          actions: (
            <Group>
              <Button title="删除" systemImage="trash" role="destructive" action={() => void confirmDeleteItem()} />
              <Button title="取消" role="cancel" action={dismissDeleteDialog} />
            </Group>
          ),
        } : undefined}
      >
        <ClipRow item={item} />
      </HStack>
    )
  }

  function renderGroupedClipList(groups: ClipGroup[], emptyMessage: string, options: { allowDelete?: (item: ClipItem) => boolean } = {}) {
    if (!groups.some((group) => group.items.length)) {
      return <EmptyState title="暂无内容" message={emptyMessage} systemImage="doc.on.clipboard" />
    }
    return (
      <Group>
        {groups.filter((group) => group.items.length)
          .map((group) => (
            <Section key={group.title} header={<Text>{group.title}</Text>}>
              <ForEach
                count={group.items.length}
                itemBuilder={(index) => {
                  const item = group.items[index]
                  return item ? renderClipRow(item, { allowDelete: options.allowDelete?.(item) ?? true }) : (null as any)
                }}
              />
            </Section>
          ))}
      </Group>
    )
  }

  function toolbarLeading(scope: ClearScope | null) {
    return (
      <HStack spacing={10}>
        {scope ? (
          <Button
            title=""
            systemImage="trash"
            role="destructive"
            action={withHaptic(() => requestClear(scope))}
          />
        ) : null}
        {Script.supportsMinimization?.() ? (
          <Button
            title=""
            systemImage="minus.circle"
            action={withHaptic(minimizeScript)}
          />
        ) : null}
      </HStack>
    )
  }

  function clipToolbarButtons() {
    return (
      <HStack spacing={10}>
        <Button
          title=""
          systemImage="magnifyingglass"
          action={withHaptic(() => setSearchVisible((v) => !v))}
        />
        <Button
          title=""
          systemImage="doc.badge.plus"
          disabled={loading}
          action={withHaptic(captureNow)}
        />
      </HStack>
    )
  }

  function favoriteToolbarButtons() {
    return (
      <HStack spacing={10}>
        <Button
          title=""
          systemImage="magnifyingglass"
          action={withHaptic(() => setSearchVisible((v) => !v))}
        />
        <Button
          title=""
          systemImage="plus"
          action={withHaptic(async () => {
            const result = await Navigation.present<{ title: string, content: string } | null>({
              element: <AddFavoriteView />,
              modalPresentationStyle: "pageSheet"
            })
            if (result) {
              await addFavoriteFromInput(result.title, result.content)
              showToast("已添加到收藏")
              await refresh()
            }
          })}
        />
      </HStack>
    )
  }

  function settingsTrailingToolbar() {
    return (
      <Button
        title=""
        systemImage="plus"
        action={withHaptic(() => setAddCustomActionToken((v) => v + 1))}
      />
    )
  }

  function searchSection() {
    if (!searchVisible) return null
    return (
      <Section>
        <TextField title="搜索" value={query} prompt="输入关键词" onChanged={setQuery} />
      </Section>
    )
  }

  return (
    <TabView
      selection={activeTab as any}
      tint="systemIndigo"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
      pip={{
        isPresented: pipPresented,
        maximumUpdatesPerSecond: 2,
        content: (
          <PipStatusView
            status={monitorStatus}
            onStart={startPipMonitor}
            onStop={stopPipMonitor}
          />
        ),
      }}
      confirmationDialog={{
        title: pendingClearScope === "favorites" ? "清空收藏？" : "清空剪贴板？",
        isPresented: clearDialogPresented,
        actions: (
          <Group>
            <Button title="清空" systemImage="trash" role="destructive" action={() => void confirmClear()} />
            <Button title="取消" role="cancel" action={() => clearDialogPresented.setValue(false)} />
          </Group>
        ),
      }}
    >
      <Tab title="收藏" systemImage="star" value={TAB_FAVORITES}>
        <NavigationStack>
          <List
            navigationTitle="收藏"
            navigationBarTitleDisplayMode="inline"
            listStyle="insetGroup"
            toolbar={{ topBarLeading: toolbarLeading("favorites"), topBarTrailing: favoriteToolbarButtons() }}
            toast={toastOptions()}
          >
            {searchSection()}
            {renderGroupedClipList(favoriteGroups, searchVisible && query.trim() ? "没有匹配的收藏内容。" : "点击右上角添加常用语，或右滑剪贴板条目点星标。")}
          </List>
        </NavigationStack>
      </Tab>

      <Tab title="剪贴板" systemImage="doc.on.clipboard" value={TAB_CLIPS}>
        <NavigationStack>
          <List
            navigationTitle="CAIS"
            navigationBarTitleDisplayMode="inline"
            listStyle="insetGroup"
            toolbar={{ topBarLeading: toolbarLeading("all"), topBarTrailing: clipToolbarButtons() }}
            toast={toastOptions()}
          >
            <Section>
              <StatusCard
                status={monitorStatus}
              />
              <Toggle
                title="开启 PiP 监听"
                value={pipPresented.value}
                onChanged={() => withHaptic(togglePip)()}
              />
            </Section>
            {searchSection()}
            {renderGroupedClipList(
              clipboardGroups,
              searchVisible && query.trim() ? "没有匹配的剪贴板内容。" : "点击右上角采集按钮，或开启 PiP 监听。",
              { allowDelete: (item) => !item.manualFavorite }
            )}
          </List>
        </NavigationStack>
      </Tab>

      <Tab title="设置" systemImage="gearshape" value={TAB_SETTINGS}>
        <NavigationStack>
          <SettingsView
            value={settings}
            onChanged={updateSettings}
            addActionToken={addCustomActionToken}
            leadingToolbar={toolbarLeading(null)}
            trailingToolbar={settingsTrailingToolbar()}
          />
        </NavigationStack>
      </Tab>
    </TabView>
  )
}
