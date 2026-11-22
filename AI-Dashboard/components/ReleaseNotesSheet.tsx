import {
  Button,
  Device,
  Markdown,
  NavigationStack,
  Path,
  Script,
  ScrollView,
  type MarkdownProps,
  type PresentationDetent,
  useEffect,
  useState,
} from "scripting"
import { localize } from "../utils/localization"

export type ReleaseNotesSheetConfig = {
  storageKey?: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
}

const CHANGELOG_FILE = "changelog.md"

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
        tint="systemIndigo"
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle={localize(props.title ?? "更新说明")}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={props.detents ?? ["medium", "large"]}
        presentationBackground={useGlassPresentation ? "clear" : undefined}
        padding={{ top: 20, leading: 18, bottom: 20, trailing: 18 }}
        toolbar={{
          topBarTrailing: (
            <Button
              title={localize("完成")}
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
  const storageKey =
    config.storageKey ??
    `ai-dashboard:release-notes:${CHANGELOG_FILE}:last-seen-hash`

  const [notes, setNotes] = useState<{ text: string; hash: string } | null>(null)
  const content = notes?.text ?? ""
  const contentHash = notes?.hash ?? ""
  const [isPresented, setIsPresented] = useState<boolean>(false)

  async function readNotes() {
    const filePath = Path.join(Script.directory, CHANGELOG_FILE)
    if (!(await FileManager.exists(filePath))) return null
    const text = normalizeMarkdownContent(await FileManager.readAsString(filePath))
    if (!text) return null

    return { text, hash: hashString(text) }
  }

  useEffect(() => {
    let isCancelled = false
    async function loadReleaseNotes() {
      try {
        const next = await readNotes()
        if (!next || isCancelled) return
        const lastSeen = Storage.get<string>(storageKey)

        setNotes(next)
        if (lastSeen !== next.hash) {
          setIsPresented(true)
        }
      } catch (err) {
        console.warn("loadReleaseNotes error:", err)
      }
    }

    void loadReleaseNotes()
    return () => {
      isCancelled = true
    }
  }, [storageKey])

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
          const next = await readNotes()
          if (next) setNotes(next)
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
    rawContent: content,
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
