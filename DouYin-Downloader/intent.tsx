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
import { downloadVideo, type DownloadProgress } from "./services/douyin"
import { postDownloadAction } from "./services/file-actions"
import { initDatabase, insertHistory } from "./services/history"
import { getPreferences } from "./services/preferences"
import { extractFirstURL } from "./utils/common"

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
  const message = error instanceof Error ? error.message : String(error)
  await Pasteboard.setString(message)
  await Dialog.alert({
    title: "抖音下载失败",
    message: `${message}\n\n错误信息已复制到剪贴板。`,
    buttonLabel: "好",
  })
  Script.exit(Intent.text(`抖音下载失败：${message}`))
}

function IntentDownloadView(props: {
  url: string
}) {
  const logProxyRef = useRef<any>()
  const logsRef = useRef<string[]>([])
  const [status, setStatus] = useState("准备开始下载。")
  const [progress, setProgress] = useState<DownloadProgress>({
    fraction: 0.02,
    stage: "准备开始",
  })
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
    void (async () => {
      try {
        const preferences = getPreferences()
        await initDatabase()
        appendLog(`收到分享下载任务：${props.url}`)
        setStatus("正在分析分享页面…")

        const download = await downloadVideo(props.url, {
          preferNoWatermark: preferences.preferNoWatermark,
          onProgress: (nextProgress: DownloadProgress) => {
            setProgress(nextProgress)
            setStatus(nextProgress.stage)
          },
          onLog: appendLog,
        })

        setProgress({ fraction: 0.96, stage: "正在写入历史记录" })
        setStatus("正在写入历史记录…")
        await insertHistory(download)
        appendLog("历史记录已写入。")

        setProgress({ fraction: 0.98, stage: "正在执行下载后动作" })
        setStatus("下载完成，正在根据偏好处理文件…")
        const message = await postDownloadAction(download, preferences.defaultSaveMode)

        setProgress({ fraction: 1, stage: "全部完成" })
        setStatus(message)
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
        navigationTitle="抖音下载"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => Script.exit(Intent.text("已取消下载。"))} />,
        }}
      >
        <Section title="进度">
          <VStack alignment="leading" spacing={8}>
            <ProgressView value={progress.fraction} total={1} />
            <Text>{progress.stage}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">当前进度：{Math.round(progress.fraction * 100)}%</Text>
          </VStack>
        </Section>

        <Section title="状态">
          <Text foregroundStyle="secondaryLabel">{status}</Text>
        </Section>

        <Section title="下载日志">
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: "infinity", height: 260 }}>
                  <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {logs.length === 0 ? (
                      <Text foregroundStyle="secondaryLabel">正在准备日志…</Text>
                    ) : (
                      logs.map((log, index) => (
                        <Text key={`${index}-${log}`} font="caption" foregroundStyle="secondaryLabel">{log}</Text>
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
      throw new Error("未从分享内容中找到可用链接，请确认分享的是抖音链接或包含 URL 的文本。")
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
