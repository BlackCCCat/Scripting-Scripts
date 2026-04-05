import { Navigation, Script } from "scripting"
import { TranslatorSettingsView } from "./components/TranslatorSettingsView"

async function run() {
  await Navigation.present({
    element: <TranslatorSettingsView />,
  })

  Script.exit()
}

void run()
