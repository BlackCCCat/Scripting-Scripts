import {
  Button,
  Intent,
  List,
  Navigation,
  NavigationStack,
  Script,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { type DownloadMediaInfo, type DownloadProgress, type DownloadSuccess } from "./services/douyin"
import { downloadAccent, DownloadBackdrop, DownloadCardRow, DownloadLogCard, DownloadTaskCard } from "./components/download-task-card"
import { postDownloadAction } from "./services/file-actions"
import { initDatabase, insertHistory, pruneHistoryStorage } from "./services/history"
import { downloadMedia } from "./services/media"
import { getPreferences, persistPreferences } from "./services/preferences"
import { extractFirstURL } from "./utils/common"
import { getI18n, localizeRuntimeText } from "./utils/i18n"

function resolveInputURL(): string | null {
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

async function removeDownloadedFiles(record: DownloadSuccess): Promise<void> {
  const files = record.files?.length ? record.files : [{
    filePath: record.filePath,
    fileName: record.fileName,
    finalURL: record.finalURL,
    bytesWritten: record.bytesWritten,
    mediaType: record.mediaType || "video",
  }]
  const seen = new Set<string>()
  for (const file of files) {
    if (!file.filePath || seen.has(file.filePath)) continue
    seen.add(file.filePath)
    try {
      if (FileManager.existsSync(file.filePath)) FileManager.removeSync(file.filePath)
    } catch {}
  }
}

async function handleError(error: unknown) {
  const preferences = getPreferences()
  const t = getI18n(preferences.language)
  const message = error instanceof Error ? error.message : String(error)
  const localizedMessage = localizeRuntimeText(message, preferences.language)
  await Dialog.alert({
    title: t.downloadFailed,
    message: localizedMessage,
    buttonLabel: t.close,
  })
  Script.exit(Intent.text(`${t.downloadFailed}: ${localizedMessage}`))
}

function IntentDownloadView(props: {
  url: string
}) {
  const preferences = getPreferences()
  const t = getI18n(preferences.language)
  const logsRef = useRef<string[]>([])
  const [status, setStatus] = useState(t.ready)
  const [taskMedia, setTaskMedia] = useState<DownloadMediaInfo | null>(null)
  const [phase, setPhase] = useState<"active" | "done" | "error">("active")
  const [progress, setProgress] = useState<DownloadProgress>({ stage: t.preparing })
  const [logs, setLogs] = useState<string[]>([])

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    const next = [...logsRef.current, `[${timestamp}] ${message}`].slice(-80)
    logsRef.current = next
    setLogs(next)
  }

  useEffect(() => {
    void (async () => {
      try {
        await initDatabase()
        appendLog(`收到分享下载任务：${props.url}`)
        setProgress({ stage: t.analyzing })
        setStatus(t.analyzing)

        const download = await downloadMedia(props.url, {
          preferNoWatermark: preferences.preferNoWatermark,
          ytDlpReady: preferences.ytDlpReady,
          onMediaInfo: setTaskMedia,
          onYtDlpStatus: (ready, version) => {
            persistPreferences({
              ...getPreferences(),
              ytDlpReady: ready,
              ytDlpVersion: version,
              ytDlpCheckedAt: new Date().toISOString(),
            })
          },
          onProgress: (nextProgress: DownloadProgress) => {
            setProgress(nextProgress)
            setStatus(nextProgress.stage)
          },
          onLog: appendLog,
        })

        setProgress({ stage: t.postAction })
        setStatus(t.postAction)
        const postResult = await postDownloadAction(download, preferences.defaultSaveMode)

        setProgress({ stage: t.writingHistory })
        setStatus(t.writingHistory)
        const preserveFiles = preferences.keepHistoryFiles || postResult.keepFilesInHistory
        await insertHistory(download, { preserveFiles })
        if (!preserveFiles) {
          await removeDownloadedFiles(download)
        }
        if (preferences.keepHistoryFiles) {
          await pruneHistoryStorage({
            maxCacheBytes: preferences.historyCacheLimitMB == null ? null : preferences.historyCacheLimitMB * 1024 * 1024,
            maxRecordCount: preferences.historyRecordLimit,
          })
        }
        appendLog("历史记录已写入。")

        setProgress({ stage: t.done })
        setPhase("done")
        setStatus(postResult.message)
        appendLog(postResult.message)

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
            logs: logsRef.current,
          })
        )
      } catch (error) {
        setPhase("error")
        const message = error instanceof Error ? error.message : String(error)
        setProgress({ stage: message })
        setStatus(message)
        await handleError(error)
      }
    })()
  }, [])

  return (
    <NavigationStack>
      <List
        navigationTitle={t.appName}
        navigationBarTitleDisplayMode="inline"
        tint={downloadAccent}
        listStyle="plain"
        scrollContentBackground="hidden"
        background={<DownloadBackdrop />}
        toolbar={{
          cancellationAction: <Button title={t.close} action={() => Script.exit(Intent.text(t.cancel))} />,
        }}
      >
        <DownloadCardRow>
          <DownloadTaskCard
            media={taskMedia}
            progress={progress}
            titleFallback={props.url}
            status={status}
            language={preferences.language}
            phase={phase}
          />
        </DownloadCardRow>
        <DownloadCardRow>
          <DownloadLogCard
            logs={logs}
            language={preferences.language}
            active={phase === "active"}
            status={status}
            onCopy={() => void Pasteboard.setString(logsRef.current.join("\n") || t.noLogs)}
          />
        </DownloadCardRow>
      </List>
    </NavigationStack>
  )
}

async function run() {
  try {
    const url = resolveInputURL()
    if (!url) {
      throw new Error("未从分享内容中找到可用链接，请确认分享的是抖音、YouTube、m3u8 链接或包含 URL 的文本。")
    }

    await Navigation.present({
      element: <IntentDownloadView url={url} />,
    })
    Script.exit()
  } catch (error) {
    await handleError(error)
  }
}

run()
