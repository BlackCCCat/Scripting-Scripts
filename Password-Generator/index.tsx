import { Navigation, Script } from "scripting"
import { PasswordGeneratorView } from "./components/PasswordGeneratorView"

async function run() {
  await Navigation.present({
    element: <PasswordGeneratorView mode="app" />,
  })
  Script.exit()
}

void run()
