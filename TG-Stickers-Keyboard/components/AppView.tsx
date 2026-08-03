import {
  Button,
  DirectoryBrowserView,
  Form,
  HStack,
  Image,
  LazyVGrid,
  Menu,
  Navigation,
  NavigationStack,
  ProgressView,
  ScrollView,
  SecureField,
  Section,
  Script,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import {
  imageForSticker,
  createThumbnail,
  ensureThumbnailDirectory,
  loadBotToken,
  loadDynamicStickersEnabled,
  loadPacks,
  loadSoundEnabled,
  loadTargetKeyboardScript,
  removePackDirectories,
  saveBotToken,
  saveDynamicStickersEnabled,
  savePacks,
  saveSoundEnabled,
  saveTargetKeyboardScript,
  stickersDirectory,
  thumbnailLocalPath,
} from "../storage"
import { downloadStickerSelection, fetchStickerSetPreview } from "../telegram"
import { clearStickersFromAlbum, saveStickersToAlbum } from "../photoAlbum"
import type { CachedSticker, ImportProgress, PreviewSticker, StickerPack, StickerPackPreview } from "../types"
import { useMarkdownReleaseNotesSheet } from "./ReleaseNotesSheet"

const CARD = { type: "rect", cornerRadius: 12 } as any
const TILE = { type: "rect", cornerRadius: 12 } as any
const GRID_COLUMNS = Array.from({ length: 4 }, () => ({
  size: { type: "flexible" as const, min: 0, max: "infinity" as const },
  spacing: 6,
}))

export function AppView() {
  const [botToken, setBotToken] = useState("")
  const [targetScript, setTargetScript] = useState("")
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [dynamicStickersEnabled, setDynamicStickersEnabled] = useState(false)
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [status, setStatus] = useState("正在读取本地贴纸")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showImporter, setShowImporter] = useState(false)
  const [importRequest, setImportRequest] = useState({ link: "", id: 0 })
  const [showFolder, setShowFolder] = useState(false)
  const [managePackName, setManagePackName] = useState<string | null>(null)
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "release-notes.md",
    storageKey: "tg-stickers-keyboard:release-notes:last-seen-hash",
    title: "更新说明",
  })

  useEffect(() => {
    const token = loadBotToken()
    setBotToken(token)
    setTargetScript(loadTargetKeyboardScript())
    setSoundEnabled(loadSoundEnabled())
    setDynamicStickersEnabled(loadDynamicStickersEnabled())
    const loaded = loadPacks()
    setPacks(loaded)
    setStatus(token ? (loaded.length ? "贴纸已准备好" : "点击右上角添加贴纸") : "未设置 Bot Token，请先打开右上角设置")
    void reconcilePacks(loaded)
  }, [])

  async function reconcilePacks(sourcePacks = packs) {
    let changed = false
    const nextPacks: StickerPack[] = []
    for (const pack of sourcePacks) {
      await ensureThumbnailDirectory(pack.name)
      const stickers: CachedSticker[] = []
      for (const sticker of pack.stickers) {
        if (!(await FileManager.exists(sticker.localPath))) {
          changed = true
          continue
        }

        if (sticker.kind === "static" && !sticker.thumbnailPath) {
          const thumbnailPath = await createThumbnail(
            sticker.localPath,
            thumbnailLocalPath(pack.name, sticker.fileUniqueId),
          )
          stickers.push({ ...sticker, thumbnailPath })
          changed = true
        } else {
          stickers.push(sticker)
        }
      }
      if (stickers.length === 0) {
        await removePackDirectories(pack.name)
        changed = true
      } else {
        nextPacks.push({ ...pack, stickers })
      }
    }
    if (changed) {
      setPacks(nextPacks)
      savePacks(nextPacks)
      setStatus("已同步本地贴纸目录")
    }
  }

  function saveSettings(
    nextToken: string,
    nextTargetScript: string,
    nextSoundEnabled: boolean,
    nextDynamicStickersEnabled: boolean,
  ) {
    setBotToken(nextToken)
    setTargetScript(nextTargetScript)
    setSoundEnabled(nextSoundEnabled)
    setDynamicStickersEnabled(nextDynamicStickersEnabled)
    saveBotToken(nextToken)
    saveTargetKeyboardScript(nextTargetScript)
    saveSoundEnabled(nextSoundEnabled)
    saveDynamicStickersEnabled(nextDynamicStickersEnabled)
    setStatus(nextToken.trim() ? "设置已保存" : "未设置 Bot Token，请先打开右上角设置")
    setShowSettings(false)
  }

  async function importSelection(preview: StickerPackPreview, selectedIds: string[]) {
    if (!botToken.trim()) {
      setStatus("未设置 Bot Token，请先打开右上角设置")
      return
    }
    if (selectedIds.length === 0) {
      setStatus("没有选择贴纸")
      return
    }

    setShowImporter(false)
    setBusy(true)
    setProgress({ current: 0, total: selectedIds.length, message: "准备下载" })

    let keepAliveStarted = false
    try {
      try { keepAliveStarted = await BackgroundKeeper.keepAlive() } catch {}
      const pack = await downloadStickerSelection(botToken, preview, selectedIds, (next) => {
        setProgress(next)
        setStatus(next.message)
      }, dynamicStickersEnabled)
      const existing = packs.find((item) => item.name === pack.name)
      const mergedPack = existing ? mergePack(existing, pack) : pack
      const next = [mergedPack, ...packs.filter((item) => item.name !== pack.name)]
      setPacks(next)
      savePacks(next)
      setStatus(existing
        ? `已追加 ${pack.title}，本组共 ${mergedPack.stickers.length} 个贴纸`
        : `已导入 ${pack.title}，共 ${pack.stickers.length} 个贴纸`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败")
    } finally {
      if (keepAliveStarted) {
        try { await BackgroundKeeper.stopKeepAlive() } catch {}
      }
      setBusy(false)
      setProgress(null)
    }
  }

  async function removePack(pack: StickerPack) {
    const next = packs.filter((item) => item.name !== pack.name)
    await removePackDirectories(pack.name)
    setPacks(next)
    savePacks(next)
    setStatus(`已移除 ${pack.title}`)
  }

  function updatePack(nextPack: StickerPack) {
    if (nextPack.stickers.length === 0) {
      void removePack(nextPack)
      return
    }
    const next = packs.map((pack) => pack.name === nextPack.name ? nextPack : pack)
    setPacks(next)
    savePacks(next)
    setStatus(`已更新 ${nextPack.title}`)
  }

  const managePack = managePackName ? packs.find((pack) => pack.name === managePackName) ?? null : null
  const sheet = [
    releaseNotesSheet,
    {
      isPresented: showSettings,
      onChanged: setShowSettings,
      content: (
        <SettingsSheet
          botToken={botToken}
          targetScript={targetScript}
          soundEnabled={soundEnabled}
          dynamicStickersEnabled={dynamicStickersEnabled}
          onCancel={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      ),
    },
    {
      isPresented: showImporter,
      onChanged: setShowImporter,
      content: (
        <ImportSheet
          botToken={botToken}
          dynamicStickersEnabled={dynamicStickersEnabled}
          initialLink={importRequest.link}
          requestId={importRequest.id}
          onTokenMissing={() => {
            setShowImporter(false)
            setShowSettings(true)
            setStatus("未设置 Bot Token，请先保存设置")
          }}
          onImport={(preview, selectedIds) => void importSelection(preview, selectedIds)}
        />
      ),
    },
    {
      isPresented: showFolder,
      onChanged: setShowFolder,
      content: (
        <NavigationStack>
          <DirectoryBrowserView
            title="stickers"
            directoryPath={stickersDirectory()}
            onFilesChanged={() => void reconcilePacks()}
          />
        </NavigationStack>
      ),
    },
    {
      isPresented: !!managePack,
      onChanged: (value: boolean) => {
        if (!value) setManagePackName(null)
      },
      content: managePack ? (
        <PackManageSheet
          pack={managePack}
          onCancel={() => setManagePackName(null)}
          onSave={(nextPack) => {
            updatePack(nextPack)
            setManagePackName(null)
          }}
        />
      ) : <VStack />,
    },
  ]

  return (
    <NavigationStack>
      <VStack
        navigationTitle="TG Stickers Keyboard"
        navigationBarTitleDisplayMode="inline"
        sheet={sheet}
        toolbar={{
          topBarLeading: (
            <HStack spacing={8}>
              <Button title="" systemImage="xmark.circle" foregroundStyle="systemRed" action={() => Script.exit()} />
              <Button title="" systemImage="folder" disabled={busy} action={() => setShowFolder(true)} />
            </HStack>
          ),
              topBarTrailing: (
            <HStack spacing={8}>
              <Button
                title=""
                systemImage="plus"
                disabled={busy}
                action={() => {
                  setImportRequest((current) => ({ link: "", id: current.id + 1 }))
                  setShowImporter(true)
                }}
              />
              <Button title="" systemImage="gearshape" disabled={busy} action={() => setShowSettings(true)} />
            </HStack>
          ),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <VStack spacing={14} padding={{ top: 14, bottom: 24, leading: 14, trailing: 14 }}>
            <StatusCard
              tokenReady={!!botToken.trim()}
              status={status}
              progress={progress}
              stickersPath={stickersDirectory()}
            />

            {packs.length === 0 ? (
              <EmptyState tokenReady={!!botToken.trim()} />
            ) : (
              packs.map((pack) => (
                <PackCard
                  key={pack.name}
                  pack={pack}
                  onReload={() => {
                    setImportRequest((current) => ({ link: pack.sourceLink, id: current.id + 1 }))
                    setShowImporter(true)
                  }}
                  onManage={() => setManagePackName(pack.name)}
                  onDelete={() => void removePack(pack)}
                />
              ))
            )}
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

function mergePack(existing: StickerPack, incoming: StickerPack): StickerPack {
  const incomingById = new Map(incoming.stickers.map((sticker) => [sticker.id, sticker]))
  const existingIds = new Set(existing.stickers.map((sticker) => sticker.id))
  const mergedStickers = [
    ...existing.stickers.map((sticker) => incomingById.get(sticker.id) ?? sticker),
    ...incoming.stickers.filter((sticker) => !existingIds.has(sticker.id)),
  ]

  return {
    ...existing,
    title: incoming.title || existing.title,
    importedAt: Date.now(),
    sourceLink: incoming.sourceLink || existing.sourceLink,
    stickers: mergedStickers,
  }
}

function SettingsSheet(props: {
  botToken: string
  targetScript: string
  soundEnabled: boolean
  dynamicStickersEnabled: boolean
  onCancel: () => void
  onSave: (
    botToken: string,
    targetScript: string,
    soundEnabled: boolean,
    dynamicStickersEnabled: boolean,
  ) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [token, setToken] = useState(props.botToken)
  const [targetScript, setTargetScript] = useState(props.targetScript)
  const [soundEnabled, setSoundEnabled] = useState(props.soundEnabled)
  const [dynamicStickersEnabled, setDynamicStickersEnabled] = useState(props.dynamicStickersEnabled)

  function cancel() {
    props.onCancel()
    dismiss(null)
  }

  function save() {
    props.onSave(token, targetScript, soundEnabled, dynamicStickersEnabled)
    dismiss(null)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.55, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="取消" role="cancel" action={cancel} />,
          topBarTrailing: <Button title="保存" action={save} />,
        }}
      >
        <Section footer={<Text>通过 BotFather 创建 bot 后填写 token。仅用于 Telegram Bot API 获取公开贴纸包。</Text>}>
          <LabeledInputRow
            title="Token"
            secure
            value={token}
            prompt="123456:ABC..."
            onChanged={setToken}
          />
        </Section>
        <Section footer={<Text>填入其他自定义键盘脚本名称后，键盘顶部会显示一个切换按钮。留空则隐藏。</Text>}>
          <LabeledInputRow
            title="脚本"
            value={targetScript}
            prompt="例如：Scripting Rime Keyboard"
            onChanged={setTargetScript}
          />
        </Section>
        <Section footer={<Text>关闭后键盘点击不会播放按键音，但仍保留震动反馈。</Text>}>
          <Toggle
            title="声音"
            systemImage="speaker.wave.2"
            value={soundEnabled}
            onChanged={setSoundEnabled}
          />
        </Section>
        <Section footer={<Text>开启后读取 WEBM 视频贴纸时会通过 FFmpeg 生成动态 GIF 预览，下载后仅在主脚本中使用，不会显示在键盘中。TGS 矢量贴纸暂不支持转换。</Text>}>
          <Toggle
            title="下载动态贴纸"
            systemImage="sparkles.rectangle.stack"
            value={dynamicStickersEnabled}
            onChanged={setDynamicStickersEnabled}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}

function ImportSheet(props: {
  botToken: string
  dynamicStickersEnabled: boolean
  initialLink: string
  requestId: number
  onTokenMissing: () => void
  onImport: (preview: StickerPackPreview, selectedIds: string[]) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [link, setLink] = useState("")
  const [preview, setPreview] = useState<StickerPackPreview | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState(props.botToken.trim() ? "输入贴纸链接后读取预览" : "未设置 Bot Token")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  const selectedIds = useMemo(
    () => preview?.stickers.filter((sticker) => selected[sticker.id]).map((sticker) => sticker.id) ?? [],
    [preview, selected],
  )

  useEffect(() => {
    if (!props.requestId) return
    const sourceLink = props.initialLink.trim()
    setLink(sourceLink)
    setPreview(null)
    setSelected({})
    setStatus(sourceLink ? "正在重新读取贴纸包" : "输入贴纸链接后读取预览")
    if (sourceLink) void loadPreview(sourceLink)
  }, [props.requestId])

  async function loadPreview(sourceLink = link) {
    if (!props.botToken.trim()) {
      props.onTokenMissing()
      dismiss(null)
      return
    }
    setBusy(true)
    setProgress({ current: 0, total: 0, message: "正在读取贴纸包" })
    try {
      const nextPreview = await fetchStickerSetPreview(props.botToken, sourceLink, (next) => {
        setProgress(next)
        setStatus(next.message)
      }, props.dynamicStickersEnabled)
      setPreview(nextPreview)
      setSelected(Object.fromEntries(nextPreview.stickers.map((sticker) => [sticker.id, true])))
      setStatus(`已读取 ${nextPreview.title}，默认全选`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取失败")
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  function reset() {
    setLink("")
    setPreview(null)
    setSelected({})
    setBusy(false)
    setProgress(null)
    setStatus(props.botToken.trim() ? "输入贴纸链接后读取预览" : "未设置 Bot Token")
  }

  function importSelected() {
    if (!preview) return
    props.onImport(preview, selectedIds)
    dismiss(null)
  }

  function selectAll() {
    if (!preview) return
    setSelected(Object.fromEntries(preview.stickers.map((sticker) => [sticker.id, true])))
  }

  function invertSelection() {
    if (!preview) return
    setSelected(Object.fromEntries(preview.stickers.map((sticker) => [sticker.id, !selected[sticker.id]])))
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={preview ? preview.title : "添加贴纸"}
        navigationBarTitleDisplayMode="inline"
        presentationDetents={[0.82, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="重置" action={reset} />,
          topBarTrailing: preview
            ? <Button title="下载" disabled={busy || selectedIds.length === 0} action={importSelected} />
            : <Button title="读取" disabled={busy || !link.trim()} action={() => void loadPreview(link)} />,
        }}
      >
        <VStack spacing={12} padding={{ top: 12, bottom: 16, leading: 12, trailing: 12 }}>
          {!preview ? (
            <VStack
              spacing={6}
              padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}
              background="secondarySystemGroupedBackground"
              clipShape={{ type: "rect", cornerRadius: 12 } as any}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            >
              <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                Telegram 贴纸链接
              </Text>
              <TextField
                title=""
                value={link}
                prompt="https://t.me/addstickers/..."
                onChanged={setLink}
                frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" as any }}
              />
            </VStack>
          ) : (
            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              <Button title="全选" systemImage="checkmark.circle" action={selectAll} />
              <Button title="反选" systemImage="arrow.triangle.2.circlepath" action={invertSelection} />
              <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "trailing" as any }}>
                {selectedIds.length}/{preview.stickers.length}
              </Text>
            </HStack>
          )}

          {progress ? (
            <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
              <ProgressView value={progress.total ? progress.current / progress.total : undefined} />
              <Text font="caption" foregroundStyle="secondaryLabel">{progress.message}</Text>
            </VStack>
          ) : (
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              {status}
            </Text>
          )}

          {preview ? (
            <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
              <LazyVGrid columns={GRID_COLUMNS} spacing={8}>
                {preview.stickers.map((sticker) => (
                  <PreviewStickerTile
                    key={sticker.id}
                    sticker={sticker}
                    selected={!!selected[sticker.id]}
                    onToggle={() => setSelected((current) => ({ ...current, [sticker.id]: !current[sticker.id] }))}
                  />
                ))}
              </LazyVGrid>
            </ScrollView>
          ) : null}
        </VStack>
      </VStack>
    </NavigationStack>
  )
}

function StatusCard(props: {
  tokenReady: boolean
  status: string
  progress: ImportProgress | null
  stickersPath: string
}) {
  return (
    <VStack spacing={8} padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }} glassEffect={CARD}>
      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
        <Image
          systemName={props.tokenReady ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"}
          foregroundStyle={props.tokenReady ? "systemGreen" : "systemOrange"}
        />
        <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.tokenReady ? "Bot Token 已设置" : "未设置 Bot Token"}
        </Text>
      </HStack>
      {props.progress ? (
        <ProgressView value={props.progress.total ? props.progress.current / props.progress.total : undefined} />
      ) : null}
      <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        {props.status}
      </Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        {props.stickersPath}
      </Text>
    </VStack>
  )
}

function EmptyState(props: { tokenReady: boolean }) {
  return (
    <VStack spacing={8} padding={{ top: 24, bottom: 24, leading: 14, trailing: 14 }} glassEffect={CARD}>
      <Image systemName={props.tokenReady ? "square.grid.3x3" : "key.slash"} font="title2" foregroundStyle="secondaryLabel" />
      <Text foregroundStyle="secondaryLabel">{props.tokenReady ? "还没有导入贴纸包" : "请先在设置中填写 Bot Token"}</Text>
    </VStack>
  )
}

function PackCard(props: { pack: StickerPack; onReload: () => void; onManage: () => void; onDelete: () => void }) {
  const dynamicCount = props.pack.stickers.filter((item) => !!stickerGifPath(item)).length

  return (
    <VStack spacing={12} padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }} glassEffect={CARD}>
      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
        <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Button buttonStyle="plain" action={props.onReload} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <HStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text font="headline" lineLimit={1}>{props.pack.title}</Text>
              <Image systemName="arrow.clockwise" font="caption" foregroundStyle="secondaryLabel" />
            </HStack>
          </Button>
          <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {props.pack.stickers.length} 个贴纸{dynamicCount ? `，${dynamicCount} 个动态 GIF` : ""}
          </Text>
        </VStack>
        <Button title="" systemImage="slider.horizontal.3" action={props.onManage} />
        <Button title="" systemImage="trash" tint="systemRed" action={props.onDelete} />
      </HStack>

      <ScrollView frame={{ maxWidth: "infinity", maxHeight: 260 }}>
        <LazyVGrid columns={GRID_COLUMNS} spacing={8}>
          {props.pack.stickers.map((sticker) => <StickerPreview key={sticker.id} sticker={sticker} />)}
        </LazyVGrid>
      </ScrollView>
    </VStack>
  )
}

function PreviewStickerTile(props: {
  sticker: PreviewSticker
  selected: boolean
  onToggle: () => void
}) {
  const image = props.sticker.thumbnailPath
    ? imageForSticker(props.sticker.thumbnailPath)
    : props.sticker.previewPath
      ? imageForSticker(props.sticker.previewPath)
      : imageForSticker(props.sticker.localPath)
  return (
    <Button action={props.onToggle} glassEffect={TILE} frame={{ maxWidth: "infinity", minHeight: 98 }}>
      <VStack spacing={4} padding={{ top: 8, bottom: 8, leading: 4, trailing: 4 }}>
        <StickerArtwork
          image={image}
          gifPath={props.sticker.gifPath}
          kind={props.sticker.kind}
          size={66}
        />
        <HStack spacing={3}>
          <Image
            systemName={props.selected ? "checkmark.circle.fill" : "circle"}
            font="caption2"
            foregroundStyle={props.selected ? "systemBlue" : "secondaryLabel"}
          />
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {props.sticker.emoji || props.sticker.kind}
          </Text>
        </HStack>
      </VStack>
    </Button>
  )
}

function StickerPreview(props: { sticker: CachedSticker }) {
  const image = imageForSticker(props.sticker.thumbnailPath ?? props.sticker.localPath)
  const gifPath = stickerGifPath(props.sticker)
  return (
    <VStack
      spacing={3}
      frame={{ maxWidth: "infinity", minHeight: 66 }}
      padding={{ top: 6, bottom: 6, leading: 6, trailing: 6 }}
      background="tertiarySystemGroupedBackground"
      clipShape={{ type: "rect", cornerRadius: 10 } as any}
    >
      <StickerArtwork image={image} gifPath={gifPath} kind={props.sticker.kind} size={54} />
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
        {props.sticker.emoji || props.sticker.kind}
      </Text>
    </VStack>
  )
}

function PackManageSheet(props: {
  pack: StickerPack
  onCancel: () => void
  onSave: (pack: StickerPack) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")

  const selectedIds = props.pack.stickers.filter((sticker) => selected[sticker.id]).map((sticker) => sticker.id)

  function cancel() {
    props.onCancel()
    dismiss(null)
  }

  function selectAll() {
    setSelected(Object.fromEntries(props.pack.stickers.map((sticker) => [sticker.id, true])))
  }

  function invertSelection() {
    setSelected(Object.fromEntries(props.pack.stickers.map((sticker) => [sticker.id, !selected[sticker.id]])))
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return
    const ids = new Set(selectedIds)
    const removed = props.pack.stickers.filter((sticker) => ids.has(sticker.id))
    for (const sticker of removed) {
      try {
        if (await FileManager.exists(sticker.localPath)) await FileManager.remove(sticker.localPath)
      } catch {}
      try {
        if (sticker.thumbnailPath && await FileManager.exists(sticker.thumbnailPath)) {
          await FileManager.remove(sticker.thumbnailPath)
        }
      } catch {}
      try {
        if (sticker.gifPath && await FileManager.exists(sticker.gifPath)) await FileManager.remove(sticker.gifPath)
      } catch {}
    }
    props.onSave({
      ...props.pack,
      stickers: props.pack.stickers.filter((sticker) => !ids.has(sticker.id)),
    })
    dismiss(null)
  }

  async function saveSelectedToPhotos() {
    if (selectedIds.length === 0 || busy) return
    setBusy(true)
    setStatus("正在保存到相册")
    try {
      const selectedStickers = props.pack.stickers.filter((sticker) => selected[sticker.id])
      const result = await saveStickersToAlbum(props.pack.name, selectedStickers)
      const details = [
        result.saved ? `新增 ${result.saved} 个` : "",
        result.alreadySaved ? `已存在 ${result.alreadySaved} 个` : "",
        result.skipped ? `跳过 ${result.skipped} 个` : "",
      ].filter(Boolean).join("，")
      setStatus(`已保存到 TG-Stickers 相簿${details ? `：${details}` : ""}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存到相册失败")
    } finally {
      setBusy(false)
    }
  }

  async function clearSavedPhotos() {
    if (busy) return
    setBusy(true)
    setStatus("正在清除相册贴纸")
    try {
      const result = await clearStickersFromAlbum()
      setStatus(result.deleted
        ? `已从照片图库删除 ${result.deleted} 个贴纸${result.albumDeleted ? "，并删除空相簿" : ""}`
        : "所选贴纸没有已保存的相册内容")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "清除相册贴纸失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.pack.title}
        navigationBarTitleDisplayMode="inline"
        presentationDetents={[0.82, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="取消" role="cancel" action={cancel} />,
          topBarTrailing: (
            <Menu title="" systemImage="ellipsis.circle">
              <Button
                title="保存到相册"
                systemImage="photo.badge.arrow.down"
                disabled={busy || selectedIds.length === 0}
                action={() => void saveSelectedToPhotos()}
              />
              <Button
                title="清除相册贴纸"
                systemImage="trash.fill"
                disabled={busy}
                action={() => void clearSavedPhotos()}
              />
              <Button
                title="删除"
                systemImage="trash"
                role="destructive"
                disabled={busy || selectedIds.length === 0}
                action={() => void deleteSelected()}
              />
            </Menu>
          ),
        }}
      >
        <VStack spacing={10} padding={{ top: 12, bottom: 16, leading: 12, trailing: 12 }}>
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Button title="全选" systemImage="checkmark.circle" action={selectAll} />
            <Button title="反选" systemImage="arrow.triangle.2.circlepath" action={invertSelection} />
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "trailing" as any }}>
              {selectedIds.length}/{props.pack.stickers.length}
            </Text>
          </HStack>
          {status ? (
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              {status}
            </Text>
          ) : null}
          <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <LazyVGrid columns={GRID_COLUMNS} spacing={6}>
              {props.pack.stickers.map((sticker) => (
                <ManageStickerTile
                  key={sticker.id}
                  sticker={sticker}
                  selected={!!selected[sticker.id]}
                  onToggle={() => setSelected((current) => ({ ...current, [sticker.id]: !current[sticker.id] }))}
                />
              ))}
            </LazyVGrid>
          </ScrollView>
        </VStack>
      </VStack>
    </NavigationStack>
  )
}

function ManageStickerTile(props: {
  sticker: CachedSticker
  selected: boolean
  onToggle: () => void
}) {
  const image = imageForSticker(props.sticker.thumbnailPath ?? props.sticker.localPath)
  const gifPath = stickerGifPath(props.sticker)
  return (
    <Button action={props.onToggle} glassEffect={TILE} frame={{ maxWidth: "infinity", minHeight: 98 }}>
      <VStack spacing={4} padding={{ top: 8, bottom: 8, leading: 4, trailing: 4 }}>
        <StickerArtwork image={image} gifPath={gifPath} kind={props.sticker.kind} size={66} />
        <Image
          systemName={props.selected ? "checkmark.circle.fill" : "circle"}
          font="caption"
          foregroundStyle={props.selected ? "systemBlue" : "secondaryLabel"}
        />
      </VStack>
    </Button>
  )
}

function stickerGifPath(sticker: CachedSticker): string | undefined {
  if (sticker.gifPath) return sticker.gifPath
  if (sticker.fileName.toLowerCase().endsWith(".gif")) return sticker.localPath
  return undefined
}

function StickerArtwork(props: { image: UIImage | null; gifPath?: string; kind: string; size: number }) {
  return (
    <ZStack alignment="topLeading" frame={{ width: props.size, height: props.size }}>
      <StickerImage image={props.image} gifPath={props.gifPath} kind={props.kind} size={props.size} />
      <StickerKindBadge kind={props.kind} gifPath={props.gifPath} />
    </ZStack>
  )
}

function StickerKindBadge(props: { kind: string; gifPath?: string }) {
  const systemName = props.gifPath
    ? "play.rectangle.fill"
    : props.kind === "animated"
      ? "sparkles"
      : props.kind === "video"
        ? "video.fill"
        : ""
  if (!systemName) return null
  return (
    <ZStack alignment="center" frame={{ width: 18, height: 18 }}>
      <Image
        systemName="circle.fill"
        font={18}
        foregroundStyle={props.gifPath ? "systemGreen" : "systemOrange"}
      />
      <Image
        systemName={systemName}
        font={9}
        foregroundStyle="white"
        frame={{ width: 14, height: 14 }}
      />
    </ZStack>
  )
}

function StickerImage(props: { image: UIImage | null; gifPath?: string; kind: string; size: number }) {
  if (props.gifPath && FileManager.existsSync(props.gifPath)) {
    return <Image filePath={props.gifPath} resizable scaleToFit frame={{ width: props.size, height: props.size }} />
  }
  if (props.image) {
    return <Image image={props.image} resizable scaleToFit frame={{ width: props.size, height: props.size }} />
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

function LabeledInputRow(props: {
  title: string
  value: string
  prompt: string
  secure?: boolean
  onChanged: (value: string) => void
}) {
  return (
    <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      <Text frame={{ width: 52, alignment: "leading" as any }}>{props.title}</Text>
      {props.secure ? (
        <SecureField
          title=""
          value={props.value}
          prompt={props.prompt}
          onChanged={props.onChanged}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        />
      ) : (
        <TextField
          title=""
          value={props.value}
          prompt={props.prompt}
          onChanged={props.onChanged}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        />
      )}
    </HStack>
  )
}
