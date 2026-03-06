import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

import { checkEntries } from "./utils/checker"
import { loadManagerState, saveManagerState } from "./utils/storage"

function reloadWidgets() {
  try {
    Widget.reloadAll()
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const RefreshApiAvailabilityIntent = AppIntentManager.register({
  name: "RefreshApiAvailabilityIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    const state = loadManagerState()
    if (!state.entries.length) return

    const resultMap = await checkEntries(state.entries)
    const finishedAt = Date.now()

    saveManagerState({
      ...state,
      entries: state.entries.map((entry) => {
        const result = resultMap.get(entry.id)
        if (!result) return entry
        return {
          ...entry,
          check: result,
          updatedAt: finishedAt,
        }
      }),
    })
    reloadWidgets()
    await sleep(500)
    reloadWidgets()
  },
})
