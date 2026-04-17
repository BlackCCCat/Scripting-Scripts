import { Navigation, Script } from "scripting"
import { RootTabView } from "./components/RootTabView"

export default function HomeView() {
  return <RootTabView />
}

async function run() {
  await Navigation.present({
    element: <HomeView />,
  })
  Script.exit()
}

void run()
