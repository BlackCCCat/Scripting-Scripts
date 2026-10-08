import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { AI_PROVIDERS, aiProvider } from "../utils/ai_providers.ts"

const modes = AI_PROVIDERS.map((provider) => provider.mode)
assert.equal(new Set(modes).size, modes.length)
assert.deepEqual(modes, [
  "anthropic", "deepseek", "gemini", "minimax", "openai",
  "openrouter", "siliconflow", "qwen", "custom",
])
assert.equal(aiProvider("newapi").mode, "custom")
assert.ok(AI_PROVIDERS.filter((provider) => provider.mode !== "custom")
  .every((provider) => provider.baseUrl.startsWith("https://")))
for (const icon of [
  "anthropic.svg", "apple-intelligence.png", "apple-intelligence-color.png", "apple.svg", "deepl-color.svg",
  "deepseek-color.svg", "gemini-color.svg", "google-translate.png",
  "minimax-color.svg", "openai.svg", "openrouter-color.svg", "qwen-color.svg",
  "scripting-assistant.png", "scripting-assistant-mark.png", "siliconflow.png", "custom.svg",
]) {
  assert.ok(existsSync(new URL(`../assets/icons/${icon}`, import.meta.url)), icon)
}
