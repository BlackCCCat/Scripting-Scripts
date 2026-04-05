import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Text,
  TextField,
  useEffect,
  useEffectEvent,
  useState,
} from "scripting"

import type {
  AiApiCompatibilityMode,
  TranslationEngineConfig,
} from "../types"
import { fetchAiApiModels } from "../utils/ai_api_models"

type EngineEditorValue = {
  config?: TranslationEngineConfig
  label?: string
  systemImage?: string
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com"
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

function normalizeBaseUrl(input: string) {
  return String(input ?? "").trim().replace(/\/+$/, "")
}

function defaultBaseUrlForMode(mode: AiApiCompatibilityMode) {
  if (mode === "openai") return OPENAI_DEFAULT_BASE_URL
  if (mode === "gemini") return GEMINI_DEFAULT_BASE_URL
  return ""
}

function descriptionLines(mode: AiApiCompatibilityMode) {
  if (mode === "newapi") {
    return [
      "New API 平台请填写基础地址，不要填写完整的 chat/completions 路径。",
      "填写 Base URL 和 API Key 后会自动获取模型列表。",
    ]
  }

  if (mode === "openai") {
    return [
      "OpenAI 兼容接口可留空链接，留空时默认使用 OpenAI 官方地址。",
      "填写 Base URL 和 API Key 后会自动获取模型列表。",
    ]
  }

  return [
    "Gemini 接口可留空链接，留空时默认使用 Gemini 官方地址。",
    "填写 Base URL 和 API Key 后会自动获取模型列表。",
  ]
}

export function EngineEditorView(props: {
  title: string
  initial?: Partial<EngineEditorValue>
}) {
  const dismiss = Navigation.useDismiss()
  const [label, setLabel] = useState(String(props.initial?.label ?? "AI 接口"))
  const [systemImage, setSystemImage] = useState(String(props.initial?.systemImage ?? "sparkles"))
  const [compatibilityMode, setCompatibilityMode] = useState<AiApiCompatibilityMode>(
    props.initial?.config?.compatibilityMode === "openai" || props.initial?.config?.compatibilityMode === "gemini"
      ? props.initial.config.compatibilityMode
      : "newapi"
  )
  const [baseUrl, setBaseUrl] = useState(String(props.initial?.config?.baseUrl ?? ""))
  const [apiKey, setApiKey] = useState(String(props.initial?.config?.apiKey ?? ""))
  const [model, setModel] = useState(String(props.initial?.config?.model ?? ""))
  const [modelIds, setModelIds] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState("填写 Base URL 和 API Key 后会自动获取模型列表。")
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const reloadModels = useEffectEvent(async () => {
    const currentApiKey = apiKey.trim()
    const currentBaseUrl = normalizeBaseUrl(baseUrl) || defaultBaseUrlForMode(compatibilityMode)
    if (!currentApiKey || !currentBaseUrl) {
      setModelIds([])
      setIsLoadingModels(false)
      setModelStatus("填写 Base URL 和 API Key 后会自动获取模型列表。")
      return
    }

    setIsLoadingModels(true)
    try {
      const result = await fetchAiApiModels({
        compatibilityMode,
        baseUrl: currentBaseUrl,
        apiKey: currentApiKey,
      })
      setModelIds(result.modelIds)
      setModelStatus(result.message)

      if (result.modelIds.length > 0) {
        if (!result.modelIds.includes(model)) {
          setModel(result.modelIds[0])
        }
      }
    } catch (error) {
      setModelIds([])
      setModelStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoadingModels(false)
    }
  })

  useEffect(() => {
    void reloadModels()
  }, [apiKey, baseUrl, compatibilityMode, reloadModels])

  function save() {
    const normalizedLabel = label.trim() || "AI 接口"
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || defaultBaseUrlForMode(compatibilityMode)

    if (!normalizedBaseUrl) {
      void Dialog.alert({
        title: "无法保存",
        message: "请先填写基础地址。",
      })
      return
    }

    if (!apiKey.trim()) {
      void Dialog.alert({
        title: "无法保存",
        message: "请先填写 API Key。",
      })
      return
    }

    if (isLoadingModels) {
      void Dialog.alert({
        title: "请稍候",
        message: "正在获取模型列表，请稍后再保存。",
      })
      return
    }

    if (!modelIds.length) {
      void Dialog.alert({
        title: "无法保存",
        message: "当前接口还没有获取到可用模型，请先检查地址或 API Key。",
      })
      return
    }

    if (!model.trim()) {
      void Dialog.alert({
        title: "无法保存",
        message: "请先选择模型。",
      })
      return
    }

    dismiss({
      label: normalizedLabel,
      systemImage: systemImage.trim() || "sparkles",
      config: {
        compatibilityMode,
        baseUrl: normalizedBaseUrl,
        apiKey: apiKey.trim(),
        model: model.trim(),
      },
    } satisfies EngineEditorValue)
  }

  const modeOptions: AiApiCompatibilityMode[] = ["newapi", "openai", "gemini"]
  const modeIndex = compatibilityMode === "openai" ? 1 : compatibilityMode === "gemini" ? 2 : 0
  const selectedModelIndex = Math.max(0, modelIds.indexOf(model))

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
        <Section header={<Text>基础信息</Text>}>
          <TextField
            title="名称"
            value={label}
            onChanged={setLabel}
            prompt="例如 OpenAI 翻译"
          />
          <TextField
            title="SF Symbol"
            value={systemImage}
            onChanged={setSystemImage}
            prompt="默认 sparkles"
          />
        </Section>

        <Section
          header={<Text>接口配置</Text>}
          footer={<Text>{descriptionLines(compatibilityMode).join("\n")}</Text>}
        >
          <Picker
            title="服务类型"
            pickerStyle="menu"
            value={modeIndex}
            onChanged={(index: number) => {
              const nextMode = modeOptions[index] ?? "newapi"
              setCompatibilityMode(nextMode)
              setModelIds([])
              setModel("")
              if (!normalizeBaseUrl(baseUrl)) {
                setBaseUrl(defaultBaseUrlForMode(nextMode))
              }
            }}
          >
            <Text tag={0}>New API 平台</Text>
            <Text tag={1}>OpenAI 兼容接口</Text>
            <Text tag={2}>Gemini 接口</Text>
          </Picker>
          <TextField
            title="Base URL"
            value={baseUrl}
            onChanged={(value) => {
              setBaseUrl(value)
              setModelIds([])
              setModel("")
            }}
            prompt={compatibilityMode === "gemini"
              ? GEMINI_DEFAULT_BASE_URL
              : compatibilityMode === "openai"
                ? OPENAI_DEFAULT_BASE_URL
                : "https://example.com"}
          />
          <TextField
            title="API Key"
            value={apiKey}
            onChanged={(value) => {
              setApiKey(value)
              setModelIds([])
              setModel("")
            }}
            prompt="API Key"
          />
          {isLoadingModels ? (
            <>
              {/* 这里保持原地刷新模型，避免保存前还要再做一遍可用性检查。 */}
              <ProgressView />
              <Text foregroundStyle="secondaryLabel">{modelStatus}</Text>
            </>
          ) : modelIds.length > 0 ? (
            <Picker
              title="模型"
              pickerStyle="menu"
              value={selectedModelIndex}
              onChanged={(index: number) => {
                setModel(modelIds[index] ?? "")
              }}
            >
              {modelIds.map((item, index) => (
                <Text key={item} tag={index}>{item}</Text>
              ))}
            </Picker>
          ) : (
            <Text foregroundStyle="secondaryLabel">{modelStatus}</Text>
          )}
        </Section>
      </Form>
    </NavigationStack>
  )
}
