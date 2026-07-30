import { Navigation, Script } from "scripting"
import { AppView } from "./components/AppView"

async function main() {
  await Navigation.present(<AppView />)
  Script.exit()
}

void main()
