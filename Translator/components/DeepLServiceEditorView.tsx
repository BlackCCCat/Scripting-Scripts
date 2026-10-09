import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  useState,
  Image,
  Picker,
  ProgressView,
} from "scripting"
import { translateWithExternalEngine } from "../utils/external_translation_engines"

type DeepLServiceEditorValue = {
  baseUrl: string
  label: string
  apiKey?: string
}

const DEEPL_ENDPOINTS = {
  free: "https://api-free.deepl.com/v2/translate",
  pro: "https://api.deepl.com/v2/translate",
}

export function DeepLServiceEditorView(props: {
  title: string
  kind: "deeplx" | "deepl"
  initial?: Partial<DeepLServiceEditorValue>
}) {
  const dismiss = Navigation.useDismiss()
  const kind = props.kind
  const serviceName = kind === "deepl" ? "DeepL" : "DeepLX"
  const [label, setLabel] = useState(String(props.initial?.label ?? serviceName))
  const [baseUrl, setBaseUrl] = useState(String(props.initial?.baseUrl ?? ""))
  const [accountType, setAccountType] = useState<"free" | "pro">(
    props.initial?.baseUrl?.startsWith("https://api.deepl.com/") ? "pro" : "free"
  )
  const [apiKey, setApiKey] = useState(String(props.initial?.apiKey ?? ""))
  const [isTesting, setIsTesting] = useState(false)
  const [testStatus, setTestStatus] = useState("")

  async function verify() {
    if (!baseUrl.trim() || (kind === "deepl" && !apiKey.trim())) {
      setTestStatus("请先填写接口地址和所需的 API Key。")
      return
    }

    setIsTesting(true)
    setTestStatus("")
    try {
      const result = await translateWithExternalEngine({
        id: "connection_test",
        kind,
        label: serviceName,
        systemImage: "d.circle",
        enabled: true,
        isBuiltIn: false,
        config: { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() },
      }, {
        sourceText: "Hello, world!",
        sourceLanguageCode: "en",
        targetLanguageCode: "zh-Hans",
      })
      setTestStatus(`验证成功：${result.translatedText}`)
    } catch (error) {
      setTestStatus(`验证失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsTesting(false)
    }
  }

  function save() {
    const normalized = baseUrl.trim().replace(/\/+$/, "")
    if (!normalized) {
      void Dialog.alert({
        title: "无法保存",
        message: `请先填写 ${serviceName} 接口地址。`,
      })
      return
    }

    if (kind === "deepl" && !apiKey.trim()) {
      void Dialog.alert({ title: "无法保存", message: "请先填写 DeepL API Key。" })
      return
    }

    dismiss({
      baseUrl: normalized,
      label: label.trim() || serviceName,
      apiKey: kind === "deepl" ? apiKey.trim() : undefined,
    } satisfies DeepLServiceEditorValue)
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
            prompt={`例如 ${serviceName} 备用`}
          />
        </Section>

        <Section
          header={<Text>{serviceName} 接口配置</Text>}
          footer={
            <Text>
              {kind === "deepl"
                ? "验证会消耗少量字符额度。"
                : "填写 DeepLX 服务的接口地址，例如 http://localhost:1188/translate"}
            </Text>
          }
        >
          {kind === "deepl" ? (
            <Picker
              title="账号类型"
              value={accountType}
              onChanged={(value: string) => {
                const next = value === "pro" ? "pro" : "free"
                setAccountType(next)
                setBaseUrl(DEEPL_ENDPOINTS[next])
                setTestStatus("")
              }}
            >
              <Text tag="free">Free</Text>
              <Text tag="pro">Pro</Text>
            </Picker>
          ) : null}
          <TextField
            title="接口地址"
            value={baseUrl}
            onChanged={setBaseUrl}
            prompt={kind === "deepl" ? "https://api-free.deepl.com/v2/translate" : "http://localhost:1188/translate"}
          />
          {kind === "deepl" ? (
            <TextField title="API Key" value={apiKey} onChanged={setApiKey} prompt="DeepL API Key" />
          ) : null}
          <Button title={isTesting ? "正在验证" : "验证请求"} disabled={isTesting} action={() => { void verify() }} />
          {isTesting ? <ProgressView /> : null}
          {testStatus ? <Text foregroundStyle="secondaryLabel">{testStatus}</Text> : null}
        </Section>
      </Form>
    </NavigationStack>
  )
}
