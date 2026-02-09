import { Navigation } from "scripting";
import { HomeView } from "./components/HomeView";

async function run() {
  await Navigation.present({
    element: <HomeView />,
  });
}

void run();
