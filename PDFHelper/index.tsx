import { Navigation, Script } from "scripting"
import { PDFHelperView } from "./components/PDFHelperView"

async function run() {
  await Navigation.present({ element: <PDFHelperView /> })
  Script.exit()
}

run()
