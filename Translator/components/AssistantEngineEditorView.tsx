import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  useState,
  Image
} from "scripting"

import type { TranslationEngineConfig } from "../types"

const ASSISTANT_PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "grok", label: "Grok" },
  { id: "custom", label: "Custom" },
] as const

type AssistantProviderId = typeof ASSISTANT_PROVIDER_OPTIONS[number]["id"]

function normalizeAssistantProviderId(value: unknown): AssistantProviderId {
  const normalized = String(value ?? "").trim()
  if (ASSISTANT_PROVIDER_OPTIONS.some((item) => item.id === normalized)) {
    return normalized as AssistantProviderId
  }
  return "openai"
}

export function AssistantEngineEditorView(props: {
  title: string
  initial?: TranslationEngineConfig
}) {
  const dismiss = Navigation.useDismiss()
  const [providerId, setProviderId] = useState<AssistantProviderId>(
    normalizeAssistantProviderId(props.initial?.assistantProviderId)
  )
  const [customProvider, setCustomProvider] = useState(String(props.initial?.assistantCustomProvider ?? ""))
  const [modelId, setModelId] = useState(String(props.initial?.assistantModelId ?? ""))

  async function chooseProviderAndModel() {
    try {
      const selected = await Assistant.presentModelPicker({
        ...(providerId === "custom"
          ? (customProvider.trim() ? { provider: { custom: customProvider.trim() } } : {})
          : { provider: providerId }),
        ...(modelId.trim() ? { modelId: modelId.trim() } : {}),
      })
      if (!selected) return

      if (typeof selected.provider === "string") {
        setProviderId(selected.provider)
        setCustomProvider("")
      } else {
        setProviderId("custom")
        setCustomProvider(selected.provider.custom)
      }
      setModelId(selected.modelId)
    } catch (error) {
      void Dialog.alert({
        title: "无法选择服务商和模型",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function save() {
    if (providerId === "custom" && !customProvider.trim()) {
      void Dialog.alert({
        title: "无法保存",
        message: "请先通过服务商和模型选择器选择一个 Custom Provider。",
      })
      return
    }

    dismiss({
      assistantProviderId: providerId,
      assistantCustomProvider: providerId === "custom" ? customProvider.trim() : "",
      assistantModelId: modelId.trim(),
    } satisfies TranslationEngineConfig)
  }

  const providerLabel = providerId === "custom"
    ? customProvider.trim() || "Custom"
    : ASSISTANT_PROVIDER_OPTIONS.find((item) => item.id === providerId)?.label ?? providerId

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
        <Section header={<Text>Assistant 配置</Text>}>
          <HStack frame={{ maxWidth: "infinity" as any }}>
            <Text>服务商</Text>
            <Spacer />
            <Text>{providerLabel}</Text>
          </HStack>
          <HStack frame={{ maxWidth: "infinity" as any }}>
            <Text>模型 ID</Text>
            <Spacer />
            <Text>{modelId.trim() || "使用默认模型"}</Text>
          </HStack>
          <Button
            title="选择服务商和模型"
            action={() => { void chooseProviderAndModel() }}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
