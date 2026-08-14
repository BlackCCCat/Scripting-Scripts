import { Navigation, Script } from "scripting"
import { TranslatorRootView } from "./components/TranslatorRootView"

async function run() {
  await Navigation.present({
    element: <TranslatorRootView />,
    modalPresentationStyle: "overFullScreen",
  })

  Script.exit()
}

void run()
