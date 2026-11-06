import { Navigation, Script } from "scripting"
import { TranslatorRootView } from "./components/TranslatorRootView"
import { PhotoTranslationView } from "./components/PhotoTranslationView"

async function run() {
  await Navigation.present({
    element: Script.env === "camera_control"
      ? <PhotoTranslationView initialBatch={Script.cameraControlParameter} startInCamera={!Script.cameraControlParameter} />
      : <TranslatorRootView />,
    modalPresentationStyle: "overFullScreen",
  })

  Script.exit()
}

void run()
