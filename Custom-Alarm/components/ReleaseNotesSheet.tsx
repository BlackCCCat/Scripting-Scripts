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

function ReleaseNotesSheet(props: {
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
  const storageKey = config.storageKey ?? `custom-alarm:release-notes:${markdownFile}:last-seen-hash`

  const [content, setContent] = useState("")
  const [contentHash, setContentHash] = useState("")
  const [isPresented, setIsPresented] = useState(false)

  useEffect(() => {
    async function loadReleaseNotes() {
      const filePath = Path.join(Script.directory, markdownFile)
      const exists = await FileManager.exists(filePath)
      if (!exists) return

      const nextContent = normalizeMarkdownContent(await FileManager.readAsString(filePath))
      if (!nextContent) return

      const nextHash = hashString(nextContent)
      if (Storage.get<string>(storageKey) === nextHash) return

      setContent(nextContent)
      setContentHash(nextHash)
      setIsPresented(true)
    }

    void loadReleaseNotes()
  }, [])

  function handlePresentedChange(nextValue: boolean) {
    if (!nextValue && contentHash) {
      Storage.set(storageKey, contentHash)
    }
    setIsPresented(nextValue)
  }

  return {
    isPresented,
    onChanged: handlePresentedChange,
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
