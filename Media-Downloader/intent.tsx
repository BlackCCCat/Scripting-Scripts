import {
  Button,
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
  Text,
  VStack,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { type DownloadProgress } from "./services/douyin"
import { postDownloadAction } from "./services/file-actions"
import { initDatabase, insertHistory } from "./services/history"
import { downloadMedia } from "./services/media"
import { getPreferences } from "./services/preferences"
import { extractFirstURL } from "./utils/common"
import { getI18n, localizeRuntimeText, resolveLanguage } from "./utils/i18n"

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

async function handleError(error: unknown) {
  const preferences = getPreferences()
  const t = getI18n(preferences.language)
  const message = error instanceof Error ? error.message : String(error)
  const localizedMessage = localizeRuntimeText(message, preferences.language)
  await Pasteboard.setString(message)
  await Dialog.alert({
    title: t.downloadFailed,
    message: resolveLanguage(preferences.language) === "zh"
      ? `${localizedMessage}\n\n错误信息已复制到剪贴板。`
      : `${localizedMessage}\n\nThe error message has been copied to the clipboard.`,
    buttonLabel: t.close,
  })
  Script.exit(Intent.text(`${t.downloadFailed}: ${localizedMessage}`))
}

function IntentDownloadView(props: {
  url: string
}) {
  const preferences = getPreferences()
  const t = getI18n(preferences.language)
  const logProxyRef = useRef<any>()
  const logsRef = useRef<string[]>([])
  const [status, setStatus] = useState(t.ready)
  const [progress, setProgress] = useState<DownloadProgress>({
    fraction: 0.02,
    stage: t.preparing,
  })
  const latestProgressRef = useRef<DownloadProgress>({
    fraction: 0.02,
    stage: t.preparing,
  })
  const latestStatusRef = useRef(t.ready)
  const runningRef = useRef(true)
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
    const scrollLatest = () => {
      try {
        logProxyRef.current?.scrollTo?.("intentDownloadLogBottom", "bottom")
      } catch {}
    }
    scrollLatest()
    const timer = setTimeout(scrollLatest, 120)
    return () => clearTimeout(timer)
  }, [logs.length])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      if (stopped) return
      if (!runningRef.current) return
      setProgress({ ...latestProgressRef.current })
      setStatus(latestStatusRef.current || latestProgressRef.current.stage)
      timer = setTimeout(tick, 250)
    }
    timer = setTimeout(tick, 250)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await initDatabase()
        appendLog(`收到分享下载任务：${props.url}`)
        latestStatusRef.current = t.analyzing
        setStatus(latestStatusRef.current)

        const download = await downloadMedia(props.url, {
          preferNoWatermark: preferences.preferNoWatermark,
          onProgress: (nextProgress: DownloadProgress) => {
            latestProgressRef.current = nextProgress
            latestStatusRef.current = nextProgress.stage
            setProgress({ ...nextProgress })
            setStatus(nextProgress.stage)
          },
          onLog: appendLog,
        })

        latestProgressRef.current = { fraction: 0.96, stage: t.writingHistory }
        latestStatusRef.current = t.writingHistory
        setProgress(latestProgressRef.current)
        setStatus(latestStatusRef.current)
        await insertHistory(download)
        appendLog("历史记录已写入。")

        latestProgressRef.current = { fraction: 0.98, stage: t.postAction }
        latestStatusRef.current = t.postAction
        setProgress(latestProgressRef.current)
        setStatus(latestStatusRef.current)
        const message = await postDownloadAction(download, preferences.defaultSaveMode)

        latestProgressRef.current = { fraction: 1, stage: t.done }
        latestStatusRef.current = message
        runningRef.current = false
        setProgress(latestProgressRef.current)
        setStatus(latestStatusRef.current)
        appendLog(message)

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
            localFilePaths: download.files.map((file) => file.filePath),
            mediaType: download.mediaType,
            preferNoWatermark: preferences.preferNoWatermark,
            matchedCandidateLabel: download.matchedCandidateLabel,
            logs: logsRef.current,
          })
        )
      } catch (error) {
        await handleError(error)
      }
    })()
  }, [])

  return (
    <NavigationStack>
      <List
        navigationTitle={t.appName}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={t.close} action={() => Script.exit(Intent.text(t.cancel))} />,
        }}
      >
        <Section title={t.progress}>
          <VStack alignment="leading" spacing={8}>
            <ProgressView value={progress.fraction} total={1} />
            <Text>{localizeRuntimeText(progress.stage, preferences.language)}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{t.progress}：{Math.round(progress.fraction * 100)}%</Text>
          </VStack>
        </Section>

        <Section title={t.status}>
          <Text foregroundStyle="secondaryLabel">{localizeRuntimeText(status, preferences.language)}</Text>
        </Section>

        <Section title={t.downloadLog}>
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: "infinity", height: 260 }}>
                  <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {logs.length === 0 ? (
                      <Text foregroundStyle="secondaryLabel">{t.noLogs}</Text>
                    ) : (
                      logs.map((log, index) => (
                        <Text key={`${index}-${log}`} font="caption" foregroundStyle="secondaryLabel">{localizeRuntimeText(log, preferences.language)}</Text>
                      ))
                    )}
                    <Rectangle
                      key="intentDownloadLogBottom"
                      foregroundStyle="clear"
                      frame={{ maxWidth: "infinity", height: 1 }}
                    />
                  </VStack>
                </ScrollView>
              )
            }}
          </ScrollViewReader>
        </Section>
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
