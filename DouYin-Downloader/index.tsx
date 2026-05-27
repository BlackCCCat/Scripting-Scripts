import {
  Button,
  HStack,
  Image,
  Intent,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Rectangle,
  ScrollView,
  ScrollViewReader,
  Script,
  Section,
  Spacer,
  Tab,
  TabView,
  Text,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { downloadVideo, type DownloadProgress, type DownloadSuccess } from "./services/douyin"
import {
  clearHistoryRecords,
  deleteHistoryRecord,
  initDatabase,
  insertHistory,
  listHistory,
  type HistoryRecord,
} from "./services/history"
import { postDownloadAction, exportFilePathToFiles, saveFilePathToPhotos } from "./services/file-actions"
import { getPreferences, persistPreferences, type Preferences, type SaveMode } from "./services/preferences"
import { extractFirstURL, formatBytes, formatDate } from "./utils/common"

declare const openURL: (url: string) => Promise<boolean>

const HISTORY_TAB = 0
const DOWNLOAD_TAB = 1
const SETTINGS_TAB = 2

type ContentTab = typeof HISTORY_TAB | typeof DOWNLOAD_TAB | typeof SETTINGS_TAB

function resolveIntentURL(): string | null {
  if (Intent.urlsParameter?.length) {
    return Intent.urlsParameter[0]
  }

  if (Intent.textsParameter?.length) {
    for (const text of Intent.textsParameter) {
      const found = extractFirstURL(text)
      if (found) return found
    }
  }

  const shortcut = Intent.shortcutParameter
  if (shortcut?.type === "fileURL" && typeof shortcut.value === "string") {
    return shortcut.value
  }
  if (shortcut?.type === "text" && typeof shortcut.value === "string") {
    return extractFirstURL(shortcut.value)
  }

  return null
}

async function runIntentDownload(url: string) {
  try {
    const preferences = getPreferences()
    await initDatabase()
    const logs: string[] = []
    const download = await downloadVideo(url, {
      preferNoWatermark: preferences.preferNoWatermark,
      onLog: (message: string) => {
        logs.push(message)
      },
    })
    await insertHistory(download)
    const message = await postDownloadAction(download, preferences.defaultSaveMode)

    Script.exit(
      Intent.json({
        ok: true,
        mode: preferences.defaultSaveMode,
        message,
        title: download.extracted.title,
        thumbnailURL: download.extracted.thumbnailURL,
        pageURL: download.extracted.pageURL,
        canonical: download.extracted.canonical,
        finalURL: download.finalURL,
        bytesWritten: download.bytesWritten,
        localFilePath: download.filePath,
        preferNoWatermark: preferences.preferNoWatermark,
        matchedCandidateLabel: download.matchedCandidateLabel,
        logs,
      })
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Pasteboard.setString(message)
    await Dialog.alert({
      title: "抖音下载失败",
      message: `${message}\n\n错误信息已复制到剪贴板。`,
      buttonLabel: "好",
    })
    Script.exit(Intent.text(`抖音下载失败：${message}`))
  }
}

function ThumbnailView(props: {
  url?: string | null
  width?: number
  height?: number
}) {
  const width = props.width ?? 72
  const height = props.height ?? 96

  return (
    <VStack
      frame={{ width, height, alignment: "center" as any }}
      clipShape={{ type: "rect", cornerRadius: 8 }}
      background={{
        style: "tertiarySystemFill",
        shape: { type: "rect", cornerRadius: 8 },
      }}
    >
      {props.url ? (
        <Image
          imageUrl={props.url}
          resizable
          frame={{ width, height }}
          clipShape={{ type: "rect", cornerRadius: 8 }}
          placeholder={<Image systemName="play.rectangle.fill" foregroundStyle="secondaryLabel" />}
        />
      ) : (
        <Image systemName="play.rectangle.fill" foregroundStyle="secondaryLabel" />
      )}
    </VStack>
  )
}

function RecentDownloadPage(props: {
  item: DownloadSuccess
}) {
  const dismiss = Navigation.useDismiss()
  const { item } = props

  return (
    <NavigationStack>
      <List
        navigationTitle="最近下载"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        <Section>
          <HStack alignment="top" spacing={14}>
            <ThumbnailView url={item.extracted.thumbnailURL} width={118} height={158} />
            <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text font="headline" lineLimit={4}>{item.extracted.title || item.fileName}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{formatBytes(item.bytesWritten)} · {formatDate(item.createdAt)}</Text>
              <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                <Button
                  title="分享文件"
                  systemImage="square.and.arrow.up"
                  action={() => void ShareSheet.present([item.filePath])}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  padding={{ horizontal: 12, vertical: 8 }}
                  glassEffect
                />
                <Button
                  title="打开原页面"
                  systemImage="safari"
                  action={() => void openURL(item.extracted.pageURL)}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  padding={{ horizontal: 12, vertical: 8 }}
                  glassEffect
                />
              </VStack>
            </VStack>
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

function FloatingIconButton(props: {
  systemImage: string
  onPress: () => void
}) {
  return (
    <Button action={props.onPress} frame={{ width: 58, height: 58 }} glassEffect>
      <Image systemName={props.systemImage} foregroundStyle="label" frame={{ width: 26, height: 26 }} />
    </Button>
  )
}

function AddButtonCluster(props: {
  visible: boolean
  onToggle: () => void
  onPaste: () => void
  onManual: () => void
}) {
  return (
    <VStack
      spacing={10}
      padding={{ trailing: 18, bottom: 72 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
    >
      {props.visible ? (
        <>
          <FloatingIconButton systemImage="doc.on.clipboard" onPress={props.onPaste} />
          <FloatingIconButton systemImage="square.and.pencil" onPress={props.onManual} />
        </>
      ) : null}
      <FloatingIconButton systemImage={props.visible ? "xmark" : "plus"} onPress={props.onToggle} />
    </VStack>
  )
}

function HistoryRow(props: {
  item: HistoryRecord
  onRefresh: () => Promise<void>
  onStatus: (text: string) => void
}) {
  const { item, onRefresh, onStatus } = props

  const openActions = async () => {
    const fileExists = await FileManager.exists(item.file_path)
    const result = await Dialog.actionSheet({
      title: item.title || item.file_name,
      message: `${formatDate(item.created_at)} · ${formatBytes(item.bytes_written)}`,
      actions: [
        { label: "分享文件" },
        { label: "保存到相册" },
        { label: "导出到文件" },
        { label: "打开原始页面" },
        { label: "复制原始链接" },
        { label: fileExists ? "删除记录并删除文件" : "删除记录", destructive: true },
      ],
      cancelButton: true,
    })

    if (result == null) return

    try {
      if (result === 0) {
        if (!fileExists) throw new Error("本地文件不存在")
        await ShareSheet.present([item.file_path])
        onStatus("已打开分享面板。")
        return
      }
      if (result === 1) {
        if (!fileExists) throw new Error("本地文件不存在")
        await saveFilePathToPhotos(item.file_path, item.file_name)
        onStatus("已保存到相册。")
        return
      }
      if (result === 2) {
        if (!fileExists) throw new Error("本地文件不存在")
        const exportedPath = await exportFilePathToFiles(item.file_path, item.file_name)
        onStatus(`已导出到文件：${exportedPath}`)
        return
      }
      if (result === 3) {
        await openURL(item.page_url || item.source_url)
        return
      }
      if (result === 4) {
        await Pasteboard.setString(item.source_url)
        onStatus("已复制原始链接到剪贴板。")
        return
      }
      if (result === 5) {
        if (fileExists) {
          await FileManager.remove(item.file_path)
        }
        await deleteHistoryRecord(item.id)
        await onRefresh()
        onStatus("已删除记录。")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onStatus(`操作失败：${message}`)
      await Dialog.alert({ title: "操作失败", message })
    }
  }

  return (
    <HStack
      key={item.id}
      alignment="top"
      spacing={12}
      onTapGesture={openActions}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button
            title="删除"
            role="destructive"
            action={async () => {
              await deleteHistoryRecord(item.id)
              await onRefresh()
              onStatus("已删除历史记录。")
            }}
          />,
        ],
      }}
    >
      <ThumbnailView url={item.thumbnail_url} />
      <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text font="headline" lineLimit={2}>{item.title || item.file_name}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{item.description || item.source_url}</Text>
        <HStack>
          <Text font="caption2" foregroundStyle="secondaryLabel">{formatBytes(item.bytes_written)}</Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">{formatDate(item.created_at)}</Text>
        </HStack>
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>命中策略：{item.matched_candidate_label || "未知"}</Text>
      </VStack>
    </HStack>
  )
}

function View() {
  const dismiss = Navigation.useDismiss()
  const activeTab = useObservable<ContentTab>(DOWNLOAD_TAB)
  const logProxyRef = useRef<any>()
  const [showAddActions, setShowAddActions] = useState(false)
  const [inputURL, setInputURL] = useState("")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("准备就绪。可粘贴抖音链接后直接下载。")
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    fraction: 0,
    stage: "未开始",
  })
  const [downloadLogs, setDownloadLogs] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [lastDownloaded, setLastDownloaded] = useState<DownloadSuccess | null>(null)
  const [preferences, setPreferences] = useState<Preferences>(getPreferences())

  const refreshHistory = async () => {
    const list = await listHistory()
    setHistory(list)
  }

  const updatePreferences = (next: Preferences) => {
    setPreferences(next)
    persistPreferences(next)
  }

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    setDownloadLogs((current) => [...current, `[${timestamp}] ${message}`].slice(-60))
  }

  useEffect(() => {
    const scrollLatest = () => {
      try {
        logProxyRef.current?.scrollTo?.("downloadLogBottom", "bottom")
      } catch {}
    }
    scrollLatest()
    const timer = setTimeout(scrollLatest, 120)
    return () => clearTimeout(timer)
  }, [downloadLogs.length])

  useEffect(() => {
    initDatabase()
      .then(refreshHistory)
      .catch((error: unknown) => {
        setStatus(`初始化失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }, [])

  const toggleAddActions = () => {
    setShowAddActions((current) => !current)
  }

  const downloadFromClipboard = async () => {
    setShowAddActions(false)
    const clipboardText = await Pasteboard.getString()
    if (!clipboardText?.trim()) {
      setStatus("剪贴板中没有文本内容。")
      activeTab.setValue(DOWNLOAD_TAB)
      return
    }
    const nextInput = clipboardText.trim()
    setInputURL(nextInput)
    activeTab.setValue(DOWNLOAD_TAB)
    await handleDownload(nextInput)
  }

  const openManualAddDialog = async () => {
    setShowAddActions(false)
    const text = await Dialog.prompt({
      title: "添加下载链接",
      message: "粘贴抖音分享链接或完整分享文本，确认后会切到下载页开始任务。",
      placeholder: "https://v.douyin.com/...",
      cancelLabel: "取消",
      confirmLabel: "下载",
      selectAll: true,
    })
    if (text == null) return

    const nextInput = text.trim()
    if (!nextInput) {
      setStatus("请先输入抖音分享链接。")
      activeTab.setValue(DOWNLOAD_TAB)
      return
    }

    setInputURL(nextInput)
    activeTab.setValue(DOWNLOAD_TAB)
    await handleDownload(nextInput)
  }

  const openRecentDownload = async () => {
    if (!lastDownloaded) return
    await Navigation.present({
      element: <RecentDownloadPage item={lastDownloaded} />,
    })
  }

  const handleDownload = async (overrideInput?: string) => {
    const rawInput = (overrideInput ?? inputURL).trim()
    const url = extractFirstURL(rawInput) || rawInput
    if (!url) {
      setStatus("请先输入抖音分享链接。")
      return
    }

    setLoading(true)
    setDownloadLogs([])
    setDownloadProgress({ fraction: 0.01, stage: "准备开始" })
    setStatus("正在分析分享页面…")
    appendLog(`收到下载任务：${url}`)
    if (url !== rawInput) {
      appendLog("已从分享文本中自动提取 URL。")
    }

    try {
      const download = await downloadVideo(url, {
        preferNoWatermark: preferences.preferNoWatermark,
        onProgress: (progress: DownloadProgress) => {
          setDownloadProgress(progress)
          setStatus(progress.stage)
        },
        onLog: appendLog,
      })
      appendLog(`下载成功，命中策略：${download.matchedCandidateLabel}`)
      setDownloadProgress({ fraction: 0.96, stage: "正在写入历史记录" })
      await insertHistory(download)
      await refreshHistory()
      setLastDownloaded(download)
      appendLog("历史记录已写入。")
      setDownloadProgress({ fraction: 0.98, stage: "正在执行下载后动作" })
      const resultMessage = await postDownloadAction(download, preferences.defaultSaveMode)
      appendLog(`下载后动作完成：${resultMessage}`)
      setDownloadProgress({ fraction: 1, stage: "全部完成" })
      setStatus(`下载成功：${download.fileName} · ${resultMessage}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendLog(`下载失败：${message}`)
      setStatus(`下载失败：${message}`)
      await Dialog.alert({
        title: "下载失败",
        message,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClearHistory = async () => {
    if (!history.length) {
      setStatus("当前没有历史记录可清空。")
      return
    }

    const result = await Dialog.actionSheet({
      title: "清空历史记录",
      message: "仅删除历史记录，不删除本地下载文件。",
      actions: [{ label: "清空", destructive: true }],
      cancelButton: true,
    })

    if (result !== 0) return

    await clearHistoryRecords()
    await refreshHistory()
    setStatus("已清空历史记录。")
  }

  const chooseDefaultSaveMode = async () => {
    const result = await Dialog.actionSheet({
      title: "默认保存方式",
      message: "下载成功后默认如何处理文件？",
      actions: [
        { label: "每次询问" },
        { label: "自动保存到相册" },
        { label: "自动导出到文件" },
      ],
      cancelButton: true,
    })

    if (result == null) return

    const nextMode: SaveMode = result === 1 ? "photos" : result === 2 ? "files" : "ask"
    updatePreferences({
      ...preferences,
      defaultSaveMode: nextMode,
    })
    setStatus(`默认保存方式已更新为：${nextMode === "ask" ? "每次询问" : nextMode === "photos" ? "自动保存到相册" : "自动导出到文件"}`)
  }

  const renderHistoryPage = () => (
    <NavigationStack>
      <List
        navigationTitle="历史记录"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          topBarTrailing: <Button title="刷新" action={() => void refreshHistory()} />,
        }}
      >
        <Section
          header={<Text>{`下载历史 (${history.length})`}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">点击记录可打开更多操作；左滑可快速删除历史记录。</Text>}
        >
          {history.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">还没有下载历史。可以先输入一个链接试试。</Text>
          ) : (
            history.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                onRefresh={refreshHistory}
                onStatus={setStatus}
              />
            ))
          )}
        </Section>

        <Section title="更多操作">
          <Button title="清空历史记录" role="destructive" action={() => void handleClearHistory()} />
        </Section>
      </List>
    </NavigationStack>
  )

  const renderDownloadPage = () => (
    <NavigationStack>
      <List
        navigationTitle="下载"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          topBarTrailing: lastDownloaded
            ? <Button title="" systemImage="checkmark.circle" action={() => void openRecentDownload()} />
            : undefined as any,
        }}
      >
        <Section
          header={<Text>当前任务</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">使用底部右侧按钮添加新的下载链接。</Text>}
        >
          {inputURL ? (
            <Text lineLimit={3}>{inputURL}</Text>
          ) : (
            <Text foregroundStyle="secondaryLabel">还没有添加下载链接。</Text>
          )}
        </Section>

        <Section
          header={<Text>下载日志</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">展示本次下载过程中的页面分析、候选构造与命中结果。</Text>}
        >
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: "infinity", height: 220 }}>
                  <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {downloadLogs.length === 0 ? (
                      <Text foregroundStyle="secondaryLabel">当前还没有下载日志。开始一次下载后会在这里显示过程。</Text>
                    ) : (
                      downloadLogs.map((log, index) => (
                        <Text key={`${index}-${log}`} font="caption" foregroundStyle="secondaryLabel">{log}</Text>
                      ))
                    )}
                    <Rectangle
                      key="downloadLogBottom"
                      foregroundStyle="clear"
                      frame={{ maxWidth: "infinity", height: 1 }}
                    />
                  </VStack>
                </ScrollView>
              )
            }}
          </ScrollViewReader>
        </Section>

        <Section title="状态">
          {loading ? (
            <VStack alignment="leading" spacing={8}>
              <ProgressView value={downloadProgress.fraction} total={1} />
              <Text>{downloadProgress.stage}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">当前进度：{Math.round(downloadProgress.fraction * 100)}%</Text>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">{status}</Text>
          )}
        </Section>

      </List>
    </NavigationStack>
  )

  const renderSettingsPage = () => (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        <Section title="下载偏好">
          <Text foregroundStyle="secondaryLabel">
            默认保存方式：{preferences.defaultSaveMode === "ask" ? "每次询问" : preferences.defaultSaveMode === "photos" ? "自动保存到相册" : "自动导出到文件"}
          </Text>
          <Button title="修改默认保存方式" action={() => void chooseDefaultSaveMode()} />
          <Toggle
            title="优先尝试无水印候选地址"
            value={preferences.preferNoWatermark}
            onChanged={(value) => updatePreferences({
              ...preferences,
              preferNoWatermark: value,
            })}
          />
        </Section>
      </List>
    </NavigationStack>
  )

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <TabView
        selection={activeTab as any}
        tint="systemPink"
        tabViewStyle="sidebarAdaptable"
        tabBarMinimizeBehavior="onScrollDown"
      >
        <Tab title="历史记录" systemImage="clock.arrow.circlepath" value={HISTORY_TAB}>
          {renderHistoryPage()}
        </Tab>

        <Tab title="下载" systemImage="arrow.down.circle.fill" value={DOWNLOAD_TAB}>
          {renderDownloadPage()}
        </Tab>

        <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
          {renderSettingsPage()}
        </Tab>
      </TabView>
      <AddButtonCluster
        visible={showAddActions}
        onToggle={toggleAddActions}
        onPaste={() => void downloadFromClipboard()}
        onManual={() => void openManualAddDialog()}
      />
    </ZStack>
  )
}

async function run() {
  const intentURL = resolveIntentURL()
  if (intentURL) {
    await runIntentDownload(intentURL)
    return
  }

  await Navigation.present({
    element: <View />,
  })
  Script.exit()
}

run()
