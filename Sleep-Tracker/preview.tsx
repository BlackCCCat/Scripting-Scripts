import { DailyTab } from "./tabs/DailyTab"
import { loadSleepTrackerSettings } from "./data/settings"
import { loadMockSleepTrackerSnapshot } from "./data/mock"

export default function Preview() {
  const snapshot = loadMockSleepTrackerSnapshot()
  const settings = loadSleepTrackerSettings()
  return (
    <DailyTab
      isActive={true}
      snapshot={snapshot}
      settings={settings}
      loading={false}
      error={null}
      onRefresh={() => {}}
    />
  )
}