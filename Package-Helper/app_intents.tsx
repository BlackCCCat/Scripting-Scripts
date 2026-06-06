import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

import {
  appendWidgetAction,
  applyWidgetToggleToCache,
  clearWidgetCacheItems,
} from "./widgetData"

function reloadWidgets() {
  try {
    if ((Widget as any)?.reloadAll) {
      ;(Widget as any).reloadAll()
    }
  } catch {}
}

export const TogglePickedIntent = AppIntentManager.register({
  name: "TogglePickedIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (code: string) => {
    appendWidgetAction({ type: "toggle", code, createdAt: Date.now() })
    applyWidgetToggleToCache(code)
    reloadWidgets()
  },
})

export const MarkAllPickedIntent = AppIntentManager.register({
  name: "MarkAllPickedIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_: void) => {
    appendWidgetAction({ type: "markAll", createdAt: Date.now() })
    clearWidgetCacheItems()
    reloadWidgets()
  },
})
