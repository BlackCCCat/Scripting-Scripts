import {
  Button,
  Device,
  ForEach,
  GeometryReader,
  Group,
  HStack,
  Image,
  LazyHGrid,
  LazyHStack,
  Picker,
  ProgressView,
  RoundedRectangle,
  Script,
  ScrollView,
  Spacer,
  Text,
  VStack,
  type Font,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting"

import type {
  CaisSettings,
  ClipItem,
  ClipListScope,
  KeyboardCustomAction,
  KeyboardMenuBuiltinAction,
  MonitorStatus,
} from "../types"
import { captureCurrentClipboard, startClipboardMonitor, stopClipboardMonitor } from "../services/clipboard_capture"
import { writeClipToPasteboard } from "../services/pasteboard_adapter"
import {
  addClipFromPayload,
  getClips,
  getFullClipContent,
  softDeleteClip,
  toggleFavorite,
  togglePinned,
} from "../storage/clip_repository"
import { readClipDataVersion } from "../storage/change_signal"
import { loadSettings } from "../storage/settings_store"
import { imagePreviewPath } from "../storage/image_store"
import { summarizeContent } from "../utils/common"
import { renderRuntimeTemplate } from "../utils/template"
import { PipStatusView } from "./PipStatusView"
import { readPipControlState, requestPipStart, requestPipStop } from "../services/pip_control"
import {
  applyBuiltinMenuAction,
  applyCustomMenuAction,
  customActionSystemImage,
  getOrderedMenuBuiltins,
  menuBuiltinSystemImage,
  menuBuiltinTitle,
  type MenuActionResult,
} from "../utils/menu_actions"

const TAB_FAVORITE = 0
const TAB_CLIPS = 1
const KEYBOARD_ROOT_SIDE_PADDING = 6
const CLIP_SCROLL_SIDE_PADDING = 8
const CLIP_GRID_SPACING = 10
const KEYBOARD_TILE_PREVIEW_LIMIT = 1200
const KEYBOARD_ROW_COUNT_KEY = "cais_keyboard_row_count_v1"
const SHARED_STORAGE_OPTIONS = { shared: true }
let deleteRepeatTimer: any = null
let lastInsertedText = ""
let lastPastedText = ""
let keyboardRefreshGeneration = 0
let keyboardLifecycleGeneration = 0
let activeKeyboardScope: ClipListScope = "clipboard"
let lastKeyboardItemsByScope: Record<ClipListScope, ClipItem[]> = { favorites: [], clipboard: [] }
let lastKeyboardItemsKeyByScope: Record<ClipListScope, string> = { favorites: "", clipboard: "" }
let lastKeyboardItemsVersionByScope: Record<ClipListScope, number> = { favorites: 0, clipboard: 0 }
let keyboardMonitorStopper: (() => void) | null = null
let keyboardMonitorStartTimer: any = null

export type KeyboardInitialState = {
  items: ClipItem[]
  settings: CaisSettings
  version: number
  loaded: boolean
  scope: ClipListScope
}

function keyboard(): any {
  return (globalThis as any).CustomKeyboard
}

function storage(): any {
  return (globalThis as any).Storage
}

function readKeyboardRowCount(): 1 | 2 {
  const st = storage()
  try {
    const raw = st?.get?.(KEYBOARD_ROW_COUNT_KEY, SHARED_STORAGE_OPTIONS) ?? st?.getString?.(KEYBOARD_ROW_COUNT_KEY, SHARED_STORAGE_OPTIONS)
    return Number(raw) === 1 ? 1 : 2
  } catch {
  }
  try {
    const raw = st?.get?.(KEYBOARD_ROW_COUNT_KEY) ?? st?.getString?.(KEYBOARD_ROW_COUNT_KEY)
    return Number(raw) === 1 ? 1 : 2
  } catch {
    return 2
  }
}

function writeKeyboardRowCount(value: 1 | 2) {
  const st = storage()
  try {
    if (typeof st?.set === "function") {
      st.set(KEYBOARD_ROW_COUNT_KEY, value)
      st.set(KEYBOARD_ROW_COUNT_KEY, value, SHARED_STORAGE_OPTIONS)
    } else if (typeof st?.setString === "function") {
      st.setString(KEYBOARD_ROW_COUNT_KEY, String(value))
      st.setString(KEYBOARD_ROW_COUNT_KEY, String(value), SHARED_STORAGE_OPTIONS)
    }
  } catch {
  }
}

function playClick() {
  try { keyboard()?.playInputClick?.() } catch {}
  try { 
    const haptic = (globalThis as any).HapticFeedback
    if (haptic?.lightImpact) haptic.lightImpact()
    else haptic?.mediumImpact?.()
  } catch {}
}

function insertKeyboardText(text: string) {
  if (!text) return
  keyboard()?.insertText?.(text)
  lastInsertedText = text
  lastPastedText = text
}

function returnKeySymbol(type?: string): string {
  switch (type) {
    case "search": return "magnifyingglass"
    case "send": return "paperplane.fill"
    case "go": return "arrow.right.circle.fill"
    case "done": return "checkmark"
    case "next": return "arrow.right"
    case "continue": return "arrow.right"
    default: return "return.left"
  }
}

function IconButton(props: {
  systemImage: string
  disabled?: boolean
  tint?: string
  frame?: any
  onPress: () => void | Promise<void>
  onLongPress?: () => void | Promise<void>
}) {
  const tint: any = props.disabled ? "secondaryLabel" : props.tint ?? "label"
  return (
    <RoundedRectangle
      cornerRadius={8}
      fill={props.disabled ? "tertiarySystemFill" : "secondarySystemFill"}
      frame={props.frame ?? { width: 34, height: 36 }}
      onTapGesture={() => {
        if (props.disabled) return
        playClick()
        void props.onPress()
      }}
      onLongPressGesture={props.onLongPress && !props.disabled ? {
        minDuration: 450,
        perform: () => {
          playClick()
          void props.onLongPress?.()
        },
      } : undefined}
      overlay={
        <Image
          systemName={props.systemImage}
          font="title3"
          foregroundStyle={tint}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
        />
      }
    />
  )
}

function BottomKey(props: {
  title?: string
  systemImage?: string
  width?: number
  onPress: () => void | Promise<void>
  onLongPress?: () => void
  onLongPressEnd?: () => void
}) {
  const frame = props.width
    ? { width: props.width, height: 42 }
    : { maxWidth: "infinity" as any, height: 42 }
  const fill: any = "secondarySystemFill"
  return (
    <RoundedRectangle
      cornerRadius={8}
      fill={fill}
      frame={frame}
      onTapGesture={() => {
        playClick()
        void props.onPress()
      }}
      onLongPressGesture={props.onLongPress ? {
        minDuration: 350,
        perform: props.onLongPress,
        onPressingChanged: (pressing: boolean) => {
          if (!pressing) props.onLongPressEnd?.()
        },
      } : undefined}
      overlay={
        <HStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}>
          {props.systemImage ? (
            <Image systemName={props.systemImage} font="title3" />
          ) : (
            <Text font="title3" lineLimit={1}>{props.title ?? ""}</Text>
          )}
        </HStack>
      }
    />
  )
}

function characterCount(value: string | null | undefined): number {
  return Array.from(String(value ?? "")).length
}

function clipTypeIcon(item: ClipItem): string {
  if (item.kind === "image") return "photo"
  const content = item.content.trim()
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(content)) return "number"
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return "envelope"
  if (
    item.kind === "url" ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(content) ||
    /^www\./i.test(content)
  ) return "link"
  return "doc.text"
}

function selectedKeyboardText(): string {
  return String(keyboard()?.selectedText ?? "")
}

function renderClipOutput(item: ClipItem, content: string): string {
  return item.manualFavorite ? renderRuntimeTemplate(content, selectedKeyboardText()) : content
}

function clipListKey(items: ClipItem[]): string {
  return items.map((item) => [
    item.id,
    item.updatedAt,
    item.favorite ? "f" : "",
    item.pinned ? "p" : "",
    item.manualFavorite ? "m" : "",
    item.contentHash,
    item.imagePath ?? "",
  ].join(":")).join("|")
}

function clipTileWidth(): number {
  const availableWidth = Device.screen.width - KEYBOARD_ROOT_SIDE_PADDING * 2 - CLIP_SCROLL_SIDE_PADDING * 2
  return Math.max(132, Math.floor((availableWidth - CLIP_GRID_SPACING) / 2))
}

type ClipTileMetrics = {
  padding: number
  spacing: number
  showTitle: boolean
  showFooter: boolean
  contentLineLimit: number
  contentPreviewLimit: number
  iconFont: Font
}

function clipTileMetrics(height: number, titleEnabled = true): ClipTileMetrics {
  const compact = height > 0 && height < 96
  const tiny = height > 0 && height < 76
  const minimal = height > 0 && height < 58
  const padding = minimal ? 6 : compact ? 8 : 10
  const spacing = minimal ? 2 : compact ? 4 : 6
  const showTitle = titleEnabled && !compact
  const showFooter = !minimal
  const reservedHeight =
    padding * 2 +
    (showTitle ? 21 + spacing : 0) +
    (showFooter ? 16 + spacing : 0)
  const dynamicLineLimit = Math.max(1, Math.floor(Math.max(0, height - reservedHeight) / 14))
  const contentLineLimit = minimal
    ? 1
    : tiny
      ? 1
      : Math.max(1, Math.min(dynamicLineLimit, 12))
  return {
    padding,
    spacing,
    showTitle,
    showFooter,
    contentLineLimit,
    contentPreviewLimit: KEYBOARD_TILE_PREVIEW_LIMIT,
    iconFont: tiny ? "caption2" : "caption",
  }
}

function queryLimitForKeyboard(settings: CaisSettings): number {
  return Math.max(1, Math.min(settings.keyboardMaxItems, settings.maxItems))
}

function keyboardScopeForTab(tab: number): ClipListScope {
  return tab === TAB_FAVORITE ? "favorites" : "clipboard"
}

function cachedKeyboardItems(scope: ClipListScope): ClipItem[] {
  return lastKeyboardItemsVersionByScope[scope] === readClipDataVersion() ? lastKeyboardItemsByScope[scope] : []
}

function rememberKeyboardItems(scope: ClipListScope, items: ClipItem[], version = readClipDataVersion()) {
  lastKeyboardItemsByScope[scope] = items
  lastKeyboardItemsKeyByScope[scope] = clipListKey(items)
  lastKeyboardItemsVersionByScope[scope] = version
}

export async function preloadKeyboardInitialState(): Promise<KeyboardInitialState> {
  const settings = loadSettings()
  const version = readClipDataVersion()
  const scope: ClipListScope = "clipboard"
  const items = await getClips("", queryLimitForKeyboard(settings), scope)
  rememberKeyboardItems(scope, items, version)
  return { items, settings, version, loaded: true, scope }
}

function ClipTile(props: {
  item: ClipItem
  settings: CaisSettings
  onInsert: (item: ClipItem) => void | Promise<void>
  onStatus: (message: string) => void
  onRefresh: () => void | Promise<void>
}) {
  const item = props.item
  const isImage = item.kind === "image"
  const previewPath = isImage ? imagePreviewPath(item.imagePath) : undefined
  return (
    <Button
      buttonStyle="plain"
      frame={{ width: clipTileWidth(), maxHeight: "infinity" as any }}
      action={() => {
        playClick()
        void props.onInsert(item)
      }}
      contextMenu={{
        menuItems: (
          <ClipTileMenu
            item={item}
            settings={props.settings}
            onRefresh={props.onRefresh}
            onStatus={props.onStatus}
          />
        ),
      }}
    >
      <RoundedRectangle
        cornerRadius={10}
        fill="systemBackground"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        clipShape={{ type: "rect", cornerRadius: 10 } as any}
        clipped
        overlay={
          <GeometryReader>
            {(proxy) => {
              const metrics = clipTileMetrics(proxy.size.height, props.settings.keyboardShowTitle)
              const showTitle = metrics.showTitle
              return (
                <VStack
                  frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
                  padding={metrics.padding}
                  spacing={metrics.spacing}
                  clipped
                >
                  {isImage && previewPath ? (
                    <Image
                      filePath={previewPath}
                      resizable
                      scaleToFit
                      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
                    />
                  ) : isImage ? (
                    <Image
                      systemName="photo"
                      font={proxy.size.height < 76 ? "title2" : "largeTitle"}
                      foregroundStyle="secondaryLabel"
                      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
                    />
                  ) : (
                    <>
                      {showTitle ? (
                        <Text
                          font="headline"
                          lineLimit={1}
                          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                          multilineTextAlignment="leading"
                        >
                          {item.title}
                        </Text>
                      ) : null}
                      <Text
                        font="caption"
                        foregroundStyle={showTitle ? "secondaryLabel" : "label"}
                        lineLimit={metrics.contentLineLimit}
                        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                        multilineTextAlignment="leading"
                      >
                        {summarizeContent(item.content, metrics.contentPreviewLimit)}
                      </Text>
                      <Spacer />
                    </>
                  )}
                  {metrics.showFooter ? (
                    <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                      <Image
                        systemName={clipTypeIcon(item)}
                        font={metrics.iconFont}
                        foregroundStyle="secondaryLabel"
                      />
                      <Spacer />
                      {item.pinned ? <Image systemName="pin.fill" font={metrics.iconFont} foregroundStyle="systemOrange" /> : null}
                      {item.favorite ? <Image systemName="star.fill" font={metrics.iconFont} foregroundStyle="systemYellow" /> : null}
                    </HStack>
                  ) : null}
                </VStack>
              )
            }}
          </GeometryReader>
        }
      />
    </Button>
  )
}

function ClipTileMenu(props: {
  item: ClipItem
  settings: CaisSettings
  onStatus: (message: string) => void
  onRefresh: () => void | Promise<void>
}) {
  const item = props.item
  const isImage = item.kind === "image"
  const builtins = props.settings.keyboardMenu.builtins

  async function copyItem() {
    try {
      const fullContent = isImage ? undefined : renderClipOutput(item, await getFullClipContent(item.id))
      await writeClipToPasteboard(item, fullContent)
      if (fullContent) lastPastedText = fullContent
      props.onStatus("已复制")
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "复制失败"))
    }
  }

  async function sourceText(): Promise<string> {
    let source = selectedKeyboardText()
    if (!source && !isImage) {
      source = renderClipOutput(item, await getFullClipContent(item.id))
    }
    return source
  }

  async function saveMenuResult(result: MenuActionResult, source: string) {
    const saveSettings = { ...props.settings, captureText: true, captureImages: true }
    if (result.kind === "text") {
      if (!result.text.trim() || result.text === source) return false
      const saved = await addClipFromPayload({ kind: "text", text: result.text }, saveSettings)
      await props.onRefresh()
      return saved.status !== "skipped"
    }
    if (result.kind === "image") {
      const saved = await addClipFromPayload({ kind: "image", image: result.image }, saveSettings)
      await props.onRefresh()
      return saved.status !== "skipped"
    }
    return false
  }

  async function handleMenuResult(result: MenuActionResult | null, source: string) {
    if (!result) {
      props.onStatus("当前条目不支持该功能")
      return
    }
    if (result.kind === "openUrl") {
      await Safari.openURL(result.url)
      return
    }
    if (result.kind === "text") {
      insertKeyboardText(result.text)
      const saved = await saveMenuResult(result, source)
      props.onStatus(saved ? "已上屏并保存" : "已上屏")
      return
    }
    await Pasteboard.setImage(result.image)
    const saved = await saveMenuResult(result, source)
    props.onStatus(saved ? "已写入剪贴板并保存" : "已写入剪贴板")
  }

  async function runBuiltinAction(action: KeyboardMenuBuiltinAction) {
    const source = await sourceText()
    if (!source && !(isImage && action === "base64Encode")) {
      props.onStatus("当前条目不支持该功能")
      return
    }
    if (isImage && action !== "base64Encode") {
      props.onStatus("当前条目不支持该功能")
      return
    }
    try {
      const result = applyBuiltinMenuAction({
        action,
        source,
        imagePath: item.imagePath,
        isImage,
      })
      await handleMenuResult(result, source)
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`))
    }
  }

  async function runCustomAction(action: KeyboardCustomAction) {
    const source = await sourceText()
    if (!source || isImage) {
      props.onStatus("当前条目不支持该自定义功能")
      return
    }
    try {
      await handleMenuResult(applyCustomMenuAction(action, source), source)
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "自定义功能执行失败"))
    }
  }

  async function toggleItemPinned() {
    await togglePinned(item)
    await props.onRefresh()
    props.onStatus(item.pinned ? "已取消置顶" : "已置顶")
  }

  async function toggleItemFavorite() {
    await toggleFavorite(item)
    await props.onRefresh()
    props.onStatus(item.favorite ? "已取消收藏" : "已收藏")
  }

  async function deleteItem() {
    await softDeleteClip(item)
    await props.onRefresh()
    props.onStatus(`已删除：${item.title}`)
  }

  function renderBuiltinAction(action: KeyboardMenuBuiltinAction) {
    switch (action) {
      case "base64Encode":
        return builtins.base64Encode ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "base64Decode":
        return !isImage && builtins.base64Decode ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "cleanWhitespace":
        return !isImage && builtins.cleanWhitespace ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "uppercase":
        return !isImage && builtins.uppercase ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "lowercase":
        return !isImage && builtins.lowercase ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "chineseAmount":
        return !isImage && builtins.chineseAmount ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "openUrl":
        return builtins.openUrl && item.kind === "url" ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      default:
        return null
    }
  }

  return (
    <Group>
      <Button title="复制" systemImage="doc.on.doc" action={() => void copyItem()} />
      <Button
        title={item.pinned ? "取消置顶" : "置顶"}
        systemImage={item.pinned ? "pin.slash" : "pin"}
        action={() => void toggleItemPinned()}
      />
      {!item.manualFavorite ? (
        <Button
          title={item.favorite ? "取消收藏" : "收藏"}
          systemImage={item.favorite ? "star.slash" : "star"}
          action={() => void toggleItemFavorite()}
        />
      ) : null}
      {getOrderedMenuBuiltins(props.settings).map((action) => renderBuiltinAction(action))}
      {!isImage ? (
        props.settings.keyboardMenu.customActions
          .filter((action) => action.enabled)
          .map((action) => (
            <Button
              key={action.id}
              title={action.title}
              systemImage={customActionSystemImage(action)}
              action={() => runCustomAction(action)}
            />
          ))
      ) : null}
      <Button title="删除" systemImage="trash" role="destructive" action={() => void deleteItem()} />
    </Group>
  )
}

export function KeyboardView(props: { initialState?: KeyboardInitialState } = {}) {
  const traits = keyboard()?.useTraits?.()
  const pipPresented = useObservable(false)
  const initialItems = props.initialState?.loaded && props.initialState.scope === "clipboard"
    ? props.initialState.items
    : cachedKeyboardItems("clipboard")
  const initialLoaded = Boolean(props.initialState?.loaded || initialItems.length)
  const [activeTab, setActiveTab] = useState(TAB_CLIPS)
  activeKeyboardScope = keyboardScopeForTab(activeTab)
  const [items, setItems] = useState<ClipItem[]>(() => initialItems)
  const [settings] = useState<CaisSettings>(() => props.initialState?.settings ?? loadSettings())
  const [clipRowCount, setClipRowCount] = useState<1 | 2>(() => readKeyboardRowCount())
  const [appPipActive, setAppPipActive] = useState(() => readPipControlState().active)
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    active: false,
    lastMessage: "未启动",
  })
  const didHandleInitialTabEffect = useRef(false)
  const [loading, setLoading] = useState(() => !initialLoaded)
  const visibleItems = useMemo(() => {
    return items.slice(0, settings.keyboardMaxItems)
  }, [items, settings.keyboardMaxItems])
  const clipGridRows = useMemo(() => {
    return Array.from({ length: clipRowCount }, () => ({ size: { type: "flexible" as const } }))
  }, [clipRowCount])

  useEffect(() => {
    const lifecycle = ++keyboardLifecycleGeneration
    void boot(lifecycle)
    let lastSeenClipDataVersion = props.initialState?.version ?? readClipDataVersion()
    const timer = (globalThis as any).setInterval?.(() => {
      const pipActive = readPipControlState().active
      setAppPipActive((current) => current === pipActive ? current : pipActive)
      const version = readClipDataVersion()
      if (version <= lastSeenClipDataVersion) return
      lastSeenClipDataVersion = version
      void refresh(true, lifecycle, activeKeyboardScope)
    }, 900)
    return () => {
      if (keyboardLifecycleGeneration === lifecycle) keyboardLifecycleGeneration += 1
      if (timer) (globalThis as any).clearInterval?.(timer)
      if (keyboardMonitorStartTimer) {
        ;(globalThis as any).clearTimeout?.(keyboardMonitorStartTimer)
        keyboardMonitorStartTimer = null
      }
      stopContinuousDelete()
      stopKeyboardMonitor()
    }
  }, [])

  useEffect(() => {
    if (!didHandleInitialTabEffect.current) {
      didHandleInitialTabEffect.current = true
      return
    }
    const lifecycle = keyboardLifecycleGeneration
    const scope = keyboardScopeForTab(activeTab)
    activeKeyboardScope = scope
    const cached = cachedKeyboardItems(scope)
    if (cached.length) {
      setItems(cached)
      setLoading(false)
    } else {
      setItems([])
      setLoading(true)
    }
    void refresh(true, lifecycle, scope).finally(() => {
      if (lifecycle === keyboardLifecycleGeneration && scope === activeKeyboardScope) setLoading(false)
    })
  }, [activeTab])

  function ensureKeyboardMonitor() {
    if (keyboardMonitorStopper) return
    keyboardMonitorStopper = startClipboardMonitor(settings, (next) => {
      if (next.lastCapturedAt) void refresh()
    })
  }

  function stopKeyboardMonitor() {
    keyboardMonitorStopper?.()
    keyboardMonitorStopper = null
  }

  function scheduleKeyboardMonitor(lifecycle: number) {
    if (keyboardMonitorStartTimer) {
      ;(globalThis as any).clearTimeout?.(keyboardMonitorStartTimer)
    }
    keyboardMonitorStartTimer = (globalThis as any).setTimeout?.(() => {
      keyboardMonitorStartTimer = null
      if (lifecycle !== keyboardLifecycleGeneration) return
      ensureKeyboardMonitor()
    }, 250)
  }

  async function boot(lifecycle: number) {
    if (!initialLoaded) setLoading(true)
    try {
      if (!initialLoaded) await refresh(true, lifecycle)
      if (lifecycle === keyboardLifecycleGeneration) scheduleKeyboardMonitor(lifecycle)
    } catch {
    } finally {
      if (lifecycle === keyboardLifecycleGeneration) setLoading(false)
    }
  }

  async function refresh(force = false, lifecycle = keyboardLifecycleGeneration, scope = activeKeyboardScope) {
    const generation = ++keyboardRefreshGeneration
    const next = await getClips("", queryLimitForKeyboard(settings), scope)
    if (lifecycle !== keyboardLifecycleGeneration) return
    if (generation !== keyboardRefreshGeneration) return
    const key = clipListKey(next)
    if (!force && key === lastKeyboardItemsKeyByScope[scope]) return
    rememberKeyboardItems(scope, next)
    if (scope !== activeKeyboardScope) return
    setItems(next)
  }

  function pasteLastContent() {
    const fallback = items.find((item) => item.kind !== "image")?.content ?? ""
    const text = lastPastedText || fallback
    if (!text) {
      return
    }
    insertKeyboardText(text)
  }

  function clearInput() {
    const kb = keyboard()
    const before = String(kb?.textBeforeCursor ?? "")
    const after = String(kb?.textAfterCursor ?? "")
    const total = characterCount(before) + characterCount(after)
    if (!total) {
      return
    }
    if (after) kb?.moveCursor?.(characterCount(after))
    for (let index = 0; index < total; index += 1) {
      deleteBackward()
    }
    lastInsertedText = ""
  }

  async function captureNow() {
    setLoading(true)
    try {
      await captureCurrentClipboard(settings)
      await refresh()
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function insertClip(item: ClipItem) {
    if (item.kind === "image") {
      try {
        await writeClipToPasteboard(item)
      } catch {
      }
      return
    }
    const fullContent = renderClipOutput(item, await getFullClipContent(item.id))
    insertKeyboardText(fullContent)
  }

  function deleteBackward() {
    keyboard()?.deleteBackward?.()
  }

  function startContinuousDelete() {
    stopContinuousDelete()
    deleteBackward()
    deleteRepeatTimer = (globalThis as any).setInterval?.(deleteBackward, 75)
  }

  function stopContinuousDelete() {
    if (!deleteRepeatTimer) return
    ;(globalThis as any).clearInterval?.(deleteRepeatTimer)
    deleteRepeatTimer = null
  }

  function undoInput() {
    if (!lastInsertedText) {
      return
    }
    for (let index = 0; index < Array.from(lastInsertedText).length; index += 1) {
      deleteBackward()
    }
    lastInsertedText = ""
  }

  function startPipMonitor() {
    const status = { active: true, lastMessage: "监听运行中", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
    ensureKeyboardMonitor()
  }

  function stopPipMonitor() {
    stopKeyboardMonitor()
    const status = { active: false, lastMessage: "监听已停止", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
  }

  function toggleClipLayout() {
    setClipRowCount((value) => {
      const next = value === 2 ? 1 : 2
      writeKeyboardRowCount(next)
      return next
    })
  }

  async function openPipInApp() {
    if (appPipActive) {
      requestPipStop()
      setAppPipActive(false)
      pipPresented.setValue(false)
      try {
        await Safari.openURL(Script.createRunURLScheme("CAIS", { pip: "0" }))
      } catch {
      }
      return
    }
    const url = Script.createRunURLScheme("CAIS", { pip: "1" })
    requestPipStart()
    setAppPipActive(true)
    pipPresented.setValue(true)
    const status = { active: true, lastMessage: "正在打开 CAIS 主应用", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
    try {
      const ok = await Safari.openURL(url)
      if (!ok) {
        startPipMonitor()
      }
    } catch {
      startPipMonitor()
    }
  }

  async function openCaisApp() {
    try {
      await Safari.openURL(Script.createRunURLScheme("CAIS"))
    } catch (error: any) {
      setMonitorStatus({
        active: Boolean(appPipActive),
        lastMessage: String(error?.message ?? error ?? "打开 CAIS 失败"),
        lastCheckedAt: Date.now(),
      })
    }
  }

  function sendReturn() {
    const kb = keyboard()
    if (typeof kb?.send === "function") {
      kb.send()
      return
    }
    kb?.insertText?.("\n")
  }

  return (
    <VStack
      spacing={7}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={{ top: 6, bottom: 6, leading: KEYBOARD_ROOT_SIDE_PADDING, trailing: KEYBOARD_ROOT_SIDE_PADDING }}
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
    >
      <HStack spacing={4} frame={{ maxWidth: "infinity", height: 36, alignment: "center" as any }}>
        <IconButton
          systemImage="house.fill"
          frame={{ width: 32, height: 36 }}
          onPress={() => keyboard()?.dismissToHome?.()}
          onLongPress={openCaisApp}
        />
        <Picker
          title=""
          pickerStyle="segmented"
          value={activeTab}
          onChanged={(index: number) => setActiveTab(index)}
          frame={{ minWidth: 112, maxWidth: "infinity", height: 36 }}
        >
          <Text tag={TAB_FAVORITE}>Favorite</Text>
          <Text tag={TAB_CLIPS}>Clips</Text>
        </Picker>
        <ScrollView
          axes="horizontal"
          scrollIndicator="hidden"
          scrollTargetBehavior="viewAlignedLimitAlwaysByOne"
          frame={{ width: 154, height: 36 }}
        >
          <LazyHStack spacing={6} frame={{ height: 36 }} scrollTargetlayout>
            <IconButton systemImage="doc.on.clipboard" onPress={pasteLastContent} />
            <IconButton systemImage="xmark.circle" onPress={clearInput} />
            <IconButton systemImage="square.and.arrow.down.on.square" disabled={loading} onPress={captureNow} />
            <IconButton systemImage="keyboard.chevron.compact.down" onPress={() => keyboard()?.dismiss?.()} />
            <IconButton
              systemImage={clipRowCount === 2 ? "square.grid.2x2" : "rectangle.split.3x1.fill"}
              onPress={toggleClipLayout}
            />
            <IconButton
              systemImage={appPipActive ? "pip.exit" : "pip.enter"}
              tint={appPipActive ? "systemBlue" : "label"}
              onPress={openPipInApp}
            />
          </LazyHStack>
        </ScrollView>
      </HStack>

      <ScrollView
        axes="horizontal"
        scrollIndicator="hidden"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={{ leading: CLIP_SCROLL_SIDE_PADDING, trailing: CLIP_SCROLL_SIDE_PADDING }}
      >
        {visibleItems.length ? (
          <LazyHGrid
            rows={clipGridRows}
            spacing={CLIP_GRID_SPACING}
            frame={{ maxHeight: "infinity" }}
          >
            <ForEach
              count={visibleItems.length}
              itemBuilder={(index) => {
                const item = visibleItems[index]
                return item ? (
                  <ClipTile
                    key={item.id}
                    item={item}
                    settings={settings}
                    onInsert={insertClip}
                    onRefresh={refresh}
                    onStatus={() => {}}
                  />
                ) : (null as any)
              }}
            />
          </LazyHGrid>
        ) : loading ? (
          <VStack
            frame={{ width: Math.max(300, Device.screen.width - 28), maxHeight: "infinity" as any, alignment: "center" as any }}
            spacing={8}
          >
            <ProgressView />
          </VStack>
        ) : (
          <VStack
            frame={{ width: Math.max(300, Device.screen.width - 28), maxHeight: "infinity" as any, alignment: "center" as any }}
            spacing={8}
          >
            <Image systemName={activeTab === TAB_FAVORITE ? "star" : "doc.on.clipboard"} font="largeTitle" foregroundStyle="secondaryLabel" />
            <Text foregroundStyle="secondaryLabel">
              {activeTab === TAB_FAVORITE ? "暂无收藏" : "暂无剪贴板记录"}
            </Text>
          </VStack>
        )}
      </ScrollView>

      <HStack spacing={6} frame={{ maxWidth: "infinity", height: 42 }}>
        <BottomKey systemImage="globe" width={46} onPress={() => keyboard()?.nextKeyboard?.()} />
        <BottomKey systemImage="arrow.uturn.backward" width={46} onPress={undoInput} />
        <BottomKey systemImage="space" onPress={() => keyboard()?.insertText?.(" ")} />
        <BottomKey
          systemImage="delete.left"
          width={46}
          onPress={deleteBackward}
          onLongPress={startContinuousDelete}
          onLongPressEnd={stopContinuousDelete}
        />
        <BottomKey
          title={undefined}
          systemImage={returnKeySymbol(traits?.returnKeyType)}
          width={76}
          onPress={sendReturn}
        />
      </HStack>
    </VStack>
  )
}
