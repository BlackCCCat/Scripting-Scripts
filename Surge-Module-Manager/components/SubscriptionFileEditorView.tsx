import { Button, Editor, NavigationStack, VStack, useEffect, useRef, useState } from "scripting"
import { writeSubscriptionFile, type Subscription } from "../utils/subscriptions"

export function SubscriptionFileEditorView(props: { item: Subscription; content: string; onSaved: () => void }) {
  const latestContent = useRef(props.content)
  const [controller] = useState(() => {
    const editor = new EditorController({ content: props.content, ext: "txt" })
    editor.onContentChanged = content => { latestContent.current = content }
    return editor
  })
  useEffect(() => () => controller.dispose(), [controller])

  async function save() {
    try {
      Keyboard.hide()
      await new Promise<void>(resolve => setTimeout(resolve, 160))
      await writeSubscriptionFile(props.item, latestContent.current)
      props.onSaved()
    } catch (error: any) {
      await Dialog.alert({ title: "保存文件失败", message: String(error?.message ?? error) })
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={`${props.item.fileName}.dconf`}
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["large"]}
        presentationDragIndicator="visible"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        toolbar={{ topBarTrailing: <Button title="保存" action={() => { HapticFeedback.mediumImpact(); void save() }} /> }}
      >
        <Editor
          controller={controller}
          scriptName={props.item.name}
          showAccessoryView
          searchEnabled
          ignoresSafeArea={{ regions: "container", edges: "bottom" }}
        />
      </VStack>
    </NavigationStack>
  )
}
