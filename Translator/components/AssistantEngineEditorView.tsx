import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  useState,
} from "scripting"

import type { TranslationEngineConfig } from "../types"

const ASSISTANT_PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "openrouter", label: "OpenRouter" },
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

  function save() {
    if (providerId === "custom" && !customProvider.trim()) {
      void Dialog.alert({
        title: "无法保存",
        message: "使用 Custom Provider 时，请先填写 Provider。",
      })
      return
    }

    dismiss({
      assistantProviderId: providerId,
      assistantCustomProvider: providerId === "custom" ? customProvider.trim() : "",
      assistantModelId: modelId.trim(),
    } satisfies TranslationEngineConfig)
  }

  const providerIndex = Math.max(0, ASSISTANT_PROVIDER_OPTIONS.findIndex((item) => item.id === providerId))

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={save}
            />
          ),
        }}
      >
        <Section header={<Text>Assistant 配置</Text>}>
          <Picker
            title="Provider"
            pickerStyle="menu"
            value={providerIndex}
            onChanged={(index: number) => {
              setProviderId(ASSISTANT_PROVIDER_OPTIONS[index]?.id ?? "openai")
            }}
          >
            {ASSISTANT_PROVIDER_OPTIONS.map((option, index) => (
              <Text key={option.id} tag={index}>
                {option.label}
              </Text>
            ))}
          </Picker>
          {providerId === "custom" ? (
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text frame={{ width: 110, alignment: "leading" as any }}>
                Provider 名称
              </Text>
              <TextField
                title=""
                value={customProvider}
                onChanged={setCustomProvider}
                prompt="只填写 custom 后面的字符串"
                multilineTextAlignment="trailing"
                frame={{ maxWidth: "infinity" as any, alignment: "trailing" as any }}
              />
            </HStack>
          ) : null}
          <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
            <Text frame={{ width: 110, alignment: "leading" as any }}>
              模型 ID
            </Text>
            <TextField
              title=""
              value={modelId}
              onChanged={setModelId}
              prompt="留空则使用 Provider 默认模型"
              multilineTextAlignment="trailing"
              frame={{ maxWidth: "infinity" as any, alignment: "trailing" as any }}
            />
          </HStack>
        </Section>
      </Form>
    </NavigationStack>
  )
}
