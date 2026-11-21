import type { ServiceKeepAliveMode } from "./store"

let requestedMode: ServiceKeepAliveMode | null = null
let locationSubscribed = false
const onLocation = () => {}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function stopLocation() {
  if (!locationSubscribed) return
  try {
    Location.stopUpdatingLocation()
  } finally {
    Location.removeLocationListener(onLocation)
  }
  locationSubscribed = false
}

export async function startServiceKeepAlive(mode: ServiceKeepAliveMode): Promise<void> {
  if (requestedMode && requestedMode !== mode) await stopServiceKeepAlive()
  requestedMode = mode
  try {
    if (mode === "location" && !locationSubscribed) {
      Location.setAllowsBackgroundLocationUpdates(true)
      Location.setPausesLocationUpdatesAutomatically(false)
      Location.setShowsBackgroundLocationIndicator(true)
      Location.setDistanceFilter(-1)
      await Location.setAccuracy("threeKilometers")
      locationSubscribed = true
      // The listener holds the subscription. WorkBuddy2API does not use the coordinates.
      Location.addLocationListener(onLocation)
      await Location.startUpdatingLocation({ requestAlwaysAuthorization: true })
    }
    const requested = await BackgroundKeeper.keepAlive(mode)
    const state = await BackgroundKeeper.getState()
    const active = mode === "audio" ? state.requested && state.isActive : state.activeModes?.includes("location")
    if (!requested || !active) {
      const failure = state.modeStates?.[mode]?.lastFailure ?? (mode === "audio" ? state.lastFailure : null)
      throw new Error(failure ?? "系统未启用所选保活方式")
    }
  } catch (error) {
    try { await stopServiceKeepAlive() }
    catch (cleanupError) { throw new Error(`${message(error)}。释放保活资源失败：${message(cleanupError)}`) }
    throw error
  }
}

export async function stopServiceKeepAlive(): Promise<void> {
  try { await BackgroundKeeper.stopKeepAlive() }
  finally { stopLocation() }
  requestedMode = null
}
