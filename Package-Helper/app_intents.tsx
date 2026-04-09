declare const Storage: {
  get<T>(key: string): T | undefined
  set(key: string, value: any): void
}

import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

interface PickedItem {
  code: string
  timestamp: number
}

interface PickupConfig {
  pickedItems: PickedItem[]
  importedMessages: string[]
}

const PICKUP_CONFIG_KEY = "smsPickup_widget_config_v2"
const CODE_RE = /(?:取件码|取货码|验证码|提货码|取件|取货|凭)[^\d]{0,8}((\s*(?:\d+-){0,2}\d{3,8}[\s,，\.]*)+)/gi

function reloadWidgets() {
  try {
    if ((Widget as any)?.reloadAll) {
      ;(Widget as any).reloadAll()
      return
    }
  } catch {}
  try {
    Widget.refresh()
  } catch {}
}

export const TogglePickedIntent = AppIntentManager.register({
  name: "TogglePickedIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (code: string) => {
    const cfg = Storage.get<PickupConfig>(PICKUP_CONFIG_KEY) || { pickedItems: [], importedMessages: [] }
    const pickedItems = Array.isArray(cfg.pickedItems) ? cfg.pickedItems : []
    const index = pickedItems.findIndex(item => item.code === code)

    if (index >= 0) {
      pickedItems[index].timestamp = 1
    } else {
      pickedItems.push({ code, timestamp: Date.now() })
    }

    cfg.pickedItems = pickedItems
    Storage.set(PICKUP_CONFIG_KEY, cfg)
    reloadWidgets()
  }
})

export const MarkAllPickedIntent = AppIntentManager.register({
  name: "MarkAllPickedIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_: void) => {
    const cfg = Storage.get<PickupConfig>(PICKUP_CONFIG_KEY) || { pickedItems: [], importedMessages: [] }
    const importedMessages = Array.isArray(cfg.importedMessages) ? cfg.importedMessages : []
    const pickedItems = Array.isArray(cfg.pickedItems) ? cfg.pickedItems : []
    const existing = new Set(pickedItems.map(item => item.code))

    for (const msg of importedMessages) {
      const matcher = new RegExp(CODE_RE, "gi")
      let match: RegExpExecArray | null
      while ((match = matcher.exec(msg)) !== null) {
        const codeListString = match[1]
        if (!codeListString) continue
        const singleCodeRegex = /(\d+-){0,2}\d{3,8}/g
        let singleCodeMatch: RegExpExecArray | null
        while ((singleCodeMatch = singleCodeRegex.exec(codeListString)) !== null) {
          const code = singleCodeMatch[0]
          if (code && !existing.has(code)) {
            existing.add(code)
            pickedItems.push({ code, timestamp: 1 })
          }
        }
      }
    }

    cfg.pickedItems = pickedItems
    Storage.set(PICKUP_CONFIG_KEY, cfg)
    reloadWidgets()
  }
})
