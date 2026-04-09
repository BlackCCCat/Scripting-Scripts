import { Navigation, Script, Intent } from "scripting"

import { RootTabView } from "./components/RootTabView"
import { INTENT_DATA_KEY, handleAnyData, safeRefreshWidget } from "./utils"

declare const Storage: {
  get(key: string): any
  remove(key: string): void
}

function collectIntentTexts(): string[] {
  const result: string[] = []

  try {
    if (Array.isArray(Intent.textsParameter)) {
      for (const text of Intent.textsParameter) {
        if (typeof text === "string" && text.trim()) result.push(text.trim())
      }
    }
  } catch {}

  try {
    const value = Intent.shortcutParameter?.value
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item || "").trim()
        if (text) result.push(text)
      }
    } else if (value != null) {
      const text = String(value).trim()
      if (text) result.push(text)
    }
  } catch {}

  try {
    const stored = Storage.get(INTENT_DATA_KEY)
    if (typeof stored === "string" && stored.trim()) {
      result.push(stored.trim())
      Storage.remove(INTENT_DATA_KEY)
    }
  } catch {}

  return result
}

async function run() {
  const incomingTexts = collectIntentTexts()

  if (incomingTexts.length > 0) {
    let total = 0
    for (const text of incomingTexts) {
      total += await handleAnyData(text)
    }
    safeRefreshWidget()
    Script.exit(total > 0 ? `成功导入 ${total} 条取件码` : "没有新的取件码")
    return
  }

  await Navigation.present({
    element: <RootTabView initialNotice={null} />,
  })

  Script.exit()
}

export async function main() {
  await run()
}

run()
