import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

import { getPendingHomeCodes, markPicked, unmarkPicked } from "./utils"

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
    const pendingCodes = await getPendingHomeCodes()
    if (pendingCodes.includes(code)) {
      await markPicked(code)
    } else {
      await unmarkPicked(code)
    }
    reloadWidgets()
  },
})

export const MarkAllPickedIntent = AppIntentManager.register({
  name: "MarkAllPickedIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_: void) => {
    const pendingCodes = await getPendingHomeCodes()
    for (const code of pendingCodes) {
      await markPicked(code)
    }
    reloadWidgets()
  },
})
