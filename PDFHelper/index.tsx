import { Navigation, Script } from "scripting"
import { PDFHelperView } from "./components/PDFHelperView"
import { cleanUpPreviewDirectory } from "./utils/preview"

async function run() {
  await Navigation.present({ element: <PDFHelperView /> })
  await cleanUpPreviewDirectory()
  Script.exit()
}

run()
