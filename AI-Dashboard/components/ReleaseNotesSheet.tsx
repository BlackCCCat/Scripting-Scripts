import {
  Button,
  Device,
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

export type ReleaseNotesSheetConfig = {
  markdownFile?: string
  storageKey?: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
}

const DEFAULT_CHANGELOG_FILE = "changelog.md"

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

export function ReleaseNotesSheet(props: {
  content: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
  onDismiss: () => void
}) {
  const useGlassPresentation =
    Number.parseInt(Device.systemVersion, 10) >= 26

  return (
    <NavigationStack
      presentationBackground={useGlassPresentation ? "clear" : undefined}
    >
      <ScrollView
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle={props.title ?? "更新说明"}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={props.detents ?? ["medium", "large"]}
        presentationBackground={useGlassPresentation ? "clear" : undefined}
        padding={{ top: 20, leading: 18, bottom: 20, trailing: 18 }}
        toolbar={{
          topBarTrailing: (
            <Button
              title="完成"
              action={props.onDismiss}
            />
          ),
        }}
      >
        <Markdown
          content={props.content}
          theme={props.theme ?? "basic"}
          useDefaultHighlighterTheme={true}
          scrollable={false}
          background="clear"
        />
      </ScrollView>
    </NavigationStack>
  )
}

export function useReleaseNotesSheet(config: ReleaseNotesSheetConfig = {}) {
  const markdownFile = config.markdownFile ?? DEFAULT_CHANGELOG_FILE
  const storageKey =
    config.storageKey ??
    `ai-dashboard:release-notes:${markdownFile}:last-seen-hash`

  const [content, setContent] = useState<string>("")
  const [contentHash, setContentHash] = useState<string>("")
  const [isPresented, setIsPresented] = useState<boolean>(false)

  useEffect(() => {
    let isCancelled = false
    async function loadReleaseNotes() {
      try {
        const filePath = Path.join(Script.directory, markdownFile)
        const exists = await FileManager.exists(filePath)
        if (!exists) return

        const nextContent = normalizeMarkdownContent(
          await FileManager.readAsString(filePath)
        )
        if (!nextContent) return

        const nextHash = hashString(nextContent)
        const lastSeen = Storage.get<string>(storageKey)

        if (!isCancelled) {
          setContent(nextContent)
          setContentHash(nextHash)
          if (lastSeen !== nextHash) {
            setIsPresented(true)
          }
        }
      } catch (err) {
        console.warn("loadReleaseNotes error:", err)
      }
    }

    void loadReleaseNotes()
    return () => {
      isCancelled = true
    }
  }, [])

  function handlePresentedChange(nextValue: boolean) {
    if (!nextValue && contentHash) {
      try {
        Storage.set(storageKey, contentHash)
      } catch (err) {
        console.warn("save release-notes hash error:", err)
      }
    }
    setIsPresented(nextValue)
  }

  function showManually() {
    if (!content) {
      void (async () => {
        try {
          const filePath = Path.join(Script.directory, markdownFile)
          const exists = await FileManager.exists(filePath)
          if (exists) {
            const nextContent = normalizeMarkdownContent(
              await FileManager.readAsString(filePath)
            )
            if (nextContent) {
              setContent(nextContent)
              setContentHash(hashString(nextContent))
            }
          }
        } catch (err) {
          console.warn("showManually loadReleaseNotes error:", err)
        }
        setIsPresented(true)
      })()
      return
    }
    setIsPresented(true)
  }

  return {
    isPresented,
    setIsPresented,
    onChanged: handlePresentedChange,
    show: showManually,
    content: (
      <ReleaseNotesSheet
        content={content}
        title={config.title}
        theme={config.theme}
        detents={config.detents}
        onDismiss={() => handlePresentedChange(false)}
      />
    ),
  }
}
