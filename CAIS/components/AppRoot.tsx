import {
  Button,
  ControlGroup,
  Divider,
  DragGesture,
  EmptyView,
  Editor,
  Group,
  GeometryReader,
  HStack,
  Image,
  Menu,
  MagnifyGesture,
  NavigationStack,
  Picker,
  Section,
  Script,
  Tab,
  TabView,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
  Form,
  Navigation,
  useColorScheme,
  type VirtualNode,
} from "scripting"

import type { CaisSettings, ClipboardClearRange, ClipGroup, ClipItem, ClipKind, ClipKindCountsByScope, ClipListScope, FavoriteGroup, KeyboardCustomAction, KeyboardMenuBuiltinAction, MonitorStatus } from "../types"
import { captureCurrentClipboard, startClipboardMonitor, stopClipboardMonitor } from "../services/clipboard_capture"
import { currentChangeCount, writeClipToPasteboard, writeImageToPasteboard, writeTextToPasteboard } from "../services/pasteboard_adapter"
import {
  addClipFromPayload,
  clearClipboardClipsByRange,
  clearFavoriteClips,
  editClipContent,
  getClipGroups,
  getClipKindCounts,
  getFullClipContent,
  markCopied,
  softDeleteClip,
  toggleFavorite,
  togglePinned,
  updateClipTitle,
  addFavoriteFromInput,
  createFavoriteGroup,
  getFavoriteGroupDefinitions,
  removeFavoriteGroup,
  reorderFavoriteGroups,
  saveFavoriteGroup,
  updateFavoriteFromInput,
} from "../storage/clip_repository"
import { initializeDatabase, readDatabaseDataVersion } from "../storage/database"
import { readClipDataVersion, subscribeClipDataChanges } from "../storage/change_signal"
import { loadSettings, saveSettings } from "../storage/settings_store"
import { applyICloudSyncSettings } from "../storage/icloud_sync"
import { formatDateTime, isLikelyURL, makeId, withHaptic } from "../utils/common"
import { renderRuntimeTemplate } from "../utils/template"
import { readAppFullscreen, writeAppFullscreen } from "../utils/window_state"
import { ClipRow, NonGlassClipRow } from "./ClipRow"
import { LaunchSplash } from "./LaunchSplash"
import { PipStatusView } from "./PipStatusView"
import { useReleaseNotesSheet } from "./ReleaseNotesSheet"
import { SettingsView } from "./SettingsView"
import { TokenSelectionPanel } from "./TokenSelectionPanel"
import { readPipControlState, writePipControlState } from "../services/pip_control"
import { selectedTokenText, tokenizeWords, type CaisToken } from "../utils/tokenize"
import {
  applyBuiltinMenuAction,
  applyCustomMenuAction,
  customActionSystemImage,
  getOrderedMenuBuiltins,
  menuBuiltinSystemImage,
  menuBuiltinTitle,
  type MenuActionResult,
} from "../utils/menu_actions"
import { clearCurrentClipboardIfMatchesDeletedItem } from "../services/clipboard_cleanup"
import {
  getLanShareRuntimeStatus,
  reconcileLanShareServer,
  releaseLanShareServer,
  type LanShareRuntimeStatus,
} from "../services/lan_share_server"
import { rotateLanShareAccessToken } from "../services/lan_share_credentials"
import { recognizeTextFromImagePath } from "../services/image_text_recognition"
import { playCaisHaptic } from "../utils/feedback"
import { favoriteDelimiterForItem, isFieldFavorite, parseFavoriteFields, type FavoriteField } from "../utils/favorite_fields"
import {
  FavoriteEditorView,
  FavoriteFieldsDetailView,
  type FavoriteDraft,
} from "./FavoriteFieldsView"
import { FavoriteFieldActionMenu } from "./FavoriteFieldActionMenu"
import { FavoriteGroupEditorView, type FavoriteGroupDraft } from "./FavoriteGroupEditorView"
import { FavoriteGroupManagerView } from "./FavoriteGroupManagerView"

const TAB_FAVORITES = 0
const TAB_CLIPS = 1
const TAB_SETTINGS = 2
const ACTIVE_TAB_STORAGE_KEY = "cais_active_tab_v1"
const APP_GROUP_PAGE_SIZE = 300
const TOAST_DURATION_MS = 1200
const CAIS_APP_RESUME_HANDLER = "__CAIS_APP_RESUME_HANDLER__"
const APP_SCROLL_CONTENT_MARGINS = {
  insets: { top: 0, bottom: 0, leading: 0, trailing: 0 },
  placement: "scrollContent" as const,
}

type ClearScope = "favorites" | ClipboardClearRange
let intentionalMinimize = false
let appRefreshGeneration = 0
let appMonitorStopper: (() => void) | null = null
type AppRootMode = "app" | "home"
type ClipKindFilter = ClipKind | null
type HomeRoute =
  | { kind: "addContent" }
  | { kind: "editContent"; item: ClipItem; content: string; initialChangeCount: number }
  | { kind: "favoriteEditor"; sessionId: string; item?: ClipItem; initial?: FavoriteDraft; preferredFormat?: "plain" | "fields"; favoriteGroups: FavoriteGroup[] }
  | { kind: "favoriteGroupEditor" }
  | { kind: "favoriteGroupManager"; groups: FavoriteGroup[] }
  | { kind: "favoriteFields"; item: ClipItem; fields: FavoriteField[] }
  | { kind: "image"; item: ClipItem }
  | { kind: "tokens"; tokens: CaisToken[] }
const EMPTY_CLIP_KIND_COUNTS: ClipKindCountsByScope = {
  favorites: { total: 0, text: 0, url: 0, image: 0 },
  clipboard: { total: 0, text: 0, url: 0, image: 0 },
}

function removingClipFromGroups(groups: ClipGroup[], id: string): ClipGroup[] {
  const groupIndex = groups.findIndex((group) => group.items.some((item) => item.id === id))
  if (groupIndex < 0) return groups
  const next = [...groups]
  next[groupIndex] = {
    ...groups[groupIndex],
    items: groups[groupIndex].items.filter((item) => item.id !== id),
  }
  return next
}

function InteractiveClipRow(props: {
  item: ClipItem
  allowDelete: boolean
  onTap: () => void
  onConfirmDelete: (item: ClipItem) => Promise<void>
  contextMenuItems: VirtualNode
  leadingActions: VirtualNode[]
  primaryTrailingAction: VirtualNode
  content: VirtualNode
}) {
  const deleteDialogPresenter = useRef<() => void>()
  const trailingActions = [
    props.primaryTrailingAction,
    ...(props.allowDelete ? [
      <Button
        title=""
        systemImage="trash"
        tint="systemRed"
        action={withHaptic(() => deleteDialogPresenter.current?.())}
      />,
    ] : []),
  ]

  return (
    <HStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      background="rgba(0,0,0,0.001)"
      contentShape={{
        kind: "contextMenuPreview",
        shape: { type: "rect", cornerRadius: 18 },
      } as any}
      onTapGesture={props.onTap}
      contextMenu={{ menuItems: props.contextMenuItems }}
      leadingSwipeActions={{ allowsFullSwipe: false, actions: props.leadingActions }}
      trailingSwipeActions={{ allowsFullSwipe: false, actions: trailingActions }}
      listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
      listRowBackground={<EmptyView />}
      listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
      listRowSeparatorTint={{ color: "clear", edges: "all" as any }}
      overlay={props.allowDelete ? (
        <ClipDeleteConfirmationHost
          presenter={deleteDialogPresenter}
          item={props.item}
          onConfirm={props.onConfirmDelete}
        />
      ) : undefined}
    >
      {props.content}
    </HStack>
  )
}

function ClipDeleteConfirmationHost(props: {
  presenter: { current: (() => void) | undefined }
  item: ClipItem
  onConfirm: (item: ClipItem) => Promise<void>
}) {
  const isPresented = useObservable(false)
  props.presenter.current = () => isPresented.setValue(true)

  return (
    <HStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      allowsHitTesting={false}
      confirmationDialog={{
        title: "是否删除？",
        isPresented,
        actions: (
          <Group>
            <Button
              title="删除"
              systemImage="trash"
              role="destructive"
              action={() => {
                isPresented.setValue(false)
                void props.onConfirm(props.item)
              }}
            />
            <Button title="取消" role="cancel" action={() => isPresented.setValue(false)} />
          </Group>
        ),
      }}
    >
      <EmptyView />
    </HStack>
  )
}

function readActiveTab(): number {
  try {
    const value = Number((globalThis as any).Storage?.get?.(ACTIVE_TAB_STORAGE_KEY))
    return value === TAB_FAVORITES || value === TAB_CLIPS || value === TAB_SETTINGS
      ? value
      : TAB_CLIPS
  } catch {
    return TAB_CLIPS
  }
}

function writeActiveTab(value: number): void {
  try {
    ;(globalThis as any).Storage?.set?.(ACTIVE_TAB_STORAGE_KEY, value)
  } catch {
  }
}

function renderClipOutput(item: ClipItem, content: string): string {
  return item.manualFavorite ? renderRuntimeTemplate(content) : content
}

function EmptyState(props: {
  title: string
  message: string
  systemImage: string
}) {
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"

  return (
    <HStack
      frame={{ maxWidth: "infinity", alignment: "center" as any }}
      listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
      listRowSeparator="hidden"
      listRowBackground={<EmptyView />}
    >
      <VStack
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
        padding={{ top: 40, bottom: 40, leading: 16, trailing: 16 }}
        spacing={12}
        background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
        glassEffect={{ type: "rect", cornerRadius: 18 } as any}
        shadow={{
          color: colorScheme === "dark" ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.07)",
          radius: 10,
          y: 4,
        }}
      >
        <Image systemName={props.systemImage} font="largeTitle" foregroundStyle="secondaryLabel" />
        <Text font="headline">{props.title}</Text>
        <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">{props.message}</Text>
      </VStack>
    </HStack>
  )
}

function ClipContentEditorView(props: {
  content: string
  navigationTitle?: string
  iconOnlyToolbar?: boolean
  embedded?: boolean
  onCancel?: () => void
  onSave?: (content: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [controller] = useState(() => new EditorController({
    content: props.content,
    ext: "txt",
    readOnly: false,
  }))

  useEffect(() => {
    return () => {
      controller.dispose()
    }
  }, [controller])

  function cancel() {
    if (props.onCancel) {
      props.onCancel()
    } else {
      dismiss(null)
    }
  }

  function save() {
    if (props.onSave) {
      props.onSave(controller.content)
    } else {
      dismiss(controller.content)
    }
  }

  const page = (
    <VStack
        navigationTitle={props.navigationTitle ?? "编辑内容"}
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility={props.embedded ? "visible" : undefined}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        presentationDetents={["large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: props.embedded
            ? undefined
            : props.iconOnlyToolbar
              ? <Button title="" systemImage="xmark" accessibilityLabel="取消" role="cancel" action={cancel} />
              : <Button title="取消" role="cancel" action={cancel} />,
          topBarTrailing: props.iconOnlyToolbar
            ? <Button title="" systemImage="checkmark" accessibilityLabel="保存" action={save} />
            : <Button title="保存" action={save} />,
        }}
      >
        <Editor
          controller={controller}
          scriptName="CAIS"
          showAccessoryView
          searchEnabled
          ignoresSafeArea={props.embedded ? undefined : { regions: "container", edges: "bottom" }}
        />
    </VStack>
  )

  return props.embedded ? page : <NavigationStack>{page}</NavigationStack>
}

function AppTokenResultView(props: {
  tokens: CaisToken[]
  embedded?: boolean
  onCopySelection?: (content: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedText = selectedTokenText(props.tokens, selectedIds)

  function toggleToken(token: CaisToken) {
    setSelectedIds((ids) => ids.includes(token.id)
      ? ids.filter((id) => id !== token.id)
      : [...ids, token.id])
  }

  function submit() {
    if (props.onCopySelection) {
      props.onCopySelection(selectedText)
    } else {
      dismiss(selectedText)
    }
  }

  const page = (
    <VStack
        navigationTitle="分词结果"
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility={props.embedded ? "visible" : undefined}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={16}
        toolbar={{
          topBarLeading: <Button title="清空" systemImage="arrow.counterclockwise.circle" disabled={!selectedText} action={() => setSelectedIds([])} />,
          topBarTrailing: <Button title="复制" systemImage="doc.on.doc" disabled={!selectedText} action={submit} />,
        }}
      >
        <TokenSelectionPanel
          tokens={props.tokens}
          selectedIds={selectedIds}
          selectedText={selectedText}
          minHeight={420}
          onToggle={toggleToken}
        />
    </VStack>
  )

  return props.embedded ? page : <NavigationStack>{page}</NavigationStack>
}

function ImageViewerView(props: {
  item: ClipItem
  embedded?: boolean
  onClose?: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const imagePath = props.item.imagePath
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const gestureBaseScale = useRef(1)
  const gestureBaseOffset = useRef({ x: 0, y: 0 })
  const [imageSize] = useState(() => {
    const image = imagePath ? UIImage.fromFile(imagePath) : null
    return image ? { width: image.width, height: image.height } : null
  })

  function zoomScale(magnification: number): number {
    return Math.max(1, Math.min(5, gestureBaseScale.current * magnification))
  }

  function constrainedOffset(
    value: { x: number; y: number },
    zoom: number,
    viewport: { width: number; height: number },
  ) {
    const viewportWidth = Math.max(1, viewport.width)
    const viewportHeight = Math.max(1, viewport.height)
    let fittedWidth = viewportWidth
    let fittedHeight = viewportHeight
    if (imageSize?.width && imageSize.height) {
      const fit = Math.min(viewportWidth / imageSize.width, viewportHeight / imageSize.height)
      fittedWidth = imageSize.width * fit
      fittedHeight = imageSize.height * fit
    }
    const maxX = Math.max(0, (fittedWidth * zoom - viewportWidth) / 2)
    const maxY = Math.max(0, (fittedHeight * zoom - viewportHeight) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, value.x)),
      y: Math.max(-maxY, Math.min(maxY, value.y)),
    }
  }

  function magnifiedOffset(
    magnification: number,
    location: { x: number; y: number },
    viewport: { width: number; height: number },
  ) {
    const nextScale = zoomScale(magnification)
    const ratio = nextScale / gestureBaseScale.current
    const base = gestureBaseOffset.current
    return constrainedOffset({
      x: base.x * ratio + (location.x - viewport.width / 2) * (1 - ratio),
      y: base.y * ratio + (location.y - viewport.height / 2) * (1 - ratio),
    }, nextScale, viewport)
  }

  function close() {
    if (props.onClose) {
      props.onClose()
    } else {
      dismiss(null)
    }
  }

  const page = (
    <VStack
        navigationTitle={props.item.title || "图片"}
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility={props.embedded ? "visible" : undefined}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
        padding={16}
        toolbar={{
          topBarTrailing: <Button title="完成" action={close} />,
        }}
      >
        {imagePath ? (
          <GeometryReader>
            {(proxy) => (
              <ZStack
                frame={{ width: proxy.size.width, height: proxy.size.height, alignment: "center" as any }}
                clipped
                gesture={
                  MagnifyGesture(0.01)
                    .onChanged((value) => {
                      const nextScale = zoomScale(value.magnification)
                      setScale(nextScale)
                      setOffset(magnifiedOffset(value.magnification, value.startLocation, proxy.size))
                    })
                    .onEnded((value) => {
                      const nextScale = zoomScale(value.magnification)
                      const nextOffset = magnifiedOffset(value.magnification, value.startLocation, proxy.size)
                      gestureBaseScale.current = nextScale
                      gestureBaseOffset.current = nextOffset
                      setScale(nextScale)
                      setOffset(nextOffset)
                    })
                }
                simultaneousGesture={
                  DragGesture({ minDistance: 2, coordinateSpace: "local" })
                    .onChanged((value) => {
                      if (scale <= 1) return
                      setOffset(constrainedOffset({
                        x: gestureBaseOffset.current.x + value.translation.width,
                        y: gestureBaseOffset.current.y + value.translation.height,
                      }, scale, proxy.size))
                    })
                    .onEnded((value) => {
                      if (scale <= 1) {
                        gestureBaseOffset.current = { x: 0, y: 0 }
                        setOffset({ x: 0, y: 0 })
                        return
                      }
                      const nextOffset = constrainedOffset({
                        x: gestureBaseOffset.current.x + value.translation.width,
                        y: gestureBaseOffset.current.y + value.translation.height,
                      }, scale, proxy.size)
                      gestureBaseOffset.current = nextOffset
                      setOffset(nextOffset)
                    })
                }
              >
                <ZStack
                  scaleEffect={scale}
                  offset={offset}
                  frame={{ width: proxy.size.width, height: proxy.size.height, alignment: "center" as any }}
                >
                  <Image
                    filePath={imagePath}
                    resizable
                    scaleToFit
                    frame={{ width: proxy.size.width, height: proxy.size.height, alignment: "center" as any }}
                  />
                </ZStack>
              </ZStack>
            )}
          </GeometryReader>
        ) : (
          <Text foregroundStyle="secondaryLabel">图片文件不可读取</Text>
        )}
    </VStack>
  )

  return props.embedded ? page : <NavigationStack>{page}</NavigationStack>
}

export function AppRoot(props: { mode?: AppRootMode } = {}) {
  const mode = props.mode ?? "app"
  const homeScreenMode = mode === "home"
  const releaseNotesSheet = useReleaseNotesSheet({
    title: "CAIS 更新说明",
    detents: ["medium", "large"],
    // Legacy identifier retained so renaming the Markdown file does not reset read state.
    storageKey: "cais:release-notes:release-notes.md:last-seen-hash",
  })
  const colorScheme = useColorScheme()
  const activeTab = useObservable(readActiveTab())
  const pipPresented = useObservable(false)
  const toastPresented = useObservable(false)
  const [settings, setSettings] = useState<CaisSettings>(() => loadSettings())
  const [showLaunchSplash, setShowLaunchSplash] = useState(() => settings.launchAnimationEnabled)
  const [favoriteGroups, setFavoriteGroups] = useState<ClipGroup[]>([])
  const [clipboardGroups, setClipboardGroups] = useState<ClipGroup[]>([])
  const [clipKindCounts, setClipKindCounts] = useState<ClipKindCountsByScope>(EMPTY_CLIP_KIND_COUNTS)
  const [clipKindFilters, setClipKindFilters] = useState<Record<ClipListScope, ClipKindFilter>>({ favorites: null, clipboard: null })
  const [initialDataReady, setInitialDataReady] = useState(false)
  const [homeRoute, setHomeRoute] = useState<HomeRoute | null>(null)
  const [homeRoutePresented, setHomeRoutePresented] = useState(false)
  const [query, setQuery] = useState("")
  const settingsRef = useRef(settings)
  const queryRef = useRef(query)
  const clipKindFiltersRef = useRef(clipKindFilters)
  const homeRouteRef = useRef<HomeRoute | null>(null)
  const copyChangeSource = useRef({}).current
  const listRefreshBlocked = useRef(false)
  const listRefreshDeferred = useRef(false)
  const lastObservedPasteboardChangeCount = useRef<number | null>(null)
  const toastHideTimer = useRef<any>(null)
  const [appFullscreen, setAppFullscreen] = useState(() => readAppFullscreen(false))
  const [loading, setLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [lanShareStatus, setLanShareStatus] = useState<LanShareRuntimeStatus>(() => getLanShareRuntimeStatus(settings))
  const lanShareStatusRef = useRef(lanShareStatus)
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    active: false,
    lastMessage: "未启动",
    capturedCount: 0,
  })
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"
  const embeddedHomeNavigation = homeScreenMode && settings.homeScreenEmbeddedNavigation

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    writeActiveTab(activeTab.value)
  }, [activeTab.value])

  useEffect(() => {
    const previousResumeHandler = (globalThis as any)[CAIS_APP_RESUME_HANDLER]
    ;(globalThis as any)[CAIS_APP_RESUME_HANDLER] = handleScriptResume
    void boot()
    const removeMinimize = homeScreenMode ? undefined : Script.onMinimize?.(() => {
      if (intentionalMinimize) {
        intentionalMinimize = false
        return
      }
      Script.exit()
    })
    return () => {
      if (previousResumeHandler) {
        ;(globalThis as any)[CAIS_APP_RESUME_HANDLER] = previousResumeHandler
      } else {
        delete (globalThis as any)[CAIS_APP_RESUME_HANDLER]
      }
      removeMinimize?.()
      clearToastHideTimer()
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
    let stopped = false
    let lastSeenClipDataVersion = readClipDataVersion()
    let lastSeenDatabaseDataVersion: number | null = null
    let checkingDatabaseDataVersion = false
    let refreshQueued = false
    let refreshRequested = false
    let socket: WebSocket | null = null
    let socketKey = ""

    function scheduleRefresh() {
      if (stopped) return
      if (listRefreshBlocked.current) {
        listRefreshDeferred.current = true
        return
      }
      if (refreshQueued) {
        refreshRequested = true
        return
      }
      refreshQueued = true
      const run = () => {
        if (stopped) {
          refreshQueued = false
          return
        }
        void refresh(true, settingsRef.current).catch(() => {}).finally(() => {
          refreshQueued = false
          if (refreshRequested) {
            refreshRequested = false
            scheduleRefresh()
          }
        })
      }
      if ((globalThis as any).setTimeout) {
        ;(globalThis as any).setTimeout(run, 0)
      } else {
        run()
      }
    }

    function refreshForVersion(version: number, source?: unknown) {
      if (version <= lastSeenClipDataVersion) return
      lastSeenClipDataVersion = version
      if (source === copyChangeSource) return
      scheduleRefresh()
    }

    function checkDatabaseVersion() {
      if (checkingDatabaseDataVersion) return
      checkingDatabaseDataVersion = true
      void readDatabaseDataVersion().then((version) => {
        if (stopped) return
        if (lastSeenDatabaseDataVersion != null && version !== lastSeenDatabaseDataVersion) {
          scheduleRefresh()
        }
        lastSeenDatabaseDataVersion = version
      }).catch(() => {}).finally(() => {
        checkingDatabaseDataVersion = false
      })
    }

    function closeSocket() {
      const current = socket
      socket = null
      socketKey = ""
      try { current?.close() } catch {}
    }

    function connectSocket() {
      if (stopped) return
      const status = lanShareStatusRef.current
      if (status.state !== "running" && status.state !== "delegated") {
        closeSocket()
        return
      }
      if (typeof WebSocket !== "function") return
      const key = `${status.port}:${status.accessCode}`
      if (socket && socketKey === key) return
      closeSocket()
      try {
        const next = new WebSocket(`ws://127.0.0.1:${status.port}/ws?token=${encodeURIComponent(status.accessCode)}`)
        socket = next
        socketKey = key
        next.onmessage = (message) => {
          if (stopped) return
          try {
            const raw = typeof message === "string" ? message : message.toRawString("utf-8") ?? ""
            const value = JSON.parse(raw)
            if (value?.type === "connected" || value?.type === "dataChanged") {
              refreshForVersion(Number(value.version) || 0)
            }
          } catch {
          }
        }
        next.onerror = () => {
          try { next.close() } catch {}
        }
        next.onclose = () => {
          if (socket === next) {
            socket = null
            socketKey = ""
          }
        }
      } catch {
        closeSocket()
      }
    }

    const unsubscribe = subscribeClipDataChanges(refreshForVersion)
    const timer = (globalThis as any).setInterval?.(() => {
      checkDatabaseVersion()
      connectSocket()
    }, 700)
    return () => {
      stopped = true
      unsubscribe()
      closeSocket()
      if (timer) (globalThis as any).clearInterval?.(timer)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let reconciling = false

    async function reconcile() {
      if (stopped || reconciling) return
      reconciling = true
      try {
        const latest = loadSettings()
        const current = settingsRef.current
        if (
          latest.lanSharingEnabled !== current.lanSharingEnabled ||
          latest.lanSharingPort !== current.lanSharingPort
        ) {
          const merged = {
            ...current,
            lanSharingEnabled: latest.lanSharingEnabled,
            lanSharingPort: latest.lanSharingPort,
          }
          settingsRef.current = merged
          if (!stopped) setSettings(merged)
        }
        const status = await reconcileLanShareServer(latest)
        if (!stopped) publishLanShareStatus(status)
      } finally {
        reconciling = false
      }
    }

    void reconcile()
    const timer = (globalThis as any).setInterval?.(() => void reconcile(), 1500)
    return () => {
      stopped = true
      if (timer) (globalThis as any).clearInterval?.(timer)
      releaseLanShareServer()
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let checking = false
    let timer: any = null

    function schedule() {
      if (stopped) return
      const interval = Math.max(300, settingsRef.current.monitorIntervalMs || 500)
      timer = (globalThis as any).setTimeout?.(tick, interval)
    }

    function tick() {
      if (stopped) return
      if (checking) {
        schedule()
        return
      }
      checking = true
      void (async () => {
        try {
          await captureClipboardChangeAndRefresh()
        } finally {
          checking = false
          schedule()
        }
      })()
    }

    timer = (globalThis as any).setTimeout?.(tick, 500)
    return () => {
      stopped = true
      if (timer) (globalThis as any).clearTimeout?.(timer)
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
      await captureClipboardAndRefresh(settingsRef.current, true)
      if (Script.queryParameters?.pip === "1") {
        await activatePipFromApp()
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function captureClipboardAndRefresh(currentSettings = settingsRef.current, force = false) {
    await captureClipboardIfChanged(currentSettings, force)
    await refresh(true, currentSettings)
  }

  async function captureClipboardChangeAndRefresh() {
    if (pipPresented.value || appMonitorStopper) return
    const changed = await captureClipboardIfChanged(settingsRef.current)
    if (changed) {
      await refresh(true, settingsRef.current)
    }
  }

  async function captureClipboardIfChanged(currentSettings = settingsRef.current, force = false): Promise<boolean> {
    try {
      const changeCount = await currentChangeCount()
      if (!force && lastObservedPasteboardChangeCount.current === changeCount) return false
      lastObservedPasteboardChangeCount.current = changeCount
      const result = await captureCurrentClipboard(currentSettings)
      return result.status === "created" || result.status === "updated"
    } catch {
      return false
    }
  }

  function handleScriptResume(details: any = {}) {
    if (details.resumeFromMinimized) {
      intentionalMinimize = false
    }
    const pipCommand = details.queryParameters?.pip
    if (pipCommand === "0") {
      deactivatePipFromExternal({ exitAfter: true })
      return
    }
    if (pipCommand === "1") {
      void activatePipFromApp()
      return
    }
    void captureClipboardChangeAndRefresh()
  }

  async function refresh(_force = false, currentSettings = settings) {
    const generation = ++appRefreshGeneration
    const groupLimit = Math.min(currentSettings.maxItems, APP_GROUP_PAGE_SIZE)
    const search = queryRef.current.trim()
    const filters = clipKindFiltersRef.current
    const [nextFavoriteGroups, nextClipboardGroups, nextClipKindCounts] = await Promise.all([
      getClipGroups("favorites", search, groupLimit, 0, filters.favorites ?? undefined),
      getClipGroups("clipboard", search, groupLimit, 0, filters.clipboard ?? undefined),
      getClipKindCounts(),
    ])
    if (generation !== appRefreshGeneration) return
    setFavoriteGroups(nextFavoriteGroups)
    setClipboardGroups(nextClipboardGroups)
    setClipKindCounts(nextClipKindCounts)
    setInitialDataReady(true)
  }

  async function updateSettings(nextSettings: CaisSettings) {
    const previous = settingsRef.current
    const needsStorageMigration =
      previous.iCloudSync !== nextSettings.iCloudSync ||
      previous.iCloudSyncImages !== nextSettings.iCloudSyncImages
    try {
      if (needsStorageMigration) await applyICloudSyncSettings(previous, nextSettings)
      const next = saveSettings(nextSettings)
      settingsRef.current = next
      setSettings(next)
      if (
        previous.lanSharingEnabled !== next.lanSharingEnabled ||
        previous.lanSharingPort !== next.lanSharingPort
      ) {
        publishLanShareStatus(await reconcileLanShareServer(next))
      }
      void refresh(true, next)
    } catch (error: any) {
      await Dialog.alert({
        title: "iCloud 同步失败",
        message: String(error?.message ?? error ?? "数据迁移失败"),
      })
    }
  }

  function clearToastHideTimer() {
    if (toastHideTimer.current) {
      ;(globalThis as any).clearTimeout?.(toastHideTimer.current)
      toastHideTimer.current = null
    }
  }

  function showToast(message: string) {
    clearToastHideTimer()
    setToastMessage(message)
    toastPresented.setValue(false)
    ;(globalThis as any).setTimeout?.(() => {
      toastPresented.setValue(true)
    }, 0)
    toastHideTimer.current = (globalThis as any).setTimeout?.(() => {
      toastPresented.setValue(false)
      toastHideTimer.current = null
    }, TOAST_DURATION_MS)
  }

  function publishLanShareStatus(status: LanShareRuntimeStatus) {
    const current = lanShareStatusRef.current
    if (
      current.state === status.state &&
      current.port === status.port &&
      current.address === status.address &&
      current.accessUrl === status.accessUrl &&
      current.accessCode === status.accessCode &&
      current.message === status.message
    ) return
    lanShareStatusRef.current = status
    setLanShareStatus(status)
  }

  async function rotateLanShareToken() {
    rotateLanShareAccessToken()
    publishLanShareStatus(await reconcileLanShareServer(settingsRef.current))
    showToast("访问码已更新")
  }

  function toastOptions() {
    return {
      isPresented: toastPresented,
      message: toastMessage,
      duration: TOAST_DURATION_MS / 1000,
      position: "bottom" as any,
    }
  }

  function presentHomeRoute(route: HomeRoute) {
    homeRouteRef.current = route
    setHomeRoute(route)
    setHomeRoutePresented(true)
  }

  function takeHomeRoute(): HomeRoute | null {
    const route = homeRouteRef.current
    homeRouteRef.current = null
    setHomeRoutePresented(false)
    return route
  }

  async function persistNewContent(content: string) {
    const result = await addClipFromPayload(
      { kind: "text", text: content },
      { ...settingsRef.current, captureText: true },
    )
    if (result.status === "created" || result.status === "updated") {
      showToast(result.status === "created" ? "已保存" : "已更新")
      await refresh()
    } else {
      showToast(result.reason)
    }
  }

  async function openBlankEditor() {
    if (embeddedHomeNavigation) {
      presentHomeRoute({ kind: "addContent" })
      return
    }
    setLoading(true)
    try {
      const content = await Navigation.present<string | null>({
        element: (
          <ClipContentEditorView
            content=""
            navigationTitle="添加内容"
            iconOnlyToolbar
          />
        ),
        modalPresentationStyle: "pageSheet",
      })
      if (content == null) return
      await persistNewContent(content)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "保存失败") })
    } finally {
      setLoading(false)
    }
  }

  function moveCopiedItemToTop(item: ClipItem, copiedAt: number) {
    setClipboardGroups((current) => {
      let sourceGroupIndex = -1
      let sourceItemIndex = -1
      for (let groupIndex = 0; groupIndex < current.length; groupIndex += 1) {
        const itemIndex = current[groupIndex].items.findIndex((candidate) => candidate.id === item.id)
        if (itemIndex < 0) continue
        sourceGroupIndex = groupIndex
        sourceItemIndex = itemIndex
        break
      }
      const recentIndex = current.findIndex((group) => group.title === "最近内容")
      if (sourceGroupIndex < 0 || recentIndex < 0) return current

      const sourceItem = current[sourceGroupIndex].items[sourceItemIndex]
      const updatedItem = { ...sourceItem, updatedAt: copiedAt, lastCopiedAt: copiedAt }
      const groups = [...current]
      const recentItems = [...current[recentIndex].items]
      if (sourceGroupIndex === recentIndex) {
        recentItems.splice(sourceItemIndex, 1)
      } else {
        const sourceItems = [...current[sourceGroupIndex].items]
        sourceItems.splice(sourceItemIndex, 1)
        groups[sourceGroupIndex] = { ...current[sourceGroupIndex], items: sourceItems }
      }
      const insertIndex = updatedItem.pinned
        ? 0
        : recentItems.findIndex((candidate) => !candidate.pinned)
      recentItems.splice(insertIndex < 0 ? recentItems.length : insertIndex, 0, updatedItem)
      groups[recentIndex] = { ...current[recentIndex], items: recentItems }
      return groups
    })
  }

  async function copyItem(
    item: ClipItem,
    options: { notify?: boolean; refresh?: boolean; updateRecency?: boolean } = {},
  ): Promise<string | void> {
    try {
      const { notify = true, refresh: refreshNow = true, updateRecency = true } = options
      const fullContent = renderClipOutput(item, await getFullClipContent(item.id))
      await writeClipToPasteboard(item, fullContent)
      const copiedAt = updateRecency ? Date.now() : 0
      if (updateRecency && refreshNow) moveCopiedItemToTop(item, copiedAt)
      if (notify) showToast("已复制")
      if (notify && updateRecency && typeof (globalThis as any).setTimeout === "function") {
        await new Promise<void>((resolve) => (globalThis as any).setTimeout(resolve, 0))
      }
      if (updateRecency) await markCopied(item, copyChangeSource, copiedAt)
      if (refreshNow && !updateRecency) await refresh()
      return "已复制"
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "复制失败") })
    }
  }

  async function persistFavoriteFieldCopy(value: string) {
    try {
      await addClipFromPayload(
        { kind: "text", text: value },
        { ...settingsRef.current, captureText: true },
      )
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "记录复制内容失败") })
    }
  }

  async function copyFavoriteField(field: FavoriteField): Promise<string | void> {
    try {
      playCaisHaptic()
      const value = renderRuntimeTemplate(field.value)
      await writeTextToPasteboard(value)
      const run = () => void persistFavoriteFieldCopy(value)
      if ((globalThis as any).setTimeout) {
        ;(globalThis as any).setTimeout(run, 0)
      } else {
        run()
      }
      return `已复制：${field.name}`
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "复制失败") })
    }
  }

  async function openFavoriteFields(item: ClipItem) {
    const content = await getFullClipContent(item.id)
    const parsed = parseFavoriteFields(content, favoriteDelimiterForItem(item, settings.favoriteFieldDelimiter))
    if (parsed.errors.length) {
      await Dialog.alert({ title: "字段内容无法解析", message: parsed.errors[0] })
      return
    }
    if (embeddedHomeNavigation) {
      listRefreshBlocked.current = true
      presentHomeRoute({ kind: "favoriteFields", item, fields: parsed.fields })
      return
    }
    listRefreshBlocked.current = true
    try {
      await Navigation.present({
        element: (
          <FavoriteFieldsDetailView
            title={item.title}
            fields={parsed.fields}
            onCopy={copyFavoriteField}
            renderFieldContextMenu={renderFavoriteFieldContextMenu}
            onCopyAll={() => {
              playCaisHaptic()
              return copyItem(item, { notify: false, refresh: false, updateRecency: false })
            }}
          />
        ),
        modalPresentationStyle: "pageSheet",
      })
    } finally {
      await finishFavoriteFieldsNavigation()
    }
  }

  async function confirmDeleteItem(item: ClipItem) {
    setClipboardGroups((groups) => removingClipFromGroups(groups, item.id))
    setFavoriteGroups((groups) => removingClipFromGroups(groups, item.id))
    if (typeof (globalThis as any).setTimeout === "function") {
      await new Promise<void>((resolve) => (globalThis as any).setTimeout(resolve, 0))
    }
    try {
      await clearCurrentClipboardIfMatchesDeletedItem(item)
      await softDeleteClip(item)
    } catch (error: any) {
      await refresh()
      await Dialog.alert({ message: String(error?.message ?? error ?? "删除失败") })
    }
  }

  async function requestClear(scope: ClearScope) {
    const ok = await Dialog.confirm({
      title: `清空${clearScopeLabel(scope)}？`,
      message: "此操作无法撤销。",
      cancelLabel: "取消",
      confirmLabel: "清空",
    })
    if (!ok) return
    await clearData(scope)
  }

  function clearScopeLabel(scope: ClearScope): string {
    switch (scope) {
      case "favorites": return "收藏数据"
      case "recent": return "最近内容"
      case "threeDays": return "近三天剪贴板数据"
      case "sevenDays": return "近七天剪贴板数据"
      case "older": return "更早剪贴板数据"
    }
  }

  async function clearData(scope: ClearScope) {
    showToast("正在删除...")
    // Yield to let toast render before blocking on async work
    await new Promise((r) => (globalThis as any).setTimeout?.(r, 50))
    if (scope === "favorites") {
      await clearFavoriteClips()
      showToast("已清空收藏数据")
    } else {
      await clearClipboardClipsByRange(scope)
      showToast("已清空剪贴板数据")
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

  async function completeContentEdit(
    item: ClipItem,
    originalContent: string,
    initialChangeCount: number,
    nextContent: string | null,
  ) {
    let needsRefresh = false
    if (await currentChangeCount() !== initialChangeCount) {
      await captureCurrentClipboard(settingsRef.current)
      needsRefresh = true
    }
    if (nextContent != null && nextContent !== originalContent) {
      await editClipContent(item, nextContent, settingsRef.current.favoriteFieldDelimiter)
      needsRefresh = true
    }
    if (needsRefresh) await refresh()
  }

  async function runFavoriteMutation<T>(operation: () => Promise<T>): Promise<T> {
    const wasBlocked = listRefreshBlocked.current
    listRefreshBlocked.current = true
    try {
      const result = await operation()
      await refresh(true, settingsRef.current)
      return result
    } finally {
      listRefreshBlocked.current = wasBlocked
      if (!wasBlocked) listRefreshDeferred.current = false
    }
  }

  async function persistFavoriteDraft(item: ClipItem | undefined, result: FavoriteDraft) {
    await runFavoriteMutation(async () => {
      if (item) {
        await updateFavoriteFromInput(
          item,
          result.title,
          result.content,
          result.format,
          result.fieldDelimiter,
          settingsRef.current.favoriteFieldDelimiter,
          result.favoriteGroupId,
          result.favoriteGroupManual,
        )
      } else {
        await addFavoriteFromInput(result.title, result.content, {
          format: result.format,
          fieldDelimiter: result.fieldDelimiter,
          defaultFieldDelimiter: settingsRef.current.favoriteFieldDelimiter,
          favoriteGroupId: result.favoriteGroupId,
        })
      }
    })
    showToast(item ? "已保存收藏" : "已添加到收藏")
  }

  async function persistTokenResult(result: string) {
    await writeTextToPasteboard(result)
    await addClipFromPayload(
      { kind: "text", text: result },
      { ...settingsRef.current, captureText: true },
    )
    showToast("已复制")
    await refresh()
  }

  async function finishFavoriteFieldsNavigation() {
    listRefreshBlocked.current = false
    if (listRefreshDeferred.current) {
      listRefreshDeferred.current = false
      await refresh(true, settingsRef.current)
    }
  }

  async function closeHomeRoute() {
    const route = takeHomeRoute()
    if (!route) return
    await finishCanceledHomeRoute(route)
  }

  function homeRoutePresentationChanged(isPresented: boolean) {
    setHomeRoutePresented(isPresented)
    if (isPresented) return
    const route = homeRouteRef.current
    homeRouteRef.current = null
    setHomeRoute(null)
    if (route) void finishCanceledHomeRoute(route)
  }

  async function finishCanceledHomeRoute(route: HomeRoute) {
    try {
      if (route.kind === "editContent") {
        await completeContentEdit(route.item, route.content, route.initialChangeCount, null)
      } else if (route.kind === "favoriteFields") {
        await finishFavoriteFieldsNavigation()
      }
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "关闭页面失败") })
    }
  }

  async function editItem(item: ClipItem) {
    if (isFieldFavorite(item)) {
      await presentFavoriteEditor(item)
      return
    }
    if (item.kind === "image") {
      await Dialog.alert({ message: "图片条目暂不支持编辑文本内容" })
      return
    }
    const fullContent = await getFullClipContent(item.id)
    const initialChangeCount = await currentChangeCount()
    if (embeddedHomeNavigation) {
      presentHomeRoute({
        kind: "editContent",
        item,
        content: fullContent,
        initialChangeCount,
      })
      return
    }
    try {
      const nextContent = await Navigation.present<string | null>({
        element: <ClipContentEditorView content={fullContent} />,
        modalPresentationStyle: "pageSheet",
      })
      await completeContentEdit(item, fullContent, initialChangeCount, nextContent)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "编辑失败") })
    }
  }

  async function presentFavoriteEditor(item?: ClipItem, preferredFormat?: "plain" | "fields") {
    try {
      const sessionId = makeId("favorite-editor")
      const favoriteGroups = await getFavoriteGroupDefinitions()
      const initial: FavoriteDraft | undefined = item ? {
        title: item.title,
        content: await getFullClipContent(item.id),
        format: preferredFormat ?? (item.favoriteFormat === "fields" ? "fields" : "plain"),
        fieldDelimiter: item.fieldDelimiterOverride ? item.fieldDelimiter : undefined,
        favoriteGroupId: item.favoriteGroupId,
        favoriteGroupManual: item.favoriteGroupManual,
      } : undefined
      if (embeddedHomeNavigation) {
        presentHomeRoute({ kind: "favoriteEditor", sessionId, item, initial, preferredFormat, favoriteGroups })
        return
      }
      const result = await Navigation.present<FavoriteDraft | null>({
        element: (
          <FavoriteEditorView
            key={sessionId}
            initial={initial}
            preferredFormat={preferredFormat}
            favoriteGroups={favoriteGroups}
            defaultDelimiter={settingsRef.current.favoriteFieldDelimiter}
            onPreviewCopy={copyFavoriteField}
            renderFieldContextMenu={renderFavoriteFieldContextMenu}
            onEditContentInEditor={(value) => Navigation.present<string | null>({
              element: (
                <ClipContentEditorView
                  content={value}
                  navigationTitle="编辑收藏内容"
                />
              ),
              modalPresentationStyle: "pageSheet",
            })}
          />
        ),
        modalPresentationStyle: "pageSheet",
      })
      if (!result) return
      await persistFavoriteDraft(item, result)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "收藏保存失败") })
    }
  }

  async function persistFavoriteGroupDraft(draft: FavoriteGroupDraft) {
    const result = await runFavoriteMutation(
      () => createFavoriteGroup(draft.title, draft.ruleType, draft.pattern, draft.ignoreCase),
    )
    showToast(result.matchedCount
      ? `已创建分组，归类 ${result.matchedCount} 条`
      : "已创建分组，暂无匹配内容")
    return result.group
  }

  async function saveManagedFavoriteGroup(group: FavoriteGroup, draft: FavoriteGroupDraft) {
    const result = await runFavoriteMutation(
      () => saveFavoriteGroup(group, draft.title, draft.ruleType, draft.pattern, draft.ignoreCase),
    )
    showToast(result.matchedCount
      ? `已更新分组，归类 ${result.matchedCount} 条`
      : "已更新分组，暂无匹配内容")
    return result.group
  }

  async function deleteManagedFavoriteGroup(group: FavoriteGroup) {
    await runFavoriteMutation(() => removeFavoriteGroup(group))
    showToast("已删除收藏分组")
  }

  async function reorderManagedFavoriteGroups(groups: FavoriteGroup[]) {
    await runFavoriteMutation(() => reorderFavoriteGroups(groups.map((group) => group.id)))
  }

  async function presentFavoriteGroupEditor() {
    try {
      if (embeddedHomeNavigation) {
        presentHomeRoute({ kind: "favoriteGroupEditor" })
        return
      }
      const result = await Navigation.present<FavoriteGroupDraft | null>({
        element: <FavoriteGroupEditorView />,
        modalPresentationStyle: "pageSheet",
      })
      if (!result) return
      await persistFavoriteGroupDraft(result)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "收藏分组保存失败") })
    }
  }

  async function presentFavoriteGroupManager() {
    try {
      const groups = await getFavoriteGroupDefinitions()
      if (embeddedHomeNavigation) {
        presentHomeRoute({ kind: "favoriteGroupManager", groups })
        return
      }
      await Navigation.present({
        element: (
          <FavoriteGroupManagerView
            initialGroups={groups}
            onCreateGroup={persistFavoriteGroupDraft}
            onSaveGroup={saveManagedFavoriteGroup}
            onDeleteGroup={deleteManagedFavoriteGroup}
            onReorderGroups={reorderManagedFavoriteGroups}
          />
        ),
        modalPresentationStyle: "pageSheet",
      })
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分组管理打开失败") })
    }
  }

  async function toggleFavoriteWithType(item: ClipItem) {
    try {
      if (item.favorite || item.kind === "image") {
        await toggleFavorite(item)
        await refresh()
        return
      }
      const selected = await Dialog.actionSheet({
        title: "选择收藏类型",
        actions: [
          { label: "普通收藏" },
          { label: "字段收藏" },
        ],
      })
      if (selected == null) return
      if (selected === 1) {
        await presentFavoriteEditor(item, "fields")
        return
      }
      const content = await getFullClipContent(item.id)
      await updateFavoriteFromInput(
        item,
        item.title,
        content,
        "plain",
        undefined,
        settingsRef.current.favoriteFieldDelimiter,
      )
      showToast("已收藏")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "收藏失败") })
    }
  }

  async function viewImageItem(item: ClipItem) {
    if (embeddedHomeNavigation) {
      presentHomeRoute({ kind: "image", item })
      return
    }
    await Navigation.present({
      element: <ImageViewerView item={item} />,
      modalPresentationStyle: "pageSheet",
    })
  }

  async function extractTextFromImage(item: ClipItem) {
    try {
      showToast("正在提取文字...")
      const text = await recognizeTextFromImagePath(item.imagePath)
      if (!text) {
        showToast("未识别到文字")
        return
      }
      await writeTextToPasteboard(text)
      await addClipFromPayload(
        { kind: "text", text },
        { ...settingsRef.current, captureText: true },
      )
      showToast("已提取文字并复制")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "文字提取失败") })
    }
  }

  async function shareItem(item: ClipItem) {
    try {
      const value = item.kind === "image" ? item.imagePath : await itemSource(item)
      if (!value) {
        showToast("当前条目无法分享")
        return
      }
      await ShareSheet.present([value])
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分享失败") })
    }
  }

  async function itemSource(item: ClipItem): Promise<string> {
    if (item.kind === "image") return ""
    return renderClipOutput(item, await getFullClipContent(item.id))
  }

  async function openTokenResultForText(source: string) {
    try {
      const tokens = tokenizeWords(source)
      if (!tokens.length) {
        showToast("没有可用的分词结果")
        return
      }
      if (embeddedHomeNavigation) {
        presentHomeRoute({ kind: "tokens", tokens })
        return
      }
      const result = await Navigation.present<string | null>({
        element: <AppTokenResultView tokens={tokens} />,
        modalPresentationStyle: "pageSheet",
      })
      if (!result) return
      await persistTokenResult(result)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分词失败") })
    }
  }

  async function openTokenResultForItem(item: ClipItem) {
    if (item.kind === "image") {
      showToast("图片条目不支持分词")
      return
    }
    await openTokenResultForText(await itemSource(item))
  }

  async function saveTransformedResult(result: MenuActionResult, source: string): Promise<number> {
    const saveSettings = { ...settingsRef.current, captureText: true, captureImages: true }
    if (result.kind === "text") {
      if (!result.text.trim() || result.text === source) return 0
      const saved = await addClipFromPayload({ kind: "text", text: result.text }, saveSettings)
      return saved.status !== "skipped" ? 1 : 0
    }
    if (result.kind === "texts") {
      let savedCount = 0
      for (const text of result.texts) {
        if (!text.trim() || text === source) continue
        const saved = await addClipFromPayload({ kind: "text", text }, saveSettings)
        if (saved.status !== "skipped") savedCount += 1
      }
      return savedCount
    }
    if (result.kind === "image") {
      const saved = await addClipFromPayload({
        kind: "image",
        image: result.image,
        imageContentHash: result.imageContentHash,
      }, saveSettings)
      return saved.status !== "skipped" ? 1 : 0
    }
    return 0
  }

  async function copyMenuResult(result: MenuActionResult, source: string) {
    if (result.kind === "openUrl") {
      await Safari.openURL(result.url)
      return
    }
    if (result.kind === "none") {
      showToast(result.message ?? "没有返回内容")
      return
    }
    if (result.kind === "texts") {
      const saved = await saveTransformedResult(result, source)
      showToast(saved ? `已拆分保存 ${saved} 条` : "没有新的拆分结果")
      await refresh()
      return
    }
    if (result.kind === "text") {
      const shouldCopy = result.writeToClipboard !== false
      if (shouldCopy) await writeTextToPasteboard(result.text)
      const saved = await saveTransformedResult(result, source)
      showToast(saved ? (shouldCopy ? "已复制并保存" : "已保存") : (shouldCopy ? "已复制" : "已完成"))
      await refresh()
      return
    } else {
      await writeImageToPasteboard(result.image)
    }
    const saved = await saveTransformedResult(result, source)
    showToast(saved ? "已复制并保存" : "已复制")
    await refresh()
  }

  async function runBuiltinActionForItem(item: ClipItem, action: KeyboardMenuBuiltinAction) {
    try {
      const source = await itemSource(item)
      const result = applyBuiltinMenuAction({
        action,
        source,
        imagePath: item.imagePath,
        isImage: item.kind === "image",
      })
      if (!result) {
        showToast("当前条目不支持该功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`) })
    }
  }

  async function runCustomActionForItem(item: ClipItem, action: KeyboardCustomAction) {
    if (item.kind === "image") {
      showToast("当前条目不支持该自定义功能")
      return
    }
    try {
      const source = await itemSource(item)
      const result = await applyCustomMenuAction(action, source)
      if (!result) {
        showToast("当前条目不支持该自定义功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "自定义功能执行失败") })
    }
  }

  function favoriteFieldSource(field: FavoriteField): string {
    return renderRuntimeTemplate(field.value)
  }

  async function runBuiltinActionForFavoriteField(field: FavoriteField, action: KeyboardMenuBuiltinAction) {
    const source = favoriteFieldSource(field)
    if (!source) return
    if (action === "tokenize") {
      await openTokenResultForText(source)
      return
    }
    try {
      const result = applyBuiltinMenuAction({ action, source, isImage: false })
      if (!result) {
        showToast("当前子字段不支持该功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`) })
    }
  }

  async function runCustomActionForFavoriteField(field: FavoriteField, action: KeyboardCustomAction) {
    const source = favoriteFieldSource(field)
    if (!source) return
    try {
      const result = await applyCustomMenuAction(action, source)
      if (!result) {
        showToast("当前子字段不支持该自定义功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "自定义功能执行失败") })
    }
  }

  function renderFavoriteFieldContextMenu(field: FavoriteField, copy: () => void) {
    return (
      <FavoriteFieldActionMenu
        settings={settingsRef.current}
        supportsOpenUrl={isLikelyURL(favoriteFieldSource(field))}
        onCopy={copy}
        onBuiltin={(action) => runBuiltinActionForFavoriteField(field, action)}
        onCustom={(action) => runCustomActionForFavoriteField(field, action)}
      />
    )
  }

  function startPipMonitor() {
    const status = { active: true, lastMessage: "监听启动中", lastCheckedAt: Date.now(), capturedCount: 0 }
    setMonitorStatus(status)
    writePipControlState({ active: true, command: undefined })
    if (appMonitorStopper) return
    appMonitorStopper = startClipboardMonitor(settings, (next) => {
      setMonitorStatus(next)
      if (next.lastCapturedAt) {
        showToast(next.lastMessage)
        void refresh()
      }
    })
  }

  function stopPipMonitor() {
    if (appMonitorStopper) {
      appMonitorStopper()
      appMonitorStopper = null
    } else {
      stopClipboardMonitor()
    }
    setMonitorStatus({ active: false, lastMessage: "监听已停止", lastCheckedAt: Date.now(), capturedCount: 0 })
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
    if (options.exitAfter && !homeScreenMode) {
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

  function toggleFullscreenMode() {
    const next = !appFullscreen
    setAppFullscreen(next)
    writeAppFullscreen(next)
    void restartScript()
  }

  async function restartScript() {
    try {
      const url = Script.createRunURLScheme("CAIS", { restart: String(Date.now()) })
      const ok = await Safari.openURL(url)
      if (ok === false) {
        showToast("已保存显示模式，下次运行生效")
        return
      }
      Script.exit()
    } catch {
      showToast("已保存显示模式，下次运行生效")
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

  function renderClipRow(
    item: ClipItem,
    options: { allowDelete?: boolean; favoriteView?: boolean } = {},
  ) {
    const allowDelete = options.allowDelete ?? true
    const primaryTrailingAction = (
      <Button
        title=""
        systemImage={item.kind === "image" ? "photo" : "square.and.pencil"}
        tint={item.kind === "image" ? "systemBlue" : "systemOrange"}
        action={withHaptic(() => {
          if (item.kind === "image") {
            void viewImageItem(item)
          } else {
            void editItem(item)
          }
        })}
      />
    )

    return (
      <InteractiveClipRow
        key={item.id}
        item={item}
        allowDelete={allowDelete}
        onConfirmDelete={confirmDeleteItem}
        primaryTrailingAction={primaryTrailingAction}
        onTap={withHaptic(() => {
          if (isFieldFavorite(item)) {
            void openFavoriteFields(item)
          } else {
            const onFavoritesPage = activeTab.value === TAB_FAVORITES
            void copyItem(item, {
              refresh: !onFavoritesPage,
              updateRecency: !onFavoritesPage,
            })
          }
        })}
        contextMenuItems={(
          <Group>
            <ControlGroup controlSize="large">
              <Button title="增加标题" systemImage="textformat" action={() => void editItemTitle(item)} />
              {item.kind === "image" ? (
                <Button title="查看" systemImage="photo" action={() => void viewImageItem(item)} />
              ) : (
                <Button title="编辑" systemImage="square.and.pencil" action={() => void editItem(item)} />
              )}
              <Button title="分享" systemImage="square.and.arrow.up" action={() => void shareItem(item)} />
            </ControlGroup>
            <Divider />
            {item.favorite && item.kind !== "image" && !isFieldFavorite(item) ? (
              <Button
                title="转换为字段收藏"
                systemImage="list.bullet.rectangle"
                action={() => void presentFavoriteEditor(item, "fields")}
              />
            ) : null}
            {item.kind === "image" ? (
              <Button title="提取文字" systemImage="text.viewfinder" action={() => void extractTextFromImage(item)} />
            ) : null}
            {item.kind !== "image" && settings.keyboardMenu.builtins.tokenize ? (
              <Button title="分词" systemImage="text.magnifyingglass" action={() => void openTokenResultForItem(item)} />
            ) : null}
            {getOrderedMenuBuiltins(settings).map((action) => {
              const enabled = settings.keyboardMenu.builtins[action]
              const supported = action !== "tokenize" && (
                action === "base64Encode" ||
                (action === "openUrl" ? item.kind === "url" : item.kind !== "image")
              )
              return enabled && supported ? (
                <Button
                  key={action}
                  title={menuBuiltinTitle(action)}
                  systemImage={menuBuiltinSystemImage(action)}
                  action={() => void runBuiltinActionForItem(item, action)}
                />
              ) : null
            })}
            {item.kind !== "image" ? (
              settings.keyboardMenu.customActions
                .filter((action) => action.enabled)
                .map((action) => (
                  <Button
                    key={action.id}
                    title={action.title}
                    systemImage={customActionSystemImage(action)}
                    action={() => void runCustomActionForItem(item, action)}
                  />
                ))
            ) : null}
          </Group>
        )}
        leadingActions={[
          ...(item.manualFavorite ? [] : [
            <Button
              title=""
              systemImage={item.favorite ? "star.slash" : "star"}
              tint="systemYellow"
              action={() => void toggleFavoriteWithType(item)}
            />,
          ]),
          <Button
            title=""
            systemImage={item.pinned ? "pin.slash" : "pin"}
            tint="systemOrange"
            action={() => void togglePinned(item).then(() => refresh())}
          />,
        ]}
        content={settings.appClipRowGlassEffect ? (
          <ClipRow
            item={item}
            contentLineLimit={settings.appContentLineLimit}
            displayTimestamp={options.favoriteView ? item.favoriteUpdatedAt ?? item.updatedAt : undefined}
          />
        ) : (
          <NonGlassClipRow
            item={item}
            contentLineLimit={settings.appContentLineLimit}
            displayTimestamp={options.favoriteView ? item.favoriteUpdatedAt ?? item.updatedAt : undefined}
          />
        )}
      />
    )
  }

  function renderGroupedClipList(groups: ClipGroup[], emptyMessage: string, options: { allowDelete?: (item: ClipItem) => boolean } = {}) {
    if (!initialDataReady) return null
    if (!groups.some((group) => group.items.length)) {
      return (
        <Section
          listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
          listSectionSeparatorTint={{ color: "clear", edges: "all" as any }}
        >
          <EmptyState title="暂无内容" message={emptyMessage} systemImage="doc.on.clipboard" />
        </Section>
      )
    }
    return (
      <Group>
        {groups.filter((group) => group.items.length)
          .map((group) => (
            <Section
              key={group.title}
              header={<Text>{group.title}</Text>}
              listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
              listSectionSeparatorTint={{ color: "clear", edges: "all" as any }}
            >
              {group.items.map((item) => renderClipRow(item, { allowDelete: options.allowDelete?.(item) ?? true }))}
            </Section>
          ))}
      </Group>
    )
  }

  function renderFavoriteList() {
    if (!initialDataReady) return null
    const visibleGroups = favoriteGroups.filter((group) => group.items.length)
    if (!visibleGroups.length) {
      return (
        <Section
          listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
          listSectionSeparatorTint={{ color: "clear", edges: "all" as any }}
        >
          <EmptyState
            title="暂无内容"
            message={query.trim() ? "没有匹配的收藏内容。" : "点击右上角添加收藏，或右滑剪贴板条目点星标。"}
            systemImage="star"
          />
        </Section>
      )
    }
    return (
      <Group>
        {visibleGroups.map((group) => (
          <Section
            key={group.id ?? group.title}
            header={<Text>{group.title}</Text>}
            listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
            listSectionSeparatorTint={{ color: "clear", edges: "all" as any }}
          >
            {group.items.map((item) => renderClipRow(item, { favoriteView: true }))}
          </Section>
        ))}
      </Group>
    )
  }

  function toolbarLeading() {
    if (homeScreenMode) return undefined
    return (
      <HStack spacing={10}>
        <Button
          title=""
          systemImage="xmark.circle.fill"
          foregroundStyle="systemRed"
          action={withHaptic(() => Script.exit())}
        />
        {Script.supportsMinimization?.() ? (
          <Button
            title=""
            systemImage="minus.circle.fill"
            foregroundStyle="systemYellow"
            action={withHaptic(minimizeScript)}
          />
        ) : null}
        <Button
          title=""
          systemImage={appFullscreen ? "arrow.down.right.and.arrow.up.left.circle.fill" : "arrow.up.left.and.arrow.down.right.circle.fill"}
          foregroundStyle="systemBlue"
          action={withHaptic(toggleFullscreenMode)}
        />
      </HStack>
    )
  }

  function pagePicker() {
    return (
      <Picker
        title="页面"
        pickerStyle="segmented"
        value={activeTab.value}
        onChanged={(value: number) => activeTab.setValue(value)}
        frame={{ width: 220 }}
      >
        <Image tag={TAB_FAVORITES} systemName="star" />
        <Image tag={TAB_CLIPS} systemName="doc.on.clipboard" />
        <Image tag={TAB_SETTINGS} systemName="gearshape" />
      </Picker>
    )
  }

  function clipToolbarButtons() {
    return (
      <HStack spacing={10}>
        {pipToolbarButton()}
        <Button
          title=""
          systemImage="doc.badge.plus"
          disabled={loading}
          action={withHaptic(openBlankEditor)}
        />
      </HStack>
    )
  }

  function favoriteToolbarButtons() {
    return (
      <HStack spacing={10}>
        {pipToolbarButton()}
        {favoriteAddMenu()}
      </HStack>
    )
  }

  function favoriteAddMenu() {
    return (
      <Menu
        menuIndicator="hidden"
        label={<Image systemName="plus" accessibilityLabel="添加收藏" />}
      >
        <Button
          title="添加收藏分组"
          systemImage="folder.badge.plus"
          action={withHaptic(() => void presentFavoriteGroupEditor())}
        />
        <Button
          title="分组管理"
          systemImage="folder"
          action={withHaptic(() => void presentFavoriteGroupManager())}
        />
        <Button
          title="添加普通收藏"
          systemImage="star"
          action={withHaptic(() => void presentFavoriteEditor(undefined, "plain"))}
        />
        <Button
          title="添加字段收藏"
          systemImage="list.bullet.rectangle"
          action={withHaptic(() => void presentFavoriteEditor(undefined, "fields"))}
        />
      </Menu>
    )
  }

  function pipToolbarButton() {
    return (
      <Button
        title=""
        systemImage={pipPresented.value ? "pip.exit" : "pip.enter"}
        foregroundStyle={pipPresented.value ? "systemBlue" : undefined}
        action={withHaptic(togglePip)}
      />
    )
  }

  function settingsToolbarButtons() {
    return (
      <HStack spacing={10}>
        {pipToolbarButton()}
      </HStack>
    )
  }

  function searchPanel(scope: ClipListScope) {
    const outerPadding = homeScreenMode
      ? { top: 2, bottom: 4, leading: 16, trailing: 16 }
      : { top: 10, bottom: 6, leading: 16, trailing: 16 }
    const counts = clipKindCounts[scope]
    const metrics = [
      { systemName: "list.number", value: counts.total, kind: null },
      { systemName: "doc.text", value: counts.text, kind: "text" },
      { systemName: "link", value: counts.url, kind: "url" },
      { systemName: "photo", value: counts.image, kind: "image" },
    ]
    const filterOptions: Array<{ title: string; systemName: string; kind: ClipKindFilter }> = [
      { title: "所有", systemName: "list.number", kind: null },
      { title: "文本", systemName: "doc.text", kind: "text" },
      { title: "链接", systemName: "link", kind: "url" },
      { title: "图片", systemName: "photo", kind: "image" },
    ]

    function selectKindFilter(kind: ClipKindFilter) {
      if (clipKindFiltersRef.current[scope] === kind) return
      const next = { ...clipKindFiltersRef.current, [scope]: kind }
      clipKindFiltersRef.current = next
      setClipKindFilters(next)
      void refresh(true, settingsRef.current)
    }

    return (
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        padding={outerPadding}
        listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
      >
        <VStack
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}
          background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
          glassEffect={{ type: "rect", cornerRadius: 18 } as any}
        >
          <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
            <Image systemName="magnifyingglass" foregroundStyle="secondaryLabel" frame={{ width: 18 }} />
            <TextField title="" value={query} prompt="输入关键词" onChanged={setQuery} frame={{ maxWidth: "infinity" }} />
            {query.length === 0 ? (
              <Menu
                menuIndicator="hidden"
                label={
                  <HStack spacing={6} fixedSize={{ horizontal: true, vertical: false }}>
                    {metrics.map((metric) => (
                      <HStack
                        key={metric.systemName}
                        spacing={2}
                        foregroundStyle={clipKindFilters[scope] === metric.kind ? "systemBlue" : "secondaryLabel"}
                      >
                        <Image systemName={metric.systemName} font="caption2" />
                        <Text font="caption2" monospacedDigit>{metric.value}</Text>
                      </HStack>
                    ))}
                  </HStack>
                }
              >
                {filterOptions.map((option) => (
                  <Button
                    key={option.title}
                    title={option.title}
                    systemImage={option.systemName}
                    foregroundStyle={clipKindFilters[scope] === option.kind ? "systemBlue" : undefined}
                    action={withHaptic(() => selectKindFilter(option.kind))}
                  />
                ))}
              </Menu>
            ) : null}
          </HStack>
        </VStack>
      </VStack>
    )
  }

  function pipControlPanel() {
    if (!pipPresented.value) return null
    return (
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        padding={{ top: 10, bottom: 6, leading: 16, trailing: 16 }}
        listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
      >
        <VStack
          spacing={8}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}
          background={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 18 } }}
          glassEffect={{ type: "rect", cornerRadius: 18 } as any}
        >
          <Text
            font="headline"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            PiP 监听状态
          </Text>
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            [{formatDateTime(monitorStatus.lastCheckedAt)}] {monitorStatus.lastMessage} · 已复制 {monitorStatus.capturedCount ?? 0} 条
          </Text>
        </VStack>
      </VStack>
    )
  }

  function rootPresentationProps() {
    return {
      sheet: showLaunchSplash ? undefined : releaseNotesSheet,
      allowsHitTesting: !showLaunchSplash,
      overlay: showLaunchSplash ? <LaunchSplash onFinished={() => setShowLaunchSplash(false)} /> : undefined,
      ...(pipPresented.value ? {
        pip: {
          isPresented: pipPresented,
          maximumUpdatesPerSecond: 2,
          content: (
            <PipStatusView
              status={monitorStatus}
              onStart={startPipMonitor}
              onStop={stopPipMonitor}
            />
          ),
        },
      } : {}),
    }
  }

  function homeToolbarLeading() {
    return (
      <Button
        title={pipPresented.value ? "关闭 PiP" : "开启 PiP"}
        systemImage={pipPresented.value ? "pip.exit" : "pip.enter"}
        foregroundStyle={pipPresented.value ? "systemBlue" : undefined}
        action={withHaptic(togglePip)}
      />
    )
  }

  function homeToolbarTrailing() {
    return (
      <HStack spacing={8}>
        {activeTab.value === TAB_FAVORITES ? (
          favoriteAddMenu()
        ) : null}
        {activeTab.value !== TAB_FAVORITES ? (
          <Button
            title="采集剪贴板"
            systemImage="doc.badge.plus"
            disabled={loading}
            action={withHaptic(openBlankEditor)}
          />
        ) : null}
      </HStack>
    )
  }

  function homePageToolbar() {
    return {
      topBarLeading: homeToolbarLeading(),
      topBarTrailing: homeToolbarTrailing(),
      principal: pagePicker(),
    }
  }

  function renderHomeDestination() {
    if (!homeRoute) return <EmptyView />

    if (homeRoute.kind === "addContent") {
      return (
        <ClipContentEditorView
          content=""
          navigationTitle="添加内容"
          iconOnlyToolbar
          embedded
          onCancel={() => void closeHomeRoute()}
          onSave={(content) => {
            takeHomeRoute()
            setLoading(true)
            void persistNewContent(content)
              .catch((error: any) => Dialog.alert({ message: String(error?.message ?? error ?? "保存失败") }))
              .finally(() => setLoading(false))
          }}
        />
      )
    }

    if (homeRoute.kind === "editContent") {
      const route = homeRoute
      return (
        <ClipContentEditorView
          content={route.content}
          embedded
          onCancel={() => void closeHomeRoute()}
          onSave={(content) => {
            takeHomeRoute()
            void completeContentEdit(route.item, route.content, route.initialChangeCount, content)
              .catch((error: any) => Dialog.alert({ message: String(error?.message ?? error ?? "编辑失败") }))
          }}
        />
      )
    }

    if (homeRoute.kind === "favoriteEditor") {
      const route = homeRoute
      return (
        <FavoriteEditorView
          key={route.sessionId}
          initial={route.initial}
          preferredFormat={route.preferredFormat}
          favoriteGroups={route.favoriteGroups}
          defaultDelimiter={settingsRef.current.favoriteFieldDelimiter}
          onPreviewCopy={copyFavoriteField}
          renderFieldContextMenu={renderFavoriteFieldContextMenu}
          embedded
          onCancel={() => void closeHomeRoute()}
          onSave={(draft) => {
            void persistFavoriteDraft(route.item, draft)
              .then(() => takeHomeRoute())
              .catch((error: any) => Dialog.alert({ message: String(error?.message ?? error ?? "收藏保存失败") }))
          }}
          renderEmbeddedContentEditor={(content, onSave, onCancel) => (
            <ClipContentEditorView
              content={content}
              navigationTitle="编辑收藏内容"
              embedded
              onCancel={onCancel}
              onSave={onSave}
            />
          )}
        />
      )
    }

    if (homeRoute.kind === "favoriteGroupEditor") {
      return (
        <FavoriteGroupEditorView
          embedded
          onCancel={() => void closeHomeRoute()}
          onSave={async (draft) => {
            await persistFavoriteGroupDraft(draft)
            takeHomeRoute()
          }}
        />
      )
    }

    if (homeRoute.kind === "favoriteGroupManager") {
      return (
        <FavoriteGroupManagerView
          initialGroups={homeRoute.groups}
          embedded
          onCreateGroup={persistFavoriteGroupDraft}
          onSaveGroup={saveManagedFavoriteGroup}
          onDeleteGroup={deleteManagedFavoriteGroup}
          onReorderGroups={reorderManagedFavoriteGroups}
        />
      )
    }

    if (homeRoute.kind === "favoriteFields") {
      const route = homeRoute
      return (
        <FavoriteFieldsDetailView
          title={route.item.title}
          fields={route.fields}
          embedded
          onCopy={copyFavoriteField}
          renderFieldContextMenu={renderFavoriteFieldContextMenu}
          onCopyAll={() => {
            playCaisHaptic()
            return copyItem(route.item, { notify: false, refresh: false, updateRecency: false })
          }}
        />
      )
    }

    if (homeRoute.kind === "image") {
      return <ImageViewerView item={homeRoute.item} embedded onClose={() => void closeHomeRoute()} />
    }

    return (
      <AppTokenResultView
        tokens={homeRoute.tokens}
        embedded
        onCopySelection={(content) => {
          takeHomeRoute()
          void persistTokenResult(content)
            .catch((error: any) => Dialog.alert({ message: String(error?.message ?? error ?? "分词失败") }))
        }}
      />
    )
  }

  function renderHomeCurrentPage() {
    if (activeTab.value === TAB_FAVORITES) {
      return (
        <Form
          formStyle="grouped"
          listRowSpacing={10}
          contentMargins={APP_SCROLL_CONTENT_MARGINS}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          toast={toastOptions()}
        >
          {searchPanel("favorites")}
          {renderFavoriteList()}
        </Form>
      )
    }

    if (activeTab.value === TAB_SETTINGS) {
      return (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" as any }}
          toast={toastOptions()}
        >
          <SettingsView
            value={settings}
            onChanged={updateSettings}
            onClearFavorites={() => void requestClear("favorites")}
            onClearClipboard={(range) => void requestClear(range)}
            lanShareStatus={lanShareStatus}
            onRotateLanShareToken={() => void rotateLanShareToken()}
            embeddedNavigation={embeddedHomeNavigation}
          />
        </VStack>
      )
    }

    return (
      <Form
        formStyle="grouped"
        listRowSpacing={10}
        contentMargins={APP_SCROLL_CONTENT_MARGINS}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        toast={toastOptions()}
      >
        {pipControlPanel()}
        {searchPanel("clipboard")}
        {renderGroupedClipList(
          clipboardGroups,
          query.trim() ? "没有匹配的剪贴板内容。" : "点击右上角采集按钮，或开启 PiP 监听。",
          { allowDelete: (item) => !item.manualFavorite }
        )}
      </Form>
    )
  }

  if (homeScreenMode) {
    return (
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility="visible"
        toolbarTitleDisplayMode="inline"
        toolbar={homePageToolbar()}
        navigationDestination={embeddedHomeNavigation ? {
          isPresented: homeRoutePresented,
          onChanged: homeRoutePresentationChanged,
          content: renderHomeDestination(),
        } : undefined}
        {...rootPresentationProps()}
      >
        {renderHomeCurrentPage()}
      </VStack>
    )
  }

  return (
    <TabView
      selection={activeTab as any}
      tint="systemIndigo"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
      {...rootPresentationProps()}
    >
      <Tab title="收藏" systemImage="star" value={TAB_FAVORITES}>
        <NavigationStack>
          <Form
            formStyle="grouped"
            listRowSpacing={10}
            contentMargins={APP_SCROLL_CONTENT_MARGINS}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            toolbar={{ topBarLeading: toolbarLeading(), topBarTrailing: favoriteToolbarButtons() }}
            toast={toastOptions()}
          >
            {searchPanel("favorites")}
            {renderFavoriteList()}
          </Form>
        </NavigationStack>
      </Tab>

      <Tab title="剪贴板" systemImage="doc.on.clipboard" value={TAB_CLIPS}>
        <NavigationStack>
          <Form
            formStyle="grouped"
            listRowSpacing={10}
            contentMargins={APP_SCROLL_CONTENT_MARGINS}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            toolbar={{ topBarLeading: toolbarLeading(), topBarTrailing: clipToolbarButtons() }}
            toast={toastOptions()}
          >
            {pipControlPanel()}
            {searchPanel("clipboard")}
            {renderGroupedClipList(
              clipboardGroups,
              query.trim() ? "没有匹配的剪贴板内容。" : "点击右上角采集按钮，或开启 PiP 监听。",
              { allowDelete: (item) => !item.manualFavorite }
            )}
          </Form>
        </NavigationStack>
      </Tab>

      <Tab title="设置" systemImage="gearshape" value={TAB_SETTINGS}>
        <NavigationStack>
          <VStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" as any }}
            toast={toastOptions()}
          >
            <SettingsView
              value={settings}
              onChanged={updateSettings}
              onClearFavorites={() => void requestClear("favorites")}
              onClearClipboard={(range) => void requestClear(range)}
              lanShareStatus={lanShareStatus}
              onRotateLanShareToken={() => void rotateLanShareToken()}
              leadingToolbar={toolbarLeading()}
              trailingToolbar={settingsToolbarButtons()}
            />
          </VStack>
        </NavigationStack>
      </Tab>
    </TabView>
  )
}
