import { Navigation, Script } from "scripting"
import { HomeView } from "./components/HomeView"
import { clearMinimizeRequested, shouldResumeFromMinimize } from "./utils/runtime"

let isPresentingHome = false
const supportsMinimization =
  typeof Script.supportsMinimization === "function" && Script.supportsMinimization()

function shouldKeepRunning(): boolean {
  return supportsMinimization &&
    shouldResumeFromMinimize() &&
    typeof Script.isMinimized === "function" &&
    Script.isMinimized()
}

async function presentHome() {
  if (isPresentingHome) return
  isPresentingHome = true
  try {
    await Navigation.present({
      element: <HomeView />,
    })
  } finally {
    isPresentingHome = false
  }

  if (shouldKeepRunning()) {
    return
  }

  Script.exit()
}

async function run() {
  const removeResume =
    supportsMinimization && typeof Script.onResume === "function"
      ? Script.onResume(() => {
          clearMinimizeRequested()
          void presentHome()
        })
      : () => {}

  await presentHome()
  if (shouldKeepRunning()) {
    return
  }

  removeResume()
}

void run()
