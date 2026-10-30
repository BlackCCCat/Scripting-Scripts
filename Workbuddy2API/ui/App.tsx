import { NavigationStack, Script, Tab, TabView, useEffect, useState } from "scripting"
import { accounts } from "../local/store"
import { refreshBalance } from "../local/upstream"
import { OverviewPage } from "./Overview"
import { AccountsPage } from "./Accounts"
import { TasksPage } from "./Tasks"
import { DataPage } from "./Data"
import { MorePage } from "./More"
import { useReleaseNotes } from "./ReleaseNotes"

export function App() {
  const [revision, setRevision] = useState(0)
  const [dataRevision, setDataRevision] = useState(0)
  const releaseNotes = useReleaseNotes()
  const changed = () => setRevision(value => value + 1)
  useEffect(() => {
    let active = true, refreshing = false
    async function refreshBalances() {
      if (refreshing) return
      refreshing = true
      try {
        await Promise.allSettled(accounts().map(account => refreshBalance(account.uid)))
        if (active) setDataRevision(value => value + 1)
      } finally { refreshing = false }
    }
    void refreshBalances()
    const removeResume = Script.onResume(() => { setDataRevision(value => value + 1); void refreshBalances() })
    return () => { active = false; removeResume() }
  }, [])
  const visibleRevision = revision + dataRevision
  return <TabView tint="systemPurple" sheet={releaseNotes}>
    <Tab title="概览" systemImage="speedometer" value={0}><NavigationStack><OverviewPage revision={visibleRevision} onChanged={changed} /></NavigationStack></Tab>
    <Tab title="账号" systemImage="person.2.fill" value={1}><NavigationStack><AccountsPage revision={visibleRevision} onChanged={changed} /></NavigationStack></Tab>
    <Tab title="任务" systemImage="checklist" value={2}><NavigationStack><TasksPage revision={revision} /></NavigationStack></Tab>
    <Tab title="数据" systemImage="chart.bar.fill" value={3}><NavigationStack><DataPage revision={visibleRevision} /></NavigationStack></Tab>
    <Tab title="更多" systemImage="ellipsis.circle.fill" value={4}><NavigationStack><MorePage /></NavigationStack></Tab>
  </TabView>
}
