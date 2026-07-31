import {
  Button,
  DragGesture,
  HStack,
  Image,
  LazyVGrid,
  ScrollView,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import {
  imageForSticker,
  loadPacks,
  loadRecentStickers,
  loadSoundEnabled,
  loadTargetKeyboardScript,
  rememberRecentSticker,
} from "./storage"
import { prepareKeyboardFeedback, playKeyboardFeedback } from "./keyboardFeedback"
import type { CachedSticker, StickerPack } from "./types"

const GRID_COLUMNS = Array.from({ length: 4 }, () => ({
  size: { type: "flexible" as const, min: 0, max: "infinity" as const },
  spacing: 4,
}))
const CONTROL_GLASS = { type: "circle" } as any
const RECENT_PACK_NAME = "__recent__"
const SWIPE_THRESHOLD = 52
const STICKER_CORNER = { type: "rect", cornerRadius: 6 } as any
const CONTROL_BUTTON_SIZE = 56
const CONTROL_ICON_SIZE = 48
const KEYBOARD_EXIT_FEEDBACK_DELAY_MS = 70

function run() {
  const keyboard = (globalThis as any).CustomKeyboard
  if (!keyboard || typeof keyboard.present !== "function") {
    throw new Error("当前运行环境不支持自定义键盘")
  }

  try { keyboard.setToolbarVisible(false) } catch {}
  try { keyboard.setHasDictationKey?.(false) } catch {}
  keyboard.present(<KeyboardView />)
}

function KeyboardView() {
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [recentStickers, setRecentStickers] = useState<CachedSticker[]>([])
  const [activeName, setActiveName] = useState("")
  const [targetScript, setTargetScript] = useState("")
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [status, setStatus] = useState("")

  useEffect(() => {
    const loaded = loadPacks()
    const nextSoundEnabled = loadSoundEnabled()
    setPacks(loaded)
    setRecentStickers(loadRecentStickers())
    setTargetScript(loadTargetKeyboardScript())
    setSoundEnabled(nextSoundEnabled)
    setTimeout(() => prepareKeyboardFeedback({ soundEnabled: nextSoundEnabled }), 0)
    setActiveName((current) => current || loaded[0]?.name || RECENT_PACK_NAME)
  }, [])

  const recentPack = useMemo<StickerPack>(() => ({
    name: RECENT_PACK_NAME,
    title: "最近使用",
    importedAt: 0,
    sourceLink: "",
    stickers: recentStickers,
  }), [recentStickers])
  const displayPacks = useMemo(() => [recentPack, ...packs], [recentPack, packs])
  const activePack = displayPacks.find((pack) => pack.name === activeName) ?? packs[0] ?? recentPack
  const stickers = useMemo(() => activePack?.stickers ?? [], [activePack])

  async function handleStickerPress(sticker: CachedSticker) {
    feedback()
    if (sticker.kind === "static") {
      await copyImageSticker(sticker)
      return
    }
    setStatus("")
  }

  async function copyImageSticker(sticker: CachedSticker) {
    try {
      const image = imageForSticker(sticker.localPath)
      if (!image) {
        setStatus("")
        return
      }

      await Pasteboard.setImage(image)
      const pasted = await tryPasteIntoHost()
      setRecentStickers(rememberRecentSticker(sticker))
      setStatus(pasted ? "已复制并尝试粘贴" : "已复制到剪贴板")
    } catch {
      try { HapticFeedback.notificationError() } catch {}
      setStatus("")
    }
  }

  async function tryPasteIntoHost(): Promise<boolean> {
    const keyboard = (globalThis as any).CustomKeyboard
    for (const name of ["paste", "performPaste", "pasteFromPasteboard", "requestPaste"]) {
      const action = keyboard?.[name]
      if (typeof action !== "function") continue
      try {
        await action.call(keyboard)
        return true
      } catch {}
    }
    return false
  }

  async function switchToTargetScript() {
    const name = targetScript.trim()
    if (!name) return
    try {
      await CustomKeyboard.switchToScript(name)
    } catch {
      setStatus("")
    }
  }

  function feedback() {
    playKeyboardFeedback({ soundEnabled })
  }

  function withFeedback(action: () => void | Promise<void>, delayAction = false) {
    return () => {
      feedback()
      if (delayAction) {
        setTimeout(() => void action(), KEYBOARD_EXIT_FEEDBACK_DELAY_MS)
        return
      }
      void action()
    }
  }

  function switchGroup(offset: number) {
    if (displayPacks.length <= 1) return
    const currentIndex = Math.max(0, displayPacks.findIndex((pack) => pack.name === activePack.name))
    const nextIndex = (currentIndex + offset + displayPacks.length) % displayPacks.length
    setActiveName(displayPacks[nextIndex].name)
    feedback()
  }

  const swipeGesture = DragGesture({ minDistance: 28, coordinateSpace: "local" })
    .onEnded((details) => {
      const dx = Number(details.translation?.width ?? 0)
      const dy = Math.abs(Number(details.translation?.height ?? 0))
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < dy * 1.35) return
      switchGroup(dx < 0 ? 1 : -1)
    })

  if (!packs.length && !recentStickers.length) {
    return (
      <VStack spacing={8} padding={{ top: 18, bottom: 18, leading: 16, trailing: 16 }}>
        <Image systemName="tray" font="title2" foregroundStyle="secondaryLabel" />
        <Text foregroundStyle="secondaryLabel">先在主应用导入贴纸包</Text>
      </VStack>
    )
  }

  return (
    <VStack spacing={5} padding={{ top: 6, bottom: 6, leading: 6, trailing: 6 }}>
      <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
        <Button
          buttonStyle="plain"
          frame={{ width: CONTROL_BUTTON_SIZE, height: CONTROL_BUTTON_SIZE }}
          action={withFeedback(() => CustomKeyboard.dismissToHome(), true)}
        >
          <Image systemName="house" font={20} frame={{ width: CONTROL_ICON_SIZE, height: CONTROL_ICON_SIZE }} glassEffect={CONTROL_GLASS} />
        </Button>
        <Button
          buttonStyle="plain"
          frame={{ width: CONTROL_BUTTON_SIZE, height: CONTROL_BUTTON_SIZE }}
          action={withFeedback(() => CustomKeyboard.nextKeyboard(), true)}
        >
          <Image systemName="globe" font={20} frame={{ width: CONTROL_ICON_SIZE, height: CONTROL_ICON_SIZE }} glassEffect={CONTROL_GLASS} />
        </Button>
        {targetScript.trim() ? (
          <Button
            buttonStyle="plain"
            frame={{ width: CONTROL_BUTTON_SIZE, height: CONTROL_BUTTON_SIZE }}
            action={withFeedback(() => void switchToTargetScript(), true)}
          >
            <Image systemName="keyboard" font={20} frame={{ width: CONTROL_ICON_SIZE, height: CONTROL_ICON_SIZE }} glassEffect={CONTROL_GLASS} />
          </Button>
        ) : null}
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "trailing" as any }}>
          {status}
        </Text>
      </HStack>

      <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
        <HStack spacing={6}>
          {displayPacks.map((pack) => (
            <PackButton
              key={pack.name}
              pack={pack}
              active={pack.name === activePack.name}
              recent={pack.name === RECENT_PACK_NAME}
              onPress={withFeedback(() => setActiveName(pack.name))}
            />
          ))}
        </HStack>
      </ScrollView>

      <ScrollView
        axes="vertical"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={"rgba(0,0,0,0.001)" as any}
        contentShape="rect"
        simultaneousGesture={swipeGesture}
      >
        <LazyVGrid
          columns={GRID_COLUMNS}
          spacing={4}
          frame={{ maxWidth: "infinity" }}
          background={"rgba(0,0,0,0.001)" as any}
          contentShape="rect"
        >
          {stickers.map((sticker) => (
            <StickerKey
              key={sticker.id}
              sticker={sticker}
              action={() => handleStickerPress(sticker)}
            />
          ))}
        </LazyVGrid>
      </ScrollView>
    </VStack>
  )
}

function PackButton(props: {
  pack: StickerPack
  active: boolean
  recent?: boolean
  onPress: () => void
}) {
  const first = props.recent
    ? props.pack.stickers[0]
    : props.pack.stickers.find((sticker) => sticker.kind === "static") ?? props.pack.stickers[0]
  const image = first ? imageForSticker(first.thumbnailPath ?? first.localPath) : null
  const gifPath = first ? stickerGifPath(first) : undefined
  return (
    <Button
      action={props.onPress}
      tint={props.active ? "systemBlue" : "secondaryLabel"}
      frame={{ width: 42, height: 42 }}
    >
      <VStack
        padding={{ top: props.active ? 1 : 3, bottom: props.active ? 1 : 3, leading: props.active ? 1 : 3, trailing: props.active ? 1 : 3 }}
      >
        {props.recent && !first
          ? <Image systemName="clock.arrow.circlepath" font="title3" foregroundStyle="secondaryLabel" frame={{ width: 38, height: 38 }} />
          : <StickerImage image={image} gifPath={gifPath} kind={first?.kind ?? "unknown"} size={38} />
        }
      </VStack>
    </Button>
  )
}

function StickerKey(props: { sticker: CachedSticker; action: () => void | Promise<void> }) {
  const image = props.sticker.kind === "static"
    ? imageForSticker(props.sticker.thumbnailPath ?? props.sticker.localPath)
    : null
  const gifPath = stickerGifPath(props.sticker)
  return (
    <Button
      action={props.action}
      frame={{ maxWidth: "infinity", minHeight: 62 }}
    >
      <VStack spacing={1} padding={{ top: 3, bottom: 3, leading: 2, trailing: 2 }}>
        <StickerImage
          image={image}
          gifPath={gifPath}
          kind={props.sticker.kind}
          size={52}
        />
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
          {props.sticker.emoji || ""}
        </Text>
      </VStack>
    </Button>
  )
}

function stickerGifPath(sticker: CachedSticker): string | undefined {
  if (sticker.gifPath) return sticker.gifPath
  if (sticker.fileName.toLowerCase().endsWith(".gif")) return sticker.localPath
  return undefined
}

function StickerImage(props: {
  image: UIImage | null
  gifPath?: string
  kind: string
  size: number
}) {
  if (props.gifPath && FileManager.existsSync(props.gifPath)) {
    return (
      <Image
        filePath={props.gifPath}
        resizable
        scaleToFit
        frame={{ width: props.size, height: props.size }}
        clipShape={STICKER_CORNER}
      />
    )
  }
  if (props.image) {
    return (
      <Image
        image={props.image}
        resizable
        scaleToFit
        frame={{ width: props.size, height: props.size }}
        clipShape={STICKER_CORNER}
      />
    )
  }
  return (
    <Image
      systemName={props.kind === "animated" ? "sparkles" : props.kind === "video" ? "video" : "photo"}
      font="title3"
      foregroundStyle="secondaryLabel"
      frame={{ width: props.size, height: props.size }}
    />
  )
}

run()
