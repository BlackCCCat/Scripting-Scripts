import { Tab, TabView, useObservable, useState } from "scripting"

import { ScriptTranslationView } from "./ScriptTranslationView"
import { TranslatorSettingsView } from "./TranslatorSettingsView"

const TRANSLATE_TAB = 0
const SETTINGS_TAB = 1

export function TranslatorRootView() {
  const selection = useObservable<number>(() => TRANSLATE_TAB)
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0)

  return (
    <TabView
      selection={selection}
      tint="systemBlue"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="翻译" systemImage="character.bubble" value={TRANSLATE_TAB}>
        <ScriptTranslationView
          settingsRefreshKey={settingsRefreshKey}
        />
      </Tab>

      <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
        <TranslatorSettingsView
          onSettingsChanged={() => {
            setSettingsRefreshKey((current) => current + 1)
          }}
        />
      </Tab>
    </TabView>
  )
}
