import {
  Button,
  Device,
  ForEach,
  Group,
  HStack,
  Image,
  LazyHGrid,
  LazyHStack,
  Picker,
  RoundedRectangle,
  Script,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useEffect,
  useMemo,
  useObservable,
  useState,
} from "scripting"

import type {
  CaisSettings,
  ClipItem,
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
import { initializeDatabase } from "../storage/database"
import { readClipDataVersion } from "../storage/change_signal"
import { loadSettings } from "../storage/settings_store"
import { summarizeContent } from "../utils/common"
import { PipStatusView } from "./PipStatusView"
import { readPipControlState, requestPipStart, requestPipStop } from "../services/pip_control"

const TAB_FAVORITE = 0
const TAB_CLIPS = 1
const CONFIGURABLE_BUILTIN_ACTIONS: KeyboardMenuBuiltinAction[] = [
  "base64Encode",
  "base64Decode",
  "cleanWhitespace",
  "uppercase",
  "lowercase",
  "openUrl",
]
let deleteRepeatTimer: any = null
let lastInsertedText = ""
let lastPastedText = ""
let lastKeyboardItemsKey = ""
let keyboardRefreshGeneration = 0
let keyboardMonitorStopper: (() => void) | null = null

function keyboard(): any {
  return (globalThis as any).CustomKeyboard
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
}) {
  const tint: any = props.disabled ? "secondaryLabel" : props.tint ?? "label"
  return (
    <Button
      disabled={props.disabled}
      buttonStyle="plain"
      frame={props.frame ?? { width: 34, height: 36 }}
      action={() => {
        playClick()
        void props.onPress()
      }}
    >
      <RoundedRectangle
        cornerRadius={8}
        fill={props.disabled ? "tertiarySystemFill" : "secondarySystemFill"}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        overlay={
          <Image
            systemName={props.systemImage}
            font="title3"
            foregroundStyle={tint}
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
          />
        }
      />
    </Button>
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

function stripDataUri(value: string): string {
  return value.trim().replace(/^data:[^,]+,/, "")
}

function dataToRawText(data: Data | null): string | null {
  if (!data) return null
  return data.toRawString("utf-8")
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

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function templateVariables() {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return {
    date,
    time,
    datetime: `${date} ${time}`,
  }
}

function applyCustomTemplate(template: string, text: string): string {
  const values = templateVariables()
  return template
    .replace(/\{\{text\}\}/g, text)
    .replace(/\{\{date\}\}/g, values.date)
    .replace(/\{\{time\}\}/g, values.time)
    .replace(/\{\{datetime\}\}/g, values.datetime)
}

function makeRegex(pattern: string): RegExp {
  const trimmed = pattern.trim()
  const wrapped = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/)
  if (wrapped) return new RegExp(wrapped[1], wrapped[2])
  return new RegExp(trimmed)
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

function getOrderedKeyboardBuiltins(settings: CaisSettings): KeyboardMenuBuiltinAction[] {
  const order = settings.keyboardMenu.builtinOrder?.filter(
    (key) => CONFIGURABLE_BUILTIN_ACTIONS.includes(key)
  )
  if (!order?.length) return CONFIGURABLE_BUILTIN_ACTIONS
  const missing = CONFIGURABLE_BUILTIN_ACTIONS.filter((key) => !order.includes(key))
  return [...order, ...missing]
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
  return (
    <Button
      buttonStyle="plain"
      frame={{ width: 206, maxHeight: "infinity" as any }}
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
        overlay={
          <VStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
            padding={10}
            spacing={6}
          >
            {isImage && item.imagePath ? (
              <Image
                filePath={item.imagePath}
                resizable
                scaleToFit
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
              />
            ) : (
              <>
                <Text
                  font="headline"
                  lineLimit={1}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  multilineTextAlignment="leading"
                >
                  {item.title}
                </Text>
                <Text
                  font="caption"
                  foregroundStyle="secondaryLabel"
                  lineLimit={5}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  multilineTextAlignment="leading"
                >
                  {summarizeContent(item.content, 220)}
                </Text>
                <Spacer />
              </>
            )}
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Image
                systemName={clipTypeIcon(item)}
                font="caption"
                foregroundStyle="secondaryLabel"
              />
              <Spacer />
              {item.pinned ? <Image systemName="pin.fill" font="caption" foregroundStyle="systemOrange" /> : null}
              {item.favorite ? <Image systemName="star.fill" font="caption" foregroundStyle="systemYellow" /> : null}
            </HStack>
          </VStack>
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
      const fullContent = isImage ? undefined : await getFullClipContent(item.id)
      await writeClipToPasteboard(item, fullContent)
      if (fullContent) lastPastedText = fullContent
      props.onStatus("已复制")
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "复制失败"))
    }
  }

  async function insertTransformed(transform: (value: string) => string, emptyMessage: string) {
    let source = String(keyboard()?.selectedText ?? "")
    if (!source && !isImage) {
      source = await getFullClipContent(item.id)
    }
    if (!source || isImage) {
      props.onStatus(emptyMessage)
      return
    }
    insertKeyboardText(transform(source))
  }

  async function runCustomAction(action: KeyboardCustomAction) {
    let source = String(keyboard()?.selectedText ?? "")
    if (!source && !isImage) {
      source = await getFullClipContent(item.id)
    }
    if (!source || isImage) {
      props.onStatus("当前条目不支持该自定义功能")
      return
    }
    try {
      if (action.mode === "regex") {
        const pattern = String(action.regex ?? "").trim()
        if (!pattern) {
          props.onStatus("正则表达式为空")
          return
        }
        const match = source.match(makeRegex(pattern))
        if (!match) {
          props.onStatus("没有匹配结果")
          return
        }
        insertKeyboardText(match[1] ?? match[0])
        return
      }
      insertKeyboardText(applyCustomTemplate(action.template, source))
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

  async function encodeBase64() {
    try {
      if (isImage && item.imagePath) {
        const data = Data.fromFile(item.imagePath)
        if (!data) {
          props.onStatus("图片文件不可读取")
          return
        }
        insertKeyboardText(data.toBase64String())
        return
      }
      const fullContent = await getFullClipContent(item.id)
      const data = Data.fromRawString(fullContent, "utf-8")
      if (!data) {
        props.onStatus("文本无法编码")
        return
      }
      insertKeyboardText(data.toBase64String())
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "Base64 编码失败"))
    }
  }

  async function decodeBase64() {
    try {
      const fullContent = await getFullClipContent(item.id)
      const data = Data.fromBase64String(stripDataUri(fullContent))
      const text = dataToRawText(data)
      if (text) {
        insertKeyboardText(text)
        return
      }
      const image = UIImage.fromBase64String(stripDataUri(fullContent))
      if (!image) {
        props.onStatus("Base64 内容无法识别为文本或图片")
        return
      }
      await Pasteboard.setImage(image)
      await addClipFromPayload({ kind: "image", image }, loadSettings())
      await props.onRefresh()
      props.onStatus("已解码图片并写入剪贴板")
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "Base64 解码失败"))
    }
  }

  function renderBuiltinAction(action: KeyboardMenuBuiltinAction) {
    switch (action) {
      case "base64Encode":
        return builtins.base64Encode ? (
          <Button key={action} title="Base64 编码" systemImage="curlybraces.square" action={() => void encodeBase64()} />
        ) : null
      case "base64Decode":
        return !isImage && builtins.base64Decode ? (
          <Button key={action} title="Base64 解码" systemImage="arrow.down.doc" action={() => void decodeBase64()} />
        ) : null
      case "cleanWhitespace":
        return !isImage && builtins.cleanWhitespace ? (
          <Button
            key={action}
            title="移除空格"
            systemImage="text.badge.checkmark"
            action={() => insertTransformed((value) => value.replace(/\s+/g, ""), "没有可处理文本")}
          />
        ) : null
      case "uppercase":
        return !isImage && builtins.uppercase ? (
          <Button
            key={action}
            title="转为大写"
            systemImage="textformat.size.larger"
            action={() => insertTransformed((value) => value.toUpperCase(), "没有可转换文本")}
          />
        ) : null
      case "lowercase":
        return !isImage && builtins.lowercase ? (
          <Button
            key={action}
            title="转为小写"
            systemImage="textformat.size.smaller"
            action={() => insertTransformed((value) => value.toLowerCase(), "没有可转换文本")}
          />
        ) : null
      case "openUrl":
        return builtins.openUrl && item.kind === "url" ? (
          <Button
            key={action}
            title="打开链接"
            systemImage="safari"
            action={async () => {
              const fullContent = await getFullClipContent(item.id)
              await Safari.openURL(fullContent)
            }}
          />
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
      {getOrderedKeyboardBuiltins(props.settings).map((action) => renderBuiltinAction(action))}
      {!isImage ? (
        props.settings.keyboardMenu.customActions
          .filter((action) => action.enabled)
          .map((action) => (
            <Button
              key={action.id}
              title={action.title}
              systemImage={action.mode === "regex" ? "text.magnifyingglass" : "wand.and.stars"}
              action={() => runCustomAction(action)}
            />
          ))
      ) : null}
      <Button title="删除" systemImage="trash" role="destructive" action={() => void deleteItem()} />
    </Group>
  )
}

export function KeyboardView() {
  const traits = keyboard()?.useTraits?.()
  const pipPresented = useObservable(false)
  const [activeTab, setActiveTab] = useState(TAB_CLIPS)
  const [items, setItems] = useState<ClipItem[]>([])
  const [settings] = useState<CaisSettings>(() => loadSettings())
  const [clipRowCount, setClipRowCount] = useState<1 | 2>(2)
  const [appPipActive, setAppPipActive] = useState(() => readPipControlState().active)
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    active: false,
    lastMessage: "未启动",
  })
  const [loading, setLoading] = useState(false)
  const visibleItems = useMemo(() => {
    const active = activeTab === TAB_FAVORITE
      ? items.filter((item) => item.favorite)
      : items.filter((item) => !item.manualFavorite)
    return active.slice(0, settings.keyboardMaxItems)
  }, [activeTab, items, settings.keyboardMaxItems])
  const clipGridRows = useMemo(() => {
    return Array.from({ length: clipRowCount }, () => ({ size: { type: "flexible" as const } }))
  }, [clipRowCount])

  useEffect(() => {
    void boot()
    let lastSeenClipDataVersion = readClipDataVersion()
    const timer = (globalThis as any).setInterval?.(() => {
      setAppPipActive(readPipControlState().active)
      const version = readClipDataVersion()
      if (version <= lastSeenClipDataVersion) return
      lastSeenClipDataVersion = version
      void refresh(true)
    }, 700)
    return () => {
      if (timer) (globalThis as any).clearInterval?.(timer)
      stopContinuousDelete()
      stopKeyboardMonitor()
    }
  }, [])

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

  async function boot() {
    setLoading(true)
    try {
      lastKeyboardItemsKey = ""
      await initializeDatabase()
      ensureKeyboardMonitor()
      await refresh(true)
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function refresh(force = false) {
    const generation = ++keyboardRefreshGeneration
    const next = await getClips("", Math.min(Math.max(settings.keyboardMaxItems, 50), settings.maxItems))
    if (generation !== keyboardRefreshGeneration) return
    const key = clipListKey(next)
    if (!force && key === lastKeyboardItemsKey) return
    lastKeyboardItemsKey = key
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
    const fullContent = await getFullClipContent(item.id)
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
    setClipRowCount((value) => value === 2 ? 1 : 2)
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
      padding={{ top: 6, bottom: 6, leading: 6, trailing: 6 }}
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
        padding={{ leading: 8, trailing: 8 }}
      >
        {visibleItems.length ? (
          <LazyHGrid
            rows={clipGridRows}
            spacing={10}
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
