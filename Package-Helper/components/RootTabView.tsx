import {
  Tab,
  TabView,
  useObservable,
  useState,
} from "scripting"

import { HomePage } from "./HomePage"
import { PreviewPage } from "./PreviewPage"
import { SettingsPage } from "./SettingsPage"
import { HOME_TAB, PREVIEW_TAB, SETTINGS_TAB } from "../types"
import { deleteHomePickup, deletePreviewPickup, markPicked, safeRefreshWidget, unmarkPicked } from "../utils"

export function RootTabView(props: {
  initialNotice?: string | null
}) {
  const selection = useObservable(HOME_TAB)
  const [, setVersion] = useState(0)

  function bump() {
    setVersion((current) => current + 1)
  }

  return (
    <TabView
      selection={selection as any}
      tint="systemBlue"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="预览" systemImage="doc.text.magnifyingglass" value={PREVIEW_TAB}>
        <PreviewPage
          onChanged={() => bump()}
          onDelete={(code) => {
            deletePreviewPickup(code)
            bump()
          }}
          onClear={() => {
            bump()
          }}
        />
      </Tab>

      <Tab title="主页" systemImage="house.fill" value={HOME_TAB}>
        <HomePage
          onRefresh={() => bump()}
          onPicked={(code) => {
            markPicked(code)
            safeRefreshWidget()
            bump()
          }}
          onUnpicked={(code) => {
            unmarkPicked(code)
            safeRefreshWidget()
            bump()
          }}
          onDelete={(code) => {
            deleteHomePickup(code)
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
