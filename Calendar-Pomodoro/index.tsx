import { Navigation } from "scripting";
import { CalendarTimerView } from "./components/CalendarTimerView";

async function run() {
  await Navigation.present({
    element: <CalendarTimerView />,
    modalPresentationStyle: "fullScreen",
  });
}

run();
