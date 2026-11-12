import { Button, Form, HStack, Navigation, NavigationStack, ProgressView, Section, Text, TextField, VStack, useRef, useState } from "scripting"
import { normalizeFileName, subscriptionFileExists, type Subscription, type SubscriptionEditorResult } from "../utils/subscriptions"

export function SubscriptionEditorView(props: { initial?: Subscription; busy?: boolean; onCancel: () => void; onSave: (value: SubscriptionEditorResult) => Promise<boolean> }) {
  const dismiss = Navigation.useDismiss()
  const submitting = useRef(false)
  const [name, setName] = useState(props.initial?.name ?? "")
  const [url, setUrl] = useState(props.initial?.url ?? "")

  async function save() {
    if (submitting.current) return
    submitting.current = true
    try {
      const normalizedName = props.initial ? name.trim() : normalizeFileName(name)
      if (!normalizedName) throw new Error("请输入订阅名称")
      if (!/^https?:\/\/\S+$/i.test(url.trim())) throw new Error("请输入有效的订阅链接")
      const normalizedFileName = props.initial?.fileName ?? normalizeFileName(normalizedName)
      let overwriteExisting = false
      if (!props.initial && await subscriptionFileExists(normalizedFileName)) {
        overwriteExisting = await Dialog.confirm({
          title: "覆盖已有文件？",
          message: `书签目录下已有 ${normalizedFileName}.dconf。确认后将用本次拉取的节点替换原文件内容。`,
          confirmLabel: "覆盖",
          cancelLabel: "取消",
        })
        if (!overwriteExisting) return
      }
      const saved = await props.onSave({
        subscription: { name: normalizedName, url: url.trim(), fileName: normalizedFileName },
        overwriteExisting,
      })
      if (saved) {
        dismiss()
        props.onCancel()
      }
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      submitting.current = false
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.initial ? "编辑订阅" : "添加订阅"}
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["medium", "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="取消" action={props.onCancel} />,
          topBarTrailing: <Button title="保存" action={() => {
            HapticFeedback.mediumImpact()
            void save()
          }} />,
        }}
      >
        {props.busy ? <HStack spacing={8} padding={{ top: 12, bottom: 12, leading: 20, trailing: 20 }}>
          <ProgressView progressViewStyle="circular" />
          <Text>正在拉取订阅…</Text>
        </HStack> : null}
        <Form formStyle="grouped">
          <Section header={<Text>订阅信息</Text>}>
            <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text fixedSize={{ horizontal: true, vertical: false }}>名称：</Text>
              <TextField title="" value={name} onChanged={setName} frame={{ maxWidth: "infinity", alignment: "leading" }} />
            </HStack>
            <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text fixedSize={{ horizontal: true, vertical: false }}>链接：</Text>
              <TextField title="" value={url} onChanged={setUrl} keyboardType="URL" frame={{ maxWidth: "infinity", alignment: "leading" }} />
            </HStack>
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
