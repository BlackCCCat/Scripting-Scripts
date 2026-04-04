import { Navigation, Script } from "scripting"
import { HomeView } from "./components/HomeView"

async function run() {
  await Navigation.present({
    element: <HomeView />,
  })
  Script.exit()
}

void run()
