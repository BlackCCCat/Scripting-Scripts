import {
  Intent,
  Navigation,
  Script,
  fetch,
} from "scripting"

import { TranslationPanel } from "./components/TranslationPanel"
import {
  appStoreTranslationText,
  resolveIntentInput,
  type AppStoreReference,
} from "./utils/intent_input"

function shortcutText() {
  const parameter = Intent.shortcutParameter
  return parameter?.type === "text" ? parameter.value : ""
}

async function loadAppStoreText(reference: AppStoreReference) {
  const response = await fetch(
    `https://itunes.apple.com/${reference.region}/lookup?id=${reference.appId}`,
    {
      timeout: 20,
      debugLabel: "Translator App Store Lookup",
    }
  )

  if (!response.ok) {
    throw new Error(`无法读取 App Store 信息（HTTP ${response.status}）。`)
  }

  const payload = await response.json()
  const app = Array.isArray(payload?.results) ? payload.results[0] : null
  if (!app) throw new Error("未找到该 App Store 应用。")

  const text = appStoreTranslationText(app)
  if (!text) throw new Error("该应用没有可翻译的发布说明或应用说明。")

  console.log("[Translator] 已读取 App Store 分享内容", {
    appId: reference.appId,
    region: reference.region,
    appName: String(app.trackName ?? ""),
    sourceLength: text.length,
  })
  return text
}

async function run() {
  try {
    const input = resolveIntentInput({
      texts: Intent.textsParameter,
      urls: Intent.urlsParameter,
      shortcutText: shortcutText(),
    })
    const sourceText = input.appStoreReference
      ? await loadAppStoreText(input.appStoreReference)
      : input.sourceText

    if (!sourceText.trim()) {
      throw new Error("请通过分享表或快捷指令传入文本。")
    }

    console.log("[Translator] Intent 开始翻译", {
      source: input.appStoreReference ? "app-store" : "text",
      sourceLength: sourceText.length,
    })

    await Navigation.present({
      element: (
        <TranslationPanel
          inputText={sourceText}
          allowsReplacement={false}
          showsScrollContentBackground
        />
      ),
    })
    Script.exit()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[Translator] Intent 执行失败", message)
    Script.exit(Intent.text(`翻译失败：${message}`))
  }
}

void run()
