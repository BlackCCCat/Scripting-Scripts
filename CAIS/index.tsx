import { Navigation, Script } from "scripting"
import { AppRoot } from "./components/AppRoot"
import { readAppFullscreen } from "./utils/window_state"

const CAIS_APP_RESUME_HANDLER = "__CAIS_APP_RESUME_HANDLER__"

async function run() {
  const fullscreen = readAppFullscreen(false)
  const removeResume = Script.onResume?.((details) => {
    const handler = (globalThis as any)[CAIS_APP_RESUME_HANDLER]
    if (typeof handler === "function") {
      handler(details)
    }
  })
  try {
    await Navigation.present({
      element: <AppRoot />,
      ...(fullscreen ? { modalPresentationStyle: "fullScreen" as const } : {}),
    })
  } finally {
    removeResume?.()
    Script.exit()
  }
}

void run()
