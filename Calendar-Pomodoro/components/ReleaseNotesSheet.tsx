// Scripting 组件与 API：
// - Markdown 用于渲染更新说明
// - sheet 内容使用透明 ScrollView，避免 Markdown 默认背景形成白色遮罩
// - Path/Script 用于读取脚本目录下的 release-notes.md
import {
  Markdown,
  NavigationStack,
  Path,
  ScrollView,
  Script,
  useEffect,
  useState,
  type MarkdownProps,
  type PresentationDetent,
} from "scripting"

// 复用项目现有设置存储，用内容 hash 记录“已读”的更新说明
import { loadSettings, saveSettings } from "../utils/settings"

type ReleaseNotesSheetConfig = {
  markdownFile?: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
}

const DEFAULT_RELEASE_NOTES_FILE = "release-notes.md"

function normalizeMarkdownContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim()
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

async function readReleaseNotes(fileName: string): Promise<string> {
  const filePath = Path.join(Script.directory, fileName)
  const fileManager = (globalThis as any).FileManager
  if (!fileManager) return ""

  const exists =
    typeof fileManager.exists === "function"
      ? await fileManager.exists(filePath)
      : typeof fileManager.existsSync === "function"
        ? fileManager.existsSync(filePath)
        : false
  if (!exists) return ""

  const content =
    typeof fileManager.readAsString === "function"
      ? await fileManager.readAsString(filePath)
      : typeof fileManager.readAsStringSync === "function"
        ? fileManager.readAsStringSync(filePath)
        : ""
  return normalizeMarkdownContent(String(content ?? ""))
}

export function ReleaseNotesSheet(props: {
  content: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
}) {
  return (
    <NavigationStack presentationBackground="clear">
      <ScrollView
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle={props.title ?? "更新说明"}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={props.detents ?? ["medium", "large"]}
        presentationBackground="clear"
        padding={{ top: 24, leading: 18, bottom: 18, trailing: 18 }}
      >
        <Markdown
          content={props.content}
          theme={props.theme ?? "basic"}
          useDefaultHighlighterTheme
          scrollable={false}
          background="clear"
        />
      </ScrollView>
    </NavigationStack>
  )
}

export function useReleaseNotesSheet(config: ReleaseNotesSheetConfig = {}) {
  const markdownFile = config.markdownFile ?? DEFAULT_RELEASE_NOTES_FILE
  const [content, setContent] = useState("")
  const [contentHash, setContentHash] = useState("")
  const [isPresented, setIsPresented] = useState(false)

  useEffect(() => {
    async function loadReleaseNotes() {
      const markdown = await readReleaseNotes(markdownFile)
      if (!markdown) return

      const hash = hashString(markdown)
      const settings = await loadSettings()
      if (settings.releaseNotesSeenHash === hash) return

      setContent(markdown)
      setContentHash(hash)
      setIsPresented(true)
    }

    void loadReleaseNotes()
  }, [])

  function handlePresentedChanged(next: boolean) {
    if (!next && contentHash) {
      void (async () => {
        const settings = await loadSettings()
        await saveSettings({ ...settings, releaseNotesSeenHash: contentHash })
      })()
    }
    setIsPresented(next)
  }

  return {
    isPresented,
    onChanged: handlePresentedChanged,
    content: (
      <ReleaseNotesSheet
        content={content}
        title={config.title}
        theme={config.theme}
        detents={config.detents}
      />
    ),
  }
}
