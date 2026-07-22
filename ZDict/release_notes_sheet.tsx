import {
  Markdown,
  NavigationStack,
  Path,
  Script,
  ScrollView,
  useEffect,
  useState,
  type MarkdownProps,
  type PresentationDetent,
} from "scripting"

type MarkdownReleaseNotesSheetConfig = {
  markdownFile?: string
  storageKey?: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
}

const DEFAULT_RELEASE_NOTES_FILE = "release-notes.md"
const DEFAULT_STORAGE_KEY = "zdict:release-notes:last-seen-hash"

function normalizeMarkdownContent(content: string) {
  return content.replace(/\r\n/g, "\n").trim()
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function storage() {
  return (globalThis as any).Storage
}

function readLastSeenHash(key: string) {
  return String(storage()?.get?.(key) ?? "").trim()
}

function writeLastSeenHash(key: string, value: string) {
  storage()?.set?.(key, value)
}

function ZDictReleaseNotesSheet(props: {
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
        navigationTitle={props.title ?? "更新内容"}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationBackground="clear"
        presentationDragIndicator="visible"
        presentationDetents={props.detents ?? ["medium", "large"]}
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

export function useZDictReleaseNotesSheet(
  config: MarkdownReleaseNotesSheetConfig = {}
) {
  const markdownFile = config.markdownFile ?? DEFAULT_RELEASE_NOTES_FILE
  const storageKey = config.storageKey ?? DEFAULT_STORAGE_KEY

  const [content, setContent] = useState("")
  const [contentHash, setContentHash] = useState("")
  const [isPresented, setIsPresented] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadReleaseNotes() {
      const filePath = Path.join(Script.directory, markdownFile)
      const exists = await FileManager.exists(filePath)
      if (!exists || cancelled) return

      const rawContent = await FileManager.readAsString(filePath)
      if (cancelled) return

      const normalizedContent = normalizeMarkdownContent(rawContent)
      if (!normalizedContent) return

      const nextHash = hashString(normalizedContent)
      const lastSeenHash = readLastSeenHash(storageKey)
      if (lastSeenHash === nextHash) return

      setContent(normalizedContent)
      setContentHash(nextHash)
      setIsPresented(true)
    }

    void loadReleaseNotes()

    return () => {
      cancelled = true
    }
  }, [markdownFile, storageKey])

  function setPresented(nextPresented: boolean) {
    if (!nextPresented && contentHash) {
      writeLastSeenHash(storageKey, contentHash)
    }
    setIsPresented(nextPresented)
  }

  return {
    isPresented,
    onChanged: setPresented,
    content: (
      <ZDictReleaseNotesSheet
        content={content}
        title={config.title}
        theme={config.theme}
        detents={config.detents}
      />
    ),
  }
}
