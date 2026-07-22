import {
  Button,
  DirectoryBrowserView,
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
  Slider,
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
import {
  DOWNLOAD_DIR,
  IMAGE_DOWNLOAD_DIR,
  ROOT_DIR,
  ensureDownloadDirectories,
  type DownloadProgress,
  type DownloadSuccess,
} from "./services/douyin"
import { cleanupCurrentDownloadFiles, clearDownloadCancelFlag, downloadMedia, getYtDlpVersion, installOrUpdateYtDlp, requestDownloadCancel } from "./services/media"
import {
  clearHistoryRecords,
  initDatabase,
  insertHistory,
  listHistory,
  getHistoryFiles,
  removeHistoryRecordFiles,
  deleteHistoryRecord,
  pruneHistoryStorage,
  type HistoryRecord,
} from "./services/history"
import {
  postDownloadAction,
  exportDownloadedFilesToFiles,
  saveDownloadedFilesToPhotos,
} from "./services/file-actions"
import { getPreferences, persistPreferences, type LanguageMode, type Preferences, type SaveMode } from "./services/preferences"
import { extractFirstURL, formatBytes, formatDate, sleep } from "./utils/common"
import { getI18n, languageLabel, localizeRuntimeText } from "./utils/i18n"
import { useMarkdownReleaseNotesSheet } from "./components/release-notes-sheet"

const HISTORY_TAB = 0
const DOWNLOAD_TAB = 1
const SETTINGS_TAB = 2
const DESKTOP_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
const YOINKS_URL = "https://github.com/pablostanley/yoinks"

type ContentTab = typeof HISTORY_TAB | typeof DOWNLOAD_TAB | typeof SETTINGS_TAB

function extractAwemeIDFromURL(url: string): string | null {
  const match = url.match(/(?:video|share\/video|note|share\/note|gallery|share\/gallery|slides|share\/slides)\/(\d{10,})/) || url.match(/[?&](?:aweme_id|item_id|modal_id)=(\d{10,})/)
  return match?.[1] ?? null
}

function buildDouyinAppURLs(url: string): string[] {
  const awemeID = extractAwemeIDFromURL(url)
  if (!awemeID) return []

  return [
    `snssdk1128://aweme/detail/${awemeID}`,
    `aweme://aweme/detail/${awemeID}`,
    `douyin://aweme/detail/${awemeID}`,
  ]
}

async function openOriginalPage(url: string) {
  for (const appURL of buildDouyinAppURLs(url)) {
    try {
      const opened = await Safari.openURL(appURL)
      if (opened) return
    } catch {}
  }

  await Safari.present(url, true)
}

async function openExternalURL(url: string) {
  try {
    const opened = await Safari.openURL(url)
    if (opened) return
  } catch {}
  await Safari.present(url, true)
}

async function removeExistingFile(path: string): Promise<boolean> {
  if (!(await FileManager.exists(path))) return false
  await FileManager.remove(path)
  return true
}

async function removeDownloadSuccessFiles(record: DownloadSuccess): Promise<number> {
  const files = record.files?.length ? record.files : [{
    filePath: record.filePath,
    fileName: record.fileName,
    finalURL: record.finalURL,
    bytesWritten: record.bytesWritten,
    mediaType: record.mediaType || "video",
  }]
  const seen = new Set<string>()
  let deletedCount = 0
  for (const file of files) {
    if (!file.filePath || seen.has(file.filePath)) continue
    seen.add(file.filePath)
    if (await removeExistingFile(file.filePath)) {
      deletedCount += 1
    }
  }
  return deletedCount
}

function isCookieLoginRequiredError(message: string): boolean {
  return /需要登录|cookies|login|authentication|empty media response|匿名访问下不可用/i.test(message)
}

async function deleteHistoryRecordAndFiles(record: HistoryRecord): Promise<number> {
  const result = await removeHistoryRecordFiles(record)
  await deleteHistoryRecord(record.id)
  return result.deletedCount
}

async function removeDownloadCacheDirectories(): Promise<number> {
  let deletedCount = 0

  for (const directory of [DOWNLOAD_DIR, IMAGE_DOWNLOAD_DIR]) {
    if (!(await FileManager.exists(directory))) continue
    try {
      const entries = await FileManager.readDirectory(directory, true)
      for (const path of entries) {
        try {
          if (await FileManager.isFile(path)) {
            deletedCount += 1
          }
        } catch {}
      }
    } catch {}
    await FileManager.remove(directory)
  }

  await ensureDownloadDirectories()
  return deletedCount
}

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
  const logs: string[] = []
  try {
    const preferences = getPreferences()
    await initDatabase()
    const download = await downloadMedia(url, {
      preferNoWatermark: preferences.preferNoWatermark,
      ytDlpReady: preferences.ytDlpReady,
      onYtDlpStatus: (ready, version) => {
        persistPreferences({
          ...getPreferences(),
          ytDlpReady: ready,
          ytDlpVersion: version,
          ytDlpCheckedAt: new Date().toISOString(),
        })
      },
      onLog: (message: string) => {
        logs.push(message)
      },
    })
    const postResult = await postDownloadAction(download, preferences.defaultSaveMode)
    const preserveFiles = preferences.keepHistoryFiles || postResult.keepFilesInHistory
    await insertHistory(download, { preserveFiles })
    if (!preserveFiles) {
      await removeDownloadSuccessFiles(download)
    }
    if (preferences.keepHistoryFiles) {
      await pruneHistoryStorage({
        maxCacheBytes: preferences.historyCacheLimitMB == null ? null : preferences.historyCacheLimitMB * 1024 * 1024,
        maxRecordCount: preferences.historyRecordLimit,
      })
    }

    Script.exit(
      Intent.json({
        ok: true,
        mode: preferences.defaultSaveMode,
        message: postResult.message,
        title: download.extracted.title,
        thumbnailURL: download.extracted.thumbnailURL,
        pageURL: download.extracted.pageURL,
        canonical: download.extracted.canonical,
        finalURL: download.finalURL,
        bytesWritten: download.bytesWritten,
        localFilePath: preserveFiles ? download.filePath : null,
        localFilePaths: preserveFiles ? download.files.map((file) => file.filePath) : [],
        mediaType: download.mediaType,
        preferNoWatermark: preferences.preferNoWatermark,
        matchedCandidateLabel: download.matchedCandidateLabel,
        logs,
      })
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Dialog.alert({
      title: "下载失败",
      message,
      buttonLabel: "好",
    })
    Script.exit(Intent.text(`下载失败：${message}`))
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
          scaleToFit
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          clipShape={{ type: "rect", cornerRadius: 8 }}
          placeholder={<Image systemName="play.rectangle.fill" foregroundStyle="secondaryLabel" />}
        />
      ) : (
        <Image systemName="play.rectangle.fill" foregroundStyle="secondaryLabel" />
      )}
    </VStack>
  )
}

function SavedFilesPage(props: {
  t: ReturnType<typeof getI18n>
}) {
  return (
    <NavigationStack>
      <DirectoryBrowserView
        title={props.t.savedFiles}
        directoryPath={ROOT_DIR}
      />
    </NavigationStack>
  )
}

function AboutPage(props: {
  t: ReturnType<typeof getI18n>
}) {
  const dismiss = Navigation.useDismiss()
  const { t } = props

  return (
    <NavigationStack>
      <List
        navigationTitle={t.about}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={t.close} action={dismiss} />,
        }}
      >
        <Section title={t.operationGuide}>
          {t.operationGuideItems.map((item, index) => (
            <HStack key={`guide-${index}`} alignment="top" spacing={10}>
              <Text font="caption" foregroundStyle="secondaryLabel">{String(index + 1)}</Text>
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{item}</Text>
            </HStack>
          ))}
        </Section>
        <Section title={t.acknowledgements}>
          {t.acknowledgementItems.map((item, index) => (
            <Text key={`thanks-${index}`}>{item}</Text>
          ))}
          <Button
            title={t.yoinksProject}
            systemImage="link"
            action={() => void openExternalURL(YOINKS_URL)}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

function FloatingIconButton(props: {
  systemImage: string
  onPress: () => void
  iconSize?: number
}) {
  const iconSize = props.iconSize ?? 26
  return (
    <Button action={props.onPress} frame={{ width: 58, height: 58 }} glassEffect>
      <Image systemName={props.systemImage} foregroundStyle="label" frame={{ width: iconSize, height: iconSize }} />
    </Button>
  )
}

function AddButtonCluster(props: {
  visible: boolean
  loading: boolean
  onToggle: () => void
  onPaste: () => void
  onManual: () => void
  onCancel: () => void
}) {
  if (props.loading) {
    return (
      <VStack
        spacing={10}
        padding={{ trailing: 18, bottom: 72 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
      >
        <FloatingIconButton systemImage="xmark.circle.fill" iconSize={36} onPress={props.onCancel} />
      </VStack>
    )
  }

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

function ytDlpStatusText(preferences: Preferences, t: ReturnType<typeof getI18n>): string {
  if (preferences.ytDlpReady === true) {
    return preferences.ytDlpVersion ? `${t.ytDlpReady}：${preferences.ytDlpVersion}` : t.ytDlpReady
  }
  if (preferences.ytDlpReady === false) return t.ytDlpMissing
  return t.ytDlpNotChecked
}

function HistoryRow(props: {
  item: HistoryRecord
  onRefresh: () => Promise<void>
  onStatus: (text: string) => void
  onRedownload: (url: string) => void
}) {
  const { item, onRefresh, onStatus, onRedownload } = props

  const openActions = async () => {
    const files = getHistoryFiles(item)
    const existingFiles: typeof files = []
    for (const file of files) {
      if (await FileManager.exists(file.filePath)) {
        existingFiles.push(file)
      }
    }
    const fileExists = existingFiles.length > 0
    const isImagePost = existingFiles.some((file) => file.mediaType === "image")
    const actions = [
      ...(fileExists ? [{ label: isImagePost ? "预览图片" : "播放视频" }] : []),
      ...(!fileExists ? [{ label: "重新下载" }] : []),
      ...(fileExists ? [
        { label: "分享文件" },
        { label: "保存到相册" },
        { label: "导出到文件" },
      ] : []),
      { label: "打开原始页面" },
      { label: "复制原始链接" },
      { label: fileExists ? "删除记录并删除文件" : "删除记录", destructive: true },
    ]
    const result = await Dialog.actionSheet({
      title: item.title || item.file_name,
      message: `${formatDate(item.created_at)} · ${formatBytes(item.bytes_written)}`,
      actions,
      cancelButton: true,
    })

    if (result == null) return
    const action = actions[result]?.label

    try {
      if (action === "播放视频" || action === "预览图片") {
        if (!fileExists) throw new Error("本地文件不存在")
        await QuickLook.previewURLs(existingFiles.map((file) => file.filePath), true)
        return
      }
      if (action === "重新下载") {
        onRedownload(item.source_url)
        return
      }
      if (action === "分享文件") {
        if (!fileExists) throw new Error("本地文件不存在")
        await ShareSheet.present(existingFiles.map((file) => file.filePath))
        onStatus("已打开分享面板。")
        return
      }
      if (action === "保存到相册") {
        if (!fileExists) throw new Error("本地文件不存在")
        await saveDownloadedFilesToPhotos(existingFiles)
        onStatus("已保存到相册。")
        return
      }
      if (action === "导出到文件") {
        if (!fileExists) throw new Error("本地文件不存在")
        const exportedPaths = await exportDownloadedFilesToFiles(existingFiles)
        onStatus(`已导出到文件：${exportedPaths.join(", ")}`)
        return
      }
      if (action === "打开原始页面") {
        await openOriginalPage(item.canonical_url || item.page_url || item.source_url)
        return
      }
      if (action === "复制原始链接") {
        await Pasteboard.setString(item.source_url)
        onStatus("已复制原始链接到剪贴板。")
        return
      }
      if (action === "删除记录并删除文件" || action === "删除记录") {
        const deletedCount = await deleteHistoryRecordAndFiles(item)
        await onRefresh()
        onStatus(deletedCount > 0 ? `已删除记录和 ${deletedCount} 个本地文件。` : "已删除记录。")
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
              const deletedCount = await deleteHistoryRecordAndFiles(item)
              await onRefresh()
              onStatus(deletedCount > 0 ? `已删除历史记录和 ${deletedCount} 个本地文件。` : "已删除历史记录。")
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
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
          {(item.media_type === "image" ? "图文" : "视频")} · 命中策略：{item.matched_candidate_label || "未知"}
        </Text>
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
  const cancelRequestedRef = useRef(false)
  const [status, setStatus] = useState("")
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    fraction: 0,
    stage: "未开始",
  })
  const latestProgressRef = useRef<DownloadProgress>({
    fraction: 0,
    stage: "未开始",
  })
  const latestStatusRef = useRef("")
  const downloadLogsRef = useRef<string[]>([])
  const [downloadLogs, setDownloadLogs] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [preferences, setPreferences] = useState<Preferences>(getPreferences())
  const [ytDlpStatus, setYtDlpStatus] = useState("")
  const [ytDlpBusy, setYtDlpBusy] = useState(false)
  const ytDlpCheckingRef = useRef(false)
  const downloadRunIdRef = useRef(0)
  const [toastMessage, setToastMessage] = useState("")
  const [toastPresented, setToastPresented] = useState(false)
  const t = getI18n(preferences.language)
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "release-notes.md",
    storageKey: "media-downloader:release-notes:last-seen-hash",
    title: t.releaseNotes,
  })

  const refreshHistory = async () => {
    const list = await listHistory()
    setHistory(list)
  }

  const updatePreferences = (next: Preferences) => {
    setPreferences(next)
    persistPreferences(next)
  }

  const updateYtDlpPreference = (ready: boolean, version: string | null) => {
    const next = {
      ...getPreferences(),
      ytDlpReady: ready,
      ytDlpVersion: version,
      ytDlpCheckedAt: new Date().toISOString(),
    }
    updatePreferences(next)
    setYtDlpStatus(ytDlpStatusText(next, getI18n(next.language)))
  }

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    const next = [...downloadLogsRef.current, `[${timestamp}] ${message}`].slice(-60)
    downloadLogsRef.current = next
    setDownloadLogs(next)
  }

  const showToast = (message: string) => {
    setToastMessage(message)
    setToastPresented(false)
    setTimeout(() => setToastPresented(true), 40)
  }

  const copyText = async (text: string, message: string) => {
    await Pasteboard.setString(text)
    showToast(message)
  }

  const copyDownloadLogs = async () => {
    const logs = downloadLogsRef.current
    await copyText(logs.length ? logs.join("\n") : t.noLogs, t.copiedLogs)
  }

  const copyDownloadStatus = async () => {
    const statusText = loading
      ? `${Math.round(latestProgressRef.current.fraction * 100)}% · ${latestProgressRef.current.stage}`
      : (latestStatusRef.current || status || t.ready)
    await copyText(statusText, t.copiedStatus)
  }

  const retryCurrentTask = () => {
    if (loading) return
    const rawInput = (inputURL || "").trim()
    if (!rawInput) return
    activeTab.setValue(DOWNLOAD_TAB)
    void handleDownload(rawInput)
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

  useEffect(() => {
    if (!loading) {
      setStatus(t.ready)
      latestStatusRef.current = t.ready
    }
  }, [preferences.language])

  useEffect(() => {
    if (!ytDlpBusy) {
      setYtDlpStatus(ytDlpStatusText(preferences, t))
    }
  }, [preferences.language, preferences.ytDlpReady, preferences.ytDlpVersion])

  useEffect(() => {
    if (!loading) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      if (stopped) return
      const progress = latestProgressRef.current
      setDownloadProgress({ ...progress })
      setStatus(latestStatusRef.current || progress.stage)
      timer = setTimeout(tick, 250)
    }
    timer = setTimeout(tick, 250)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [loading])

  const toggleAddActions = () => {
    setShowAddActions((current) => !current)
  }

  const downloadFromClipboard = async () => {
    setShowAddActions(false)
    const clipboardText = await Pasteboard.getString()
    if (!clipboardText?.trim()) {
      setStatus(t.emptyClipboard)
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
      title: t.addDownloadLink,
      message: t.addDownloadMessage,
      placeholder: t.addDownloadPlaceholder,
      cancelLabel: t.cancel,
      confirmLabel: t.startDownload,
      selectAll: true,
    })
    if (text == null) return

    const nextInput = text.trim()
    if (!nextInput) {
      setStatus(t.emptyInput)
      activeTab.setValue(DOWNLOAD_TAB)
      return
    }

    setInputURL(nextInput)
    activeTab.setValue(DOWNLOAD_TAB)
    await handleDownload(nextInput)
  }

  const openCookieLoginBrowser = async (targetURL?: string, retryHint = false): Promise<boolean> => {
    const rawTarget = (targetURL || extractFirstURL(inputURL) || inputURL).trim()
    let loginURL = extractFirstURL(rawTarget) || rawTarget
    if (!loginURL) {
      const prompted = await Dialog.prompt({
        title: t.loginCookies,
        message: preferences.language === "en"
          ? "Enter the website URL you want to log in to."
          : "输入需要登录并保存 Cookie 的网站链接。",
        placeholder: "https://www.instagram.com/",
        cancelLabel: t.cancel,
        confirmLabel: t.loginCookies,
        selectAll: true,
      })
      if (!prompted?.trim()) return false
      loginURL = extractFirstURL(prompted.trim()) || prompted.trim()
    }
    if (!/^https?:\/\//i.test(loginURL)) {
      loginURL = `https://${loginURL}`
    }

    setStatus(retryHint ? t.cookieLoginRetry : t.cookieLoginOpened)
    showToast(retryHint ? t.cookieLoginRetry : t.cookieLoginOpened)
    const webView = new WebViewController()
    try {
      webView.setCustomUserAgent(DESKTOP_BROWSER_UA)
      await webView.loadURL(loginURL)
      await webView.present({
        navigationTitle: t.loginCookies,
        fullscreen: true,
      })
      const cookies = await webView.getCookies(loginURL)
      const message = `${t.cookieLoginSaved}：${cookies.length}`
      setStatus(message)
      showToast(message)
      return true
    } finally {
      webView.dispose()
    }
  }

  const applyHistoryStorageLimits = async () => {
    if (!preferences.keepHistoryFiles) return
    const result = await pruneHistoryStorage({
      maxCacheBytes: preferences.historyCacheLimitMB == null ? null : preferences.historyCacheLimitMB * 1024 * 1024,
      maxRecordCount: preferences.historyRecordLimit,
    })
    if (result.deletedRecords > 0 || result.deletedFiles > 0) {
      appendLog(`历史缓存清理完成：删除 ${result.deletedRecords} 条记录、${result.deletedFiles} 个文件。`)
    }
  }

  const redownloadFromHistory = (url: string) => {
    setInputURL(url)
    activeTab.setValue(DOWNLOAD_TAB)
    void handleDownload(url)
  }

  const handleDownload = async (overrideInput?: string, retriedAfterCookieLogin = false) => {
    const rawInput = (overrideInput ?? inputURL).trim()
    const url = extractFirstURL(rawInput) || rawInput
    if (!url) {
      setStatus(t.emptyInput)
      return
    }
    let retryAfterLoginInput: string | null = null

    setLoading(true)
    const runId = downloadRunIdRef.current + 1
    downloadRunIdRef.current = runId
    cancelRequestedRef.current = false
    await clearDownloadCancelFlag()
    downloadLogsRef.current = []
    setDownloadLogs([])
    latestProgressRef.current = { fraction: 0.01, stage: t.preparing }
    latestStatusRef.current = t.analyzing
    setDownloadProgress(latestProgressRef.current)
    setStatus(latestStatusRef.current)
    appendLog(`收到下载任务：${url}`)
    if (url !== rawInput) {
      appendLog("已从分享文本中自动提取 URL。")
    }

    try {
      const download = await downloadMedia(url, {
        preferNoWatermark: preferences.preferNoWatermark,
        ytDlpReady: preferences.ytDlpReady,
        onYtDlpStatus: updateYtDlpPreference,
        isCancelled: () => cancelRequestedRef.current,
        onProgress: (progress: DownloadProgress) => {
          if (downloadRunIdRef.current !== runId || cancelRequestedRef.current) return
          latestProgressRef.current = progress
          latestStatusRef.current = progress.stage
          setDownloadProgress({ ...progress })
          setStatus(progress.stage)
        },
        onLog: (message: string) => {
          if (downloadRunIdRef.current === runId && !cancelRequestedRef.current) appendLog(message)
        },
      })
      if (downloadRunIdRef.current !== runId || cancelRequestedRef.current) return
      appendLog(`下载成功，命中策略：${download.matchedCandidateLabel}`)
      latestProgressRef.current = { fraction: 0.96, stage: t.postAction }
      latestStatusRef.current = t.postAction
      setDownloadProgress(latestProgressRef.current)
      const postResult = await postDownloadAction(download, preferences.defaultSaveMode)
      appendLog(`下载后动作完成：${postResult.message}`)
      latestProgressRef.current = { fraction: 0.98, stage: t.writingHistory }
      latestStatusRef.current = t.writingHistory
      setDownloadProgress(latestProgressRef.current)
      const preserveFiles = preferences.keepHistoryFiles || postResult.keepFilesInHistory
      await insertHistory(download, { preserveFiles })
      if (!preserveFiles) {
        const deletedCount = await removeDownloadSuccessFiles(download)
        if (deletedCount > 0) appendLog(`历史记录未保留本地文件，已清理 ${deletedCount} 个下载文件。`)
      }
      await applyHistoryStorageLimits()
      await refreshHistory()
      appendLog("历史记录已写入。")
      latestProgressRef.current = { fraction: 1, stage: t.done }
      latestStatusRef.current = `${t.downloadSuccess}：${download.fileName} · ${postResult.message}`
      setDownloadProgress(latestProgressRef.current)
      setStatus(latestStatusRef.current)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (cancelRequestedRef.current || message.includes("取消") || message.toLowerCase().includes("cancel")) {
        if (downloadRunIdRef.current === runId) {
          appendLog(t.canceled)
          latestStatusRef.current = t.ready
          setStatus(t.ready)
        }
        return
      }
      if (downloadRunIdRef.current !== runId) return
      appendLog(`下载失败：${message}`)
      latestStatusRef.current = `${t.downloadFailed}：${message}`
      setStatus(latestStatusRef.current)
      if (!retriedAfterCookieLogin && isCookieLoginRequiredError(message)) {
        appendLog("该网站可能需要登录，正在打开内置浏览器。")
        setLoading(false)
        const loggedIn = await openCookieLoginBrowser(url, true)
        if (loggedIn) {
          appendLog("登录浏览器已关闭，自动重试下载。")
          retryAfterLoginInput = rawInput
        }
      }
      if (!retryAfterLoginInput) {
        await Dialog.alert({
          title: t.downloadFailed,
          message,
        })
      }
    } finally {
      if (downloadRunIdRef.current === runId) {
        setLoading(false)
        cancelRequestedRef.current = false
        await clearDownloadCancelFlag()
      }
    }
    if (retryAfterLoginInput) {
      await handleDownload(retryAfterLoginInput, true)
    }
  }

  const cancelDownload = async () => {
    if (!loading) return
    cancelRequestedRef.current = true
    downloadRunIdRef.current += 1
    setShowAddActions(false)
    setLoading(false)
    setInputURL("")
    latestProgressRef.current = { fraction: 0, stage: t.preparing }
    latestStatusRef.current = t.ready
    setDownloadProgress(latestProgressRef.current)
    setStatus(latestStatusRef.current)
    appendLog(t.cancelRequested)
    await requestDownloadCancel()
    void (async () => {
      await sleep(1500)
      await cleanupCurrentDownloadFiles()
    })()
  }

  const handleClearHistory = async () => {
    const result = await Dialog.actionSheet({
      title: t.clearHistory,
      message: t.clearHistoryMessage,
      actions: [{ label: t.clearHistoryConfirm, destructive: true }],
      cancelButton: true,
    })

    if (result !== 0) return

    let deletedFromHistory = 0
    for (const item of history) {
      deletedFromHistory += await deleteHistoryRecordAndFiles(item)
    }
    const deletedResidual = await removeDownloadCacheDirectories()
    await clearHistoryRecords()
    await refreshHistory()
    setStatus(`已清空历史记录，删除 ${deletedFromHistory + deletedResidual} 个本地文件。`)
  }

  const chooseDefaultSaveMode = async () => {
    const result = await Dialog.actionSheet({
      title: t.defaultSaveMode,
      message: "下载成功后默认如何处理文件？",
      actions: [
        { label: t.askEveryTime },
        { label: t.saveToPhotos },
        { label: t.exportToFiles },
      ],
      cancelButton: true,
    })

    if (result == null) return

    const nextMode: SaveMode = result === 1 ? "photos" : result === 2 ? "files" : "ask"
    updatePreferences({
      ...preferences,
      defaultSaveMode: nextMode,
    })
    setStatus(`${t.defaultSaveMode}：${saveModeLabel(nextMode)}`)
  }

  const saveModeLabel = (mode: SaveMode) => {
    if (mode === "photos") return t.saveToPhotos
    if (mode === "files") return t.exportToFiles
    return t.askEveryTime
  }

  const cacheLimitLabel = (value: number | null) => {
    return value == null ? t.unlimited : `${value} MB`
  }

  const recordLimitLabel = (value: number | null) => {
    return value == null ? t.unlimited : `${value}`
  }

  const cacheLimitSliderValue = (value: number | null) => {
    return value == null ? 51 : Math.max(1, Math.min(50, Math.round(value / 100)))
  }

  const cacheLimitFromSliderValue = (value: number) => {
    const rounded = Math.max(1, Math.min(51, Math.round(value)))
    return rounded >= 51 ? null : rounded * 100
  }

  const recordLimitSliderValue = (value: number | null) => {
    return value == null ? 51 : Math.max(1, Math.min(50, Math.round(value)))
  }

  const recordLimitFromSliderValue = (value: number) => {
    const rounded = Math.max(1, Math.min(51, Math.round(value)))
    return rounded >= 51 ? null : rounded
  }

  const updateHistoryStoragePreferences = (next: Preferences) => {
    updatePreferences(next)
    void pruneHistoryStorage({
      maxCacheBytes: next.historyCacheLimitMB == null ? null : next.historyCacheLimitMB * 1024 * 1024,
      maxRecordCount: next.historyRecordLimit,
    }).then(async (cleanup) => {
      await refreshHistory()
      if (cleanup.deletedRecords > 0 || cleanup.deletedFiles > 0) {
        setStatus(`历史缓存清理完成：删除 ${cleanup.deletedRecords} 条记录、${cleanup.deletedFiles} 个文件。`)
      }
    })
  }

  const chooseLanguage = async () => {
    const result = await Dialog.actionSheet({
      title: t.chooseLanguage,
      actions: [
        { label: t.languageSystem },
        { label: t.languageZh },
        { label: t.languageEn },
      ],
      cancelButton: true,
    })

    if (result == null) return
    const nextLanguage: LanguageMode = result === 1 ? "zh" : result === 2 ? "en" : "system"
    updatePreferences({
      ...preferences,
      language: nextLanguage,
    })
  }

  const checkYtDlp = async () => {
    if (ytDlpCheckingRef.current) return
    ytDlpCheckingRef.current = true
    setYtDlpBusy(true)
    setYtDlpStatus(t.checkingYtDlp)
    try {
      const version = await getYtDlpVersion()
      updateYtDlpPreference(Boolean(version), version)
    } catch (error) {
      setYtDlpStatus(`${t.downloadFailed}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      ytDlpCheckingRef.current = false
      setYtDlpBusy(false)
    }
  }

  const installYtDlp = async () => {
    setYtDlpBusy(true)
    setYtDlpStatus(t.updatingYtDlp)
    try {
      await installOrUpdateYtDlp()
      const version = await getYtDlpVersion()
      updateYtDlpPreference(Boolean(version), version)
      setYtDlpStatus(version ? `${t.ytDlpUpdated}：${version}` : t.ytDlpMissing)
    } catch (error) {
      setYtDlpStatus(`${t.downloadFailed}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setYtDlpBusy(false)
    }
  }


  const openSavedFiles = async () => {
    await ensureDownloadDirectories()
    await Navigation.present({
      element: <SavedFilesPage t={t} />,
    })
  }

  const openAboutPage = async () => {
    await Navigation.present({
      element: <AboutPage t={t} />,
    })
  }

  const renderHistoryPage = () => (
    <NavigationStack>
      <List
        navigationTitle={t.history}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={t.close} action={dismiss} />,
          topBarTrailing: <Button title="" systemImage="folder" action={() => void openSavedFiles()} />,
        }}
      >
        <Section
          header={<Text>{`${t.historyCount} (${history.length})`}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">{t.historyFooter}</Text>}
        >
          {history.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">{t.emptyHistory}</Text>
          ) : (
            history.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                onRefresh={refreshHistory}
                onStatus={setStatus}
                onRedownload={redownloadFromHistory}
              />
            ))
          )}
        </Section>

        <Section title={t.moreActions}>
          <Button title={t.clearHistory} role="destructive" action={() => void handleClearHistory()} />
        </Section>
      </List>
    </NavigationStack>
  )

  const renderDownloadPage = () => (
    <NavigationStack>
      <List
        navigationTitle={t.download}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={t.close} action={dismiss} />,
          topBarTrailing: (
            <HStack spacing={8}>
              <Button title="" systemImage="globe" action={() => void openCookieLoginBrowser()} />
            </HStack>
          ),
        }}
      >
        <Section
          header={<Text>{t.currentTask}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">{t.currentTaskFooter}</Text>}
        >
          {inputURL ? (
            <HStack
              spacing={8}
              onTapGesture={loading ? undefined : retryCurrentTask}
              contextMenu={{
                menuItems: <Button title={t.retryCurrentTask} systemImage="arrow.clockwise" action={retryCurrentTask} disabled={loading} />,
              }}
            >
              <Text lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{inputURL}</Text>
              <Image systemName="arrow.clockwise" foregroundStyle={loading ? "secondaryLabel" : "systemBlue"} />
            </HStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">{t.noLinkAdded}</Text>
          )}
        </Section>

        <Section
          header={<Text>{t.downloadLog}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">{t.downloadLogFooter}</Text>}
        >
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: "infinity", height: 220 }} onTapGesture={() => void copyDownloadLogs()}>
                  <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {downloadLogs.length === 0 ? (
                      <Text foregroundStyle="secondaryLabel">{t.noLogs}</Text>
                    ) : (
                      downloadLogs.map((log, index) => (
                        <Text key={`${index}-${log}`} font="caption" foregroundStyle="secondaryLabel">{localizeRuntimeText(log, preferences.language)}</Text>
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

        <Section title={t.status}>
          {loading ? (
            <VStack alignment="leading" spacing={8} onTapGesture={() => void copyDownloadStatus()}>
              <ProgressView value={downloadProgress.fraction} total={1} />
              <Text>{localizeRuntimeText(downloadProgress.stage, preferences.language)}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{t.progress}：{Math.round(downloadProgress.fraction * 100)}%</Text>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel" onTapGesture={() => void copyDownloadStatus()}>{localizeRuntimeText(status, preferences.language)}</Text>
          )}
        </Section>

      </List>
    </NavigationStack>
  )

  const renderSettingsPage = () => (
    <NavigationStack>
      <List
        navigationTitle={t.settings}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={t.close} action={dismiss} />,
        }}
      >
        <Section title={t.preferences}>
          <Text foregroundStyle="secondaryLabel">
            {t.defaultSaveMode}：{saveModeLabel(preferences.defaultSaveMode)}
          </Text>
          <Button title={t.changeDefaultSaveMode} action={() => void chooseDefaultSaveMode()} />
          <Toggle
            title={t.preferNoWatermark}
            value={preferences.preferNoWatermark}
            onChanged={(value) => updatePreferences({
              ...preferences,
              preferNoWatermark: value,
            })}
          />
          <Toggle
            title={t.keepHistoryFiles}
            value={preferences.keepHistoryFiles}
            onChanged={(value) => {
              const next = {
                ...preferences,
                keepHistoryFiles: value,
              }
              updatePreferences(next)
              if (value) {
                void pruneHistoryStorage({
                  maxCacheBytes: next.historyCacheLimitMB == null ? null : next.historyCacheLimitMB * 1024 * 1024,
                  maxRecordCount: next.historyRecordLimit,
                }).then(refreshHistory)
              }
            }}
          />
          {preferences.keepHistoryFiles ? (
            <>
              <Text foregroundStyle="secondaryLabel">{t.maxHistoryCache}：{cacheLimitLabel(preferences.historyCacheLimitMB)}</Text>
              <Slider
                value={cacheLimitSliderValue(preferences.historyCacheLimitMB)}
                min={1}
                max={51}
                step={1}
                label={<Text>{t.maxHistoryCache}</Text>}
                onChanged={(value) => {
                  updateHistoryStoragePreferences({
                    ...preferences,
                    historyCacheLimitMB: cacheLimitFromSliderValue(value),
                  })
                }}
              />
              <Text foregroundStyle="secondaryLabel">{t.historyRecordLimit}：{recordLimitLabel(preferences.historyRecordLimit)}</Text>
              <Slider
                value={recordLimitSliderValue(preferences.historyRecordLimit)}
                min={1}
                max={51}
                step={1}
                label={<Text>{t.historyRecordLimit}</Text>}
                onChanged={(value) => {
                  updateHistoryStoragePreferences({
                    ...preferences,
                    historyRecordLimit: recordLimitFromSliderValue(value),
                  })
                }}
              />
            </>
          ) : null}
        </Section>
        <Section title={t.tools}>
          <HStack spacing={8}>
            {ytDlpBusy ? <ProgressView /> : null}
            <Text foregroundStyle="secondaryLabel">{ytDlpStatus || ytDlpStatusText(preferences, t)}</Text>
            <Spacer />
          </HStack>
          <Button title={t.checkYtDlp} systemImage="checkmark.circle" action={() => void checkYtDlp()} />
          <Button title={t.updateYtDlp} systemImage="arrow.triangle.2.circlepath" action={() => void installYtDlp()} />
        </Section>
        <Section title={t.language}>
          <Text foregroundStyle="secondaryLabel">{languageLabel(preferences.language, t)}</Text>
          <Button title={t.chooseLanguage} systemImage="globe" action={() => void chooseLanguage()} />
        </Section>
        <Section>
          <Button title={t.about} systemImage="info.circle" action={() => void openAboutPage()} />
        </Section>
      </List>
    </NavigationStack>
  )

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={releaseNotesSheet}
      toast={toastMessage ? {
        message: toastMessage,
        isPresented: toastPresented,
        onChanged: setToastPresented,
        position: "top",
        duration: 2,
      } : undefined}
    >
      <TabView
        selection={activeTab as any}
        tint="systemPink"
        tabViewStyle="sidebarAdaptable"
        tabBarMinimizeBehavior="onScrollDown"
      >
        <Tab title={t.history} systemImage="clock.arrow.circlepath" value={HISTORY_TAB}>
          {renderHistoryPage()}
        </Tab>

        <Tab title={t.download} systemImage="arrow.down.circle.fill" value={DOWNLOAD_TAB}>
          {renderDownloadPage()}
        </Tab>

        <Tab title={t.settings} systemImage="gearshape.fill" value={SETTINGS_TAB}>
          {renderSettingsPage()}
        </Tab>
      </TabView>
      <AddButtonCluster
        visible={showAddActions}
        loading={loading}
        onToggle={toggleAddActions}
        onPaste={() => void downloadFromClipboard()}
        onManual={() => void openManualAddDialog()}
        onCancel={() => void cancelDownload()}
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
