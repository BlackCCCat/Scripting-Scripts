import { Image, SVG } from "scripting"
import type { AiApiCompatibilityMode, TranslationEngineKind } from "../types"
import { rasterIcons, vectorIcons } from "./embedded_engine_icons"
import { rasterizedIcons } from "./embedded_rasterized_icons"

const decodedImages = new Map<string, UIImage | null>()

const providerIcons: Partial<Record<AiApiCompatibilityMode, string>> = {
  anthropic: "anthropic.svg",
  deepseek: "deepseek-color.png",
  gemini: "gemini-color.png",
  minimax: "minimax-color.png",
  openai: "openai.png",
  openrouter: "openrouter-color.png",
  siliconflow: "siliconflow-small.png",
  qwen: "qwen-color.png",
  custom: "custom.png",
}

export function EngineIcon(props: {
  kind: TranslationEngineKind
  mode?: AiApiCompatibilityMode
  size?: number
}) {
  const size = props.size ?? 20
  const providerIcon = props.kind === "ai_api"
    ? providerIcons[props.mode ?? "custom"] ?? providerIcons.custom
    : undefined
  const raster = props.kind === "apple_intelligence"
    ? "apple-intelligence-color.png"
    : props.kind === "assistant"
      ? "scripting-assistant-mark.png"
      : props.kind === "google_translate"
        ? "google-translate.png"
        : props.kind === "deepl" || props.kind === "deeplx"
          ? "deepl-color.png"
          : providerIcon?.endsWith(".png") ? providerIcon : undefined

  if (raster) {
    if (!decodedImages.has(raster)) {
      decodedImages.set(raster, UIImage.fromBase64String(rasterizedIcons[raster] ?? rasterIcons[raster]))
    }
    const image = decodedImages.get(raster)
    if (image) {
      const monochrome = raster === "scripting-assistant-mark.png" || raster === "deepl-color.png"
        || raster === "openai.png" || raster === "custom.png"
      return <Image image={image} resizable renderingMode={monochrome ? "template" : "original"} foregroundStyle={monochrome ? "label" : undefined} frame={{ width: size, height: size }} />
    }
  }

  const vector = props.kind === "system_translation"
    ? "apple.svg"
    : providerIcon?.endsWith(".svg") ? providerIcon : undefined

  if (vector) {
    const monochrome = vector === "apple.svg" || vector === "anthropic.svg"
    return <SVG code={vectorIcons[vector]} resizable renderingMode={monochrome ? "template" : "original"} foregroundStyle={monochrome ? "label" : undefined} frame={{ width: size, height: size }} />
  }

  return <Image systemName="questionmark.circle" frame={{ width: size, height: size }} />
}
