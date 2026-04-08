import {
  Button,
  Form,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Spacer,
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
const SILICONFLOW_DEFAULT_BASE_URL = "https://api.siliconflow.cn"
const QWEN_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode"
const CUSTOM_MODE_DESCRIPTION = [
  "自定义接口需要填写基础地址，填到站点根地址、/v1 或完整接口路径都可以。",
  "填写链接和 API Key 后会自动获取模型列表。",
].join("\n")

function normalizeBaseUrl(input: string) {
  return String(input ?? "").trim().replace(/\/+$/, "")
}

function defaultBaseUrlForMode(mode: AiApiCompatibilityMode) {
  if (mode === "openai") return OPENAI_DEFAULT_BASE_URL
  if (mode === "gemini") return GEMINI_DEFAULT_BASE_URL
  if (mode === "siliconflow") return SILICONFLOW_DEFAULT_BASE_URL
  if (mode === "qwen") return QWEN_DEFAULT_BASE_URL
  return ""
}

function modeLabel(mode: AiApiCompatibilityMode) {
  if (mode === "openai") return "OpenAI"
  if (mode === "gemini") return "Google Gemini"
  if (mode === "siliconflow") return "硅基流动"
  if (mode === "qwen") return "通义千问"
  return "自定义"
}

function shouldSyncLabelWithMode(currentLabel: string, currentMode: AiApiCompatibilityMode) {
  const normalized = String(currentLabel ?? "").trim()
  if (!normalized) return true
  return normalized === "AI 接口" || normalized === modeLabel(currentMode)
}

function ModelMenu(props: {
  value: string
  selectedIndex: number
  options: string[]
  onChanged: (index: number) => void
}) {
  return (
    <Menu
      label={
        <HStack spacing={4}>
          <Text
            font="subheadline"
            foregroundStyle="accentColor"
            lineLimit={1}
            truncationMode="tail"
            allowsTightening
            frame={{ maxWidth: 220, alignment: "trailing" as any }}
            multilineTextAlignment="trailing"
          >
            {props.value}
          </Text>
          <Image
            systemName="chevron.down"
            font="caption2"
            foregroundStyle="accentColor"
          />
        </HStack>
      }
    >
      <Picker
        title="模型"
        value={props.selectedIndex}
        onChanged={props.onChanged}
      >
        {props.options.map((item, index) => (
          <Text key={item} tag={index}>
            {item}
          </Text>
        ))}
      </Picker>
    </Menu>
  )
}

export function EngineEditorView(props: {
  title: string
  initial?: Partial<EngineEditorValue>
}) {
  const dismiss = Navigation.useDismiss()
  const [label, setLabel] = useState(String(props.initial?.label ?? "AI 接口"))
  const [systemImage, setSystemImage] = useState(String(props.initial?.systemImage ?? "sparkles"))
  const [compatibilityMode, setCompatibilityMode] = useState<AiApiCompatibilityMode>(
    props.initial?.config?.compatibilityMode === "openai"
    || props.initial?.config?.compatibilityMode === "gemini"
    || props.initial?.config?.compatibilityMode === "siliconflow"
    || props.initial?.config?.compatibilityMode === "qwen"
      ? props.initial.config.compatibilityMode
      : "custom"
  )
  const [baseUrl, setBaseUrl] = useState(String(props.initial?.config?.baseUrl ?? ""))
  const [apiKey, setApiKey] = useState(String(props.initial?.config?.apiKey ?? ""))
  const [model, setModel] = useState(String(props.initial?.config?.model ?? ""))
  const [modelIds, setModelIds] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState("填写 API Key 后会自动获取模型列表。")
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const reloadModels = useEffectEvent(async () => {
    const currentApiKey = apiKey.trim()
    const currentBaseUrl = compatibilityMode === "custom"
      ? normalizeBaseUrl(baseUrl)
      : defaultBaseUrlForMode(compatibilityMode)
    if (!currentApiKey || !currentBaseUrl) {
      setModelIds([])
      setIsLoadingModels(false)
      setModelStatus(compatibilityMode === "custom"
        ? "填写链接和 API Key 后会自动获取模型列表。"
        : "填写 API Key 后会自动获取模型列表。")
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
    const normalizedBaseUrl = compatibilityMode === "custom"
      ? normalizeBaseUrl(baseUrl)
      : defaultBaseUrlForMode(compatibilityMode)

    if (compatibilityMode === "custom" && !normalizedBaseUrl) {
      void Dialog.alert({
        title: "无法保存",
        message: "请先填写链接。",
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

  const modeOptions: AiApiCompatibilityMode[] = ["custom", "openai", "gemini", "siliconflow", "qwen"]
  const modeIndex = Math.max(0, modeOptions.indexOf(compatibilityMode === "newapi" ? "custom" : compatibilityMode))
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
          footer={compatibilityMode === "custom" ? <Text>{CUSTOM_MODE_DESCRIPTION}</Text> : undefined}
        >
          <Picker
            title="服务类型"
            pickerStyle="menu"
            value={modeIndex}
            onChanged={(index: number) => {
              const nextMode = modeOptions[index] ?? "custom"
              if (shouldSyncLabelWithMode(label, compatibilityMode)) {
                setLabel(modeLabel(nextMode))
              }
              setCompatibilityMode(nextMode)
              setModelIds([])
              setModel("")
              if (nextMode !== "custom") {
                setBaseUrl(defaultBaseUrlForMode(nextMode))
              } else if (!normalizeBaseUrl(baseUrl)) {
                setBaseUrl("")
              }
            }}
          >
            {modeOptions.map((item, index) => (
              <Text key={item} tag={index}>{modeLabel(item)}</Text>
            ))}
          </Picker>
          {compatibilityMode === "custom" ? (
            <TextField
              title="链接"
              value={baseUrl}
              onChanged={(value) => {
                setBaseUrl(value)
                setModelIds([])
                setModel("")
              }}
              prompt="https://example.com"
            />
          ) : null}
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
            <HStack spacing={12}>
              <Text>模型</Text>
              <Spacer />
              {/* 这里保持原地刷新模型，避免保存前还要再做一遍可用性检查。 */}
              <ProgressView />
            </HStack>
          ) : modelIds.length > 0 ? (
            <HStack spacing={12}>
              <Text>模型</Text>
              <Spacer />
              <ModelMenu
                value={model || modelIds[0] || ""}
                selectedIndex={selectedModelIndex}
                options={modelIds}
                onChanged={(index: number) => {
                  setModel(modelIds[index] ?? "")
                }}
              />
            </HStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">{modelStatus}</Text>
          )}
        </Section>
      </Form>
    </NavigationStack>
  )
}
