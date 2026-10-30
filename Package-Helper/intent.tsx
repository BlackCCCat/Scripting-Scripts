import { Script, Intent } from "scripting"
import { main } from "./index"

declare const Storage: {
  set(key: string, value: any): boolean
}

const INTENT_DATA_KEY = "smsPickup_intent_data_temp_v2"

async function runIntent() {
  try {
    let value = ""

    if (Intent.shortcutParameter?.value != null) {
      const v = Intent.shortcutParameter.value
      value = Array.isArray(v)
        ? v.map(item => String(item || "").trim()).filter(Boolean).join("\n\n---SMS-DIVIDER---\n\n")
        : String(v)
    } else if (Array.isArray(Intent.textsParameter)) {
      value = Intent.textsParameter.map(v => String(v || "").trim()).filter(Boolean).join("\n\n---SMS-DIVIDER---\n\n")
    }

    const trimmed = value.trim()
    if (trimmed) {
      Storage.set(INTENT_DATA_KEY, trimmed)
    }

    await main()
  } catch (e) {
    Script.exit("Intent Error: " + e)
  }
}

runIntent()
