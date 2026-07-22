import {
  Tab,
  TabView,
  useObservable,
  useState,
} from "scripting"

import { HomePage } from "./HomePage"
import { PreviewPage } from "./PreviewPage"
import { useMarkdownReleaseNotesSheet } from "./ReleaseNotesSheet"
import { SettingsPage } from "./SettingsPage"
import { HOME_TAB, PREVIEW_TAB, SETTINGS_TAB } from "../types"
import { deleteHomePickup, deletePreviewPickup, markPicked, safeRefreshWidget, unmarkPicked } from "../utils"

export function RootTabView(props: {
  initialNotice?: string | null
}) {
  const selection = useObservable(HOME_TAB)
  const [version, setVersion] = useState(0)
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    title: "更新说明",
    markdownFile: "release-notes.md",
    storageKey: "sms-pickup:release-notes:last-seen-hash",
  })

  function bump() {
    setVersion((current) => current + 1)
  }

  return (
    <TabView
      selection={selection as any}
      tint="systemBlue"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
      sheet={releaseNotesSheet}
    >
      <Tab title="预览" systemImage="doc.text.magnifyingglass" value={PREVIEW_TAB}>
        <PreviewPage
          reloadToken={version}
          onChanged={() => bump()}
          onDelete={async (code) => {
            await deletePreviewPickup(code)
            bump()
          }}
          onClear={() => {
            bump()
          }}
        />
      </Tab>

      <Tab title="主页" systemImage="house.fill" value={HOME_TAB}>
        <HomePage
          reloadToken={version}
          onRefresh={() => bump()}
          onPicked={async (code) => {
            await markPicked(code)
            safeRefreshWidget()
            bump()
          }}
          onUnpicked={async (code) => {
            await unmarkPicked(code)
            safeRefreshWidget()
            bump()
          }}
          onDelete={async (code) => {
            await deleteHomePickup(code)
            safeRefreshWidget()
            bump()
          }}
        />
      </Tab>

      <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
        <SettingsPage
          onChanged={() => bump()}
        />
      </Tab>
    </TabView>
  )
}
