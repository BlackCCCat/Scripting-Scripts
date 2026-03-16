import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

import type { ApiEntry } from "./types"
import { runChecksConcurrently } from "./utils/checker"
import { loadManagerState, saveManagerState } from "./utils/storage"

const RELOAD_THROTTLE_MS = 600

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

    let currentEntries: ApiEntry[] = [...state.entries]
    let lastReloadAt = 0

    const saveEntries = () => {
      saveManagerState({
        ...state,
        entries: currentEntries,
      })
    }

    const maybeReloadWidgets = (force = false) => {
      const now = Date.now()
      if (!force && now - lastReloadAt < RELOAD_THROTTLE_MS) return
      lastReloadAt = now
      reloadWidgets()
    }

    await runChecksConcurrently(state.entries, async (entry, result) => {
        currentEntries = currentEntries.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                check: result,
                updatedAt: Date.now(),
              }
            : item
        )
        saveEntries()
        maybeReloadWidgets()
      }
    )

    maybeReloadWidgets(true)
    await sleep(500)
    reloadWidgets()
  },
})
