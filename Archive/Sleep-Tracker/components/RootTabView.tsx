import { Tab, TabView, useEffect, useState } from "scripting"

import { DailyTab } from "../tabs/DailyTab"
import { TrendsTab } from "../tabs/TrendsTab"
import { SettingsTab } from "../tabs/SettingsTab"
import { loadSleepTrackerSettings } from "../data/settings"
import { loadMockSleepTrackerSnapshot, MOCK_HISTORY_DAYS, refreshMockSleepTrackerSnapshot } from "../data/mock"
import { loadCachedSleepTrackerSnapshot, refreshSleepTrackerSnapshot, DEFAULT_QUERY_DAYS } from "../data/health"
import type { SleepTrackerSettings, SleepTrackerSnapshot } from "../types"

const DAILY_TAB = 0
const TRENDS_TAB = 1
const SETTINGS_TAB = 2

export function RootTabView() {
  const [settings, setSettings] = useState<SleepTrackerSettings>(() => loadSleepTrackerSettings())
  const [tabIndex, setTabIndex] = useState<number>(DAILY_TAB)
  const [snapshot, setSnapshot] = useState<SleepTrackerSnapshot | null>(() => 
    settings.useMockData ? loadMockSleepTrackerSnapshot() : loadCachedSleepTrackerSnapshot()
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const next = settings.useMockData 
        ? await refreshMockSleepTrackerSnapshot(MOCK_HISTORY_DAYS)
        : await refreshSleepTrackerSnapshot(DEFAULT_QUERY_DAYS)
      setSnapshot(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取数据失败。"
      setError(message)
      const cached = settings.useMockData ? loadMockSleepTrackerSnapshot() : loadCachedSleepTrackerSnapshot()
      if (cached) setSnapshot(cached)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [settings.useMockData])

  return (
    <TabView
      tabIndex={tabIndex}
      onTabIndexChanged={(value) => setTabIndex(value)}
      tint="#36C6B0"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="每日" systemImage="moon.stars.fill" value={DAILY_TAB}>
        <DailyTab
          isActive={tabIndex === DAILY_TAB}
          snapshot={snapshot}
          settings={settings}
          loading={loading}
          error={error}
          onRefresh={() => {
            void refresh()
          }}
        />
      </Tab>

      <Tab title="趋势" systemImage="chart.bar.xaxis" value={TRENDS_TAB}>
        <TrendsTab
          isActive={tabIndex === TRENDS_TAB}
          snapshot={snapshot}
          settings={settings}
        />
      </Tab>

      <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
        <SettingsTab
          settings={settings}
          onChanged={(next) => {
            setSettings(next)
          }}
        />
      </Tab>
    </TabView>
  )
}
