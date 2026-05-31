import {
  Script,
  Navigation,
  NavigationStack,
  TabView,
  VStack,
  Label,
  Widget,
  useState,
  useObservable,
  VirtualNode,
} from "scripting"
import { FuelCode } from "./src/types"
import {
  getPreferredFuel,
  setPreferredFuel,
  getSearchRadiusKm,
  setSearchRadiusKm,
} from "./src/settings"
import { HomePage } from "./src/HomePage"
import { NearbyPage } from "./src/NearbyPage"
import { SettingsPage } from "./src/SettingsPage"
import { Theme } from "./src/theme"

/** 给页面套上导航标题的容器 */
function Page({
  title,
  children,
}: {
  title: string
  children: VirtualNode
}) {
  return (
    <VStack
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {children}
    </VStack>
  )
}

function App() {
  const selection = useObservable<number>(0)
  const [preferred, setPreferred] = useState<FuelCode>(getPreferredFuel())
  const [radiusKm, setRadiusKm] = useState<number>(getSearchRadiusKm())

  function changePreferred(code: FuelCode) {
    setPreferredFuel(code)
    setPreferred(code)
    Widget.reloadAll()
  }

  function changeRadius(km: number) {
    setSearchRadiusKm(km)
    setRadiusKm(km)
  }

  return (
    <TabView selection={selection} tint={Theme.orange}>
      <NavigationStack
        tabItem={<Label title="油价" systemImage="fuelpump.fill" />}
        tag={0}
      >
        <Page title="今日油价">
          <HomePage preferred={preferred} />
        </Page>
      </NavigationStack>

      <NavigationStack
        tabItem={<Label title="附近油站" systemImage="mappin.and.ellipse" />}
        tag={1}
      >
        <Page title="附近油站">
          <NearbyPage radiusKm={radiusKm} />
        </Page>
      </NavigationStack>

      <NavigationStack
        tabItem={<Label title="设置" systemImage="gearshape.fill" />}
        tag={2}
      >
        <Page title="设置">
          <SettingsPage
            preferred={preferred}
            radiusKm={radiusKm}
            onPreferredChange={changePreferred}
            onRadiusChange={changeRadius}
          />
        </Page>
      </NavigationStack>
    </TabView>
  )
}

async function run() {
  await Navigation.present({ element: <App /> })
  Script.exit()
}

run()
