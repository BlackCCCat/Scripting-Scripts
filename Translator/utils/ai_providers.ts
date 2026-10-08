import type { AiApiCompatibilityMode } from "../types"

export const AI_PROVIDERS: Array<{ mode: AiApiCompatibilityMode; label: string; baseUrl: string }> = [
  { mode: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com" },
  { mode: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { mode: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com" },
  { mode: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io" },
  { mode: "openai", label: "OpenAI", baseUrl: "https://api.openai.com" },
  { mode: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api" },
  { mode: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn" },
  { mode: "qwen", label: "Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode" },
  { mode: "custom", label: "Custom", baseUrl: "" },
]

export const PREVIOUS_AI_PROVIDER_LABELS: Record<string, string> = {
  "SiliconFlow（硅基流动）": "SiliconFlow",
  "Qwen（通义千问）": "Qwen",
  "自定义 AI 供应商": "Custom",
  "硅基流动": "SiliconFlow",
  "通义千问": "Qwen",
  "自定义": "Custom",
}

export function aiProvider(mode: AiApiCompatibilityMode | undefined) {
  return AI_PROVIDERS.find((item) => item.mode === mode) ?? AI_PROVIDERS[AI_PROVIDERS.length - 1]
}
