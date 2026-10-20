import { Navigation, Script } from "scripting"
import { DashboardRootView } from "./components/DashboardRootView"

async function run() {
  await Navigation.present({
    element: <DashboardRootView />,
    modalPresentationStyle: "overFullScreen",
  })
}

run().finally(() => {
  Script.exit()
})
