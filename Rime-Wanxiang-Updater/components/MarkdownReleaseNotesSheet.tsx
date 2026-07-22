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

type MarkdownReleaseNotesSheetConfig = {
  markdownFile?: string
  storageKey?: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
  markAsSeenOnDismiss?: boolean
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

export function MarkdownReleaseNotesSheet(props: {
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

export function useMarkdownReleaseNotesSheet(config: MarkdownReleaseNotesSheetConfig = {}) {
  const markdownFile = config.markdownFile ?? DEFAULT_RELEASE_NOTES_FILE
  const storageKey = config.storageKey ?? `release-notes:${markdownFile}:last-seen-hash`
  const markAsSeenOnDismiss = config.markAsSeenOnDismiss ?? true

  const [releaseNotesContent, setReleaseNotesContent] = useState("")
  const [releaseNotesHash, setReleaseNotesHash] = useState("")
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

  useEffect(() => {
    async function loadReleaseNotes() {
      const filePath = Path.join(Script.directory, markdownFile)
      const exists = await FileManager.exists(filePath)
      if (!exists) return

      const content = normalizeMarkdownContent(await FileManager.readAsString(filePath))
      if (!content) return

      const contentHash = hashString(content)
      const lastSeenHash = Storage.get<string>(storageKey)
      if (lastSeenHash === contentHash) return

      setReleaseNotesContent(content)
      setReleaseNotesHash(contentHash)
      setShowReleaseNotes(true)
    }

    void loadReleaseNotes()
  }, [])

  function setReleaseNotesPresented(isPresented: boolean) {
    if (!isPresented && markAsSeenOnDismiss && releaseNotesHash) {
      Storage.set(storageKey, releaseNotesHash)
    }
    setShowReleaseNotes(isPresented)
  }

  return {
    isPresented: showReleaseNotes,
    onChanged: setReleaseNotesPresented,
    content: (
      <MarkdownReleaseNotesSheet
        content={releaseNotesContent}
        title={config.title}
        theme={config.theme}
        detents={config.detents}
      />
    ),
  }
}
