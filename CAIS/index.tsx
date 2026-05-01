import { Navigation, Script } from "scripting"
import { AppRoot } from "./components/AppRoot"
import { readAppFullscreen } from "./utils/window_state"

async function run() {
  const fullscreen = readAppFullscreen(false)
  await Navigation.present({
    element: <AppRoot />,
    ...(fullscreen ? { modalPresentationStyle: "fullScreen" as const } : {}),
  })
  Script.exit()
}

void run()
