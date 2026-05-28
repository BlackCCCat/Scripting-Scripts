import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  useState,
  Image
} from "scripting"

type DeepLXEditorValue = {
  baseUrl: string
  label: string
}

export function DeepLXEditorView(props: {
  title: string
  initial?: Partial<DeepLXEditorValue>
}) {
  const dismiss = Navigation.useDismiss()
  const [label, setLabel] = useState(String(props.initial?.label ?? "DeepLX"))
  const [baseUrl, setBaseUrl] = useState(String(props.initial?.baseUrl ?? ""))

  function save() {
    const normalized = baseUrl.trim().replace(/\/+$/, "")
    if (!normalized) {
      void Dialog.alert({
        title: "无法保存",
        message: "请先填写 DeepLX 接口地址。",
      })
      return
    }

    dismiss({
      baseUrl: normalized,
      label: label.trim() || "DeepLX",
    } satisfies DeepLXEditorValue)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={{
          topBarLeading: (
            <Button action={() => dismiss()}>
            <Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF"/>
            </Button>
          ),
          topBarTrailing: (
            <Button
              title="保存"
              fontWeight="semibold" 
              foregroundStyle="#007AFF"
              action={save}
            />
          ),
        }}
      >
        <Section header={<Text>基础信息</Text>}>
          <TextField
            title="名称"
            value={label}
            onChanged={setLabel}
            prompt="例如 DeepLX 备用"
          />
        </Section>

        <Section
          header={<Text>DeepLX 接口配置</Text>}
          footer={
            <Text>
              填写 DeepLX 服务的接口地址，例如 http://localhost:1188/translate
            </Text>
          }
        >
          <TextField
            title="接口地址"
            value={baseUrl}
            onChanged={setBaseUrl}
            prompt="http://localhost:1188/translate"
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
