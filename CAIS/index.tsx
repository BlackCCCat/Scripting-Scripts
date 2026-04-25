import { Navigation, Script } from "scripting"
import { AppRoot } from "./components/AppRoot"

async function run() {
  await Navigation.present({
    element: <AppRoot />,
  })
  Script.exit()
}

void run()
