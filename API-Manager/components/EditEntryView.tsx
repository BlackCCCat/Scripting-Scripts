import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"

import type { CompatibilityMode } from "../types"
import {
  defaultBaseUrlForMode,
  GEMINI_DEFAULT_BASE_URL,
  isLikelyHttpUrl,
  normalizeBaseUrl,
  OPENAI_DEFAULT_BASE_URL,
} from "../utils/common"

export type EditEntryResult = {
  name: string
  compatibilityMode?: CompatibilityMode
  baseUrl: string
  apiKey: string
}

function LabeledInputRow(props: {
  value: string
  prompt: string
  onChanged: (value: string) => void
}) {
  return (
    <TextField
      title=""
      value={props.value}
      prompt={props.prompt}
      onChanged={props.onChanged}
    />
  )
}

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      role={props.role}
      frame={{ maxWidth: "infinity" }}
      action={() => {
        try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
        void props.onPress()
      }}
    >
      <HStack
        frame={{ width: "100%" as any }}
        padding={{ top: 14, bottom: 14 }}
        background={"rgba(0,0,0,0.001)"}
      >
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function EditEntryView(props: {
  title: string
  initial?: Partial<EditEntryResult>
}) {
  const dismiss = Navigation.useDismiss()
  const [compatibilityMode, setCompatibilityMode] = useState<CompatibilityMode>(
    props.initial?.compatibilityMode === "openai" || props.initial?.compatibilityMode === "gemini"
      ? props.initial.compatibilityMode
      : "newapi"
  )
  const [name, setName] = useState(String(props.initial?.name ?? ""))
  const [baseUrl, setBaseUrl] = useState(String(props.initial?.baseUrl ?? ""))
  const [apiKey, setApiKey] = useState(String(props.initial?.apiKey ?? ""))

  const modeOptions: CompatibilityMode[] = ["newapi", "openai", "gemini"]
  const modeIndex = compatibilityMode === "openai" ? 1 : compatibilityMode === "gemini" ? 2 : 0
  const basePrompt = compatibilityMode === "gemini"
      ? `base url，如 ${GEMINI_DEFAULT_BASE_URL}`
      : compatibilityMode === "openai"
        ? `base url，如 ${OPENAI_DEFAULT_BASE_URL}`
        : "base url，如 https://example.com"
  const descriptionLines = compatibilityMode === "newapi"
    ? [
        "链接请填写 API 的基础地址，不要填写 /api/status 或 /v1/models。",
        "可填写示例：https://example.com",
        "也可以填写带前缀路径的地址：https://example.com/proxy",
      ]
    : compatibilityMode === "gemini"
      ? [
          "Gemini 模式可留空链接，留空时默认使用 Gemini 官方地址。",
          `默认地址：${GEMINI_DEFAULT_BASE_URL}`,
          "检测时会请求 /v1beta/models?key=你的 API Key。",
        ]
      : [
          "OpenAI 模式可留空链接，留空时默认使用 OpenAI 官方地址。",
          `默认地址：${OPENAI_DEFAULT_BASE_URL}`,
          "检测时会请求 /v1/models，并使用 Authorization: Bearer API Key。",
        ]

  async function onSave() {
    const fixedName = String(name ?? "").trim()
    const rawBaseUrl = normalizeBaseUrl(baseUrl)
    const fixedBaseUrl = compatibilityMode !== "newapi" && !rawBaseUrl
      ? defaultBaseUrlForMode(compatibilityMode)
      : rawBaseUrl
    const fixedApiKey = String(apiKey ?? "").trim()

    if (!fixedName) {
      await Dialog.alert({ message: "请输入名称" })
      return
    }
    if (!fixedBaseUrl) {
      await Dialog.alert({ message: "请输入链接" })
      return
    }
    if (!fixedApiKey) {
      await Dialog.alert({ message: "请输入 API Key" })
      return
    }

    if (!isLikelyHttpUrl(fixedBaseUrl)) {
      await Dialog.alert({
        message: "链接请填写基础地址，例如 https://example.com 或 https://example.com/proxy",
      })
      return
    }

    dismiss({
      name: fixedName,
      compatibilityMode,
      baseUrl: fixedBaseUrl,
      apiKey: fixedApiKey,
    } satisfies EditEntryResult)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section
          header={<Text>基础信息</Text>}
          footer={
            <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={4}>
              {descriptionLines.map((line) => (
                <Text
                  key={line}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  multilineTextAlignment="leading"
                >
                  {line}
                </Text>
              ))}
            </VStack>
          }
        >
          <Picker
            title="兼容模式"
            pickerStyle="menu"
            value={modeIndex}
            onChanged={(index: number) => setCompatibilityMode(modeOptions[index] ?? "newapi")}
          >
            <Text tag={0}>New API</Text>
            <Text tag={1}>OpenAI</Text>
            <Text tag={2}>Gemini</Text>
          </Picker>
          <LabeledInputRow
            value={name}
            prompt="名称，如OpenAI中转"
            onChanged={setName}
          />
          <LabeledInputRow
            value={baseUrl}
            prompt={basePrompt}
            onChanged={setBaseUrl}
          />
          <LabeledInputRow
            value={apiKey}
            prompt="API Key，如sk-******"
            onChanged={setApiKey}
          />
        </Section>

        <Section>
          <CenterRowButton title="保存" onPress={onSave} />
          <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
        </Section>
      </Form>
    </NavigationStack>
  )
}
