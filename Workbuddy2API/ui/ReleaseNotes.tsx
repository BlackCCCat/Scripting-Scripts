import { Button, Device, Markdown, NavigationStack, Path, Script, ScrollView, useEffect, useState } from "scripting"
import { markReleaseNotesSeen, shouldShowReleaseNotes } from "../local/store"

function ReleaseNotesSheet({ content, onDone }: { content: string; onDone: () => void }) {
  const background = Number.parseInt(Device.systemVersion, 10) >= 26 ? "clear" : "systemBackground"
  return <NavigationStack presentationBackground={background}>
    <ScrollView navigationTitle="更新说明" navigationBarTitleDisplayMode="inline"
      toolbar={{ confirmationAction: <Button title="完成" action={onDone} /> }}
      presentationDetents={["medium", "large"]} presentationDragIndicator="visible"
      presentationBackground={background} padding={{ horizontal: 18, top: 20, bottom: 24 }}>
      <Markdown content={content} theme="basic" scrollable={false} />
    </ScrollView>
  </NavigationStack>
}

export function useReleaseNotes() {
  const [content, setContent] = useState("")
  const [presented, setPresented] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const path = Path.join(Script.directory, "changelog.md")
        if (!await FileManager.exists(path)) return
        const markdown = (await FileManager.readAsString(path)).trim()
        if (!active || !shouldShowReleaseNotes(markdown)) return
        setContent(markdown)
        setPresented(true)
      } catch (error) { console.warn("读取更新说明失败", error) }
    }
    void load()
    return () => { active = false }
  }, [])

  function onChanged(value: boolean) {
    if (!value && content && !markReleaseNotesSeen(content)) console.warn("更新说明阅读状态保存失败")
    setPresented(value)
  }

  return { isPresented: presented, onChanged, content: <ReleaseNotesSheet content={content} onDone={() => onChanged(false)} /> }
}
