import { Navigation, Script } from "scripting"
import { CalendarTimerView } from "./components/CalendarTimerView"

async function run() {
  await Navigation.present({
    element: <CalendarTimerView />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
