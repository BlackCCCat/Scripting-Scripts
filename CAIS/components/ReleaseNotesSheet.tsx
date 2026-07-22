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

type ReleaseNotesSheetConfig = {
  markdownFile?: string
  storageKey?: string
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

function getStorage(): any {
  return (globalThis as any).Storage
}

function getFileManager(): any {
  return (globalThis as any).FileManager
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
  const storageKey = config.storageKey ?? `cais:release-notes:${markdownFile}:last-seen-hash`
  const [content, setContent] = useState("")
  const [contentHash, setContentHash] = useState("")
  const [isPresented, setIsPresented] = useState(false)

  useEffect(() => {
    async function loadReleaseNotes() {
      const fm = getFileManager()
      const storage = getStorage()
      if (!fm || !storage) return

      const filePath = Path.join(Script.directory, markdownFile)
      const exists = typeof fm.exists === "function"
        ? await fm.exists(filePath)
        : Boolean(fm.existsSync?.(filePath))
      if (!exists) return

      const raw = typeof fm.readAsString === "function"
        ? await fm.readAsString(filePath)
        : String(fm.readAsStringSync?.(filePath) ?? "")
      const nextContent = normalizeMarkdownContent(raw)
      if (!nextContent) return

      const nextHash = hashString(nextContent)
      if (storage.get?.(storageKey) === nextHash) return

      setContent(nextContent)
      setContentHash(nextHash)
      setIsPresented(true)
    }

    void loadReleaseNotes()
  }, [])

  function setPresented(nextPresented: boolean) {
    if (!nextPresented && contentHash) {
      getStorage()?.set?.(storageKey, contentHash)
    }
    setIsPresented(nextPresented)
  }

  return {
    isPresented,
    onChanged: setPresented,
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
