// File: index.tsx
import { Navigation, Script } from "scripting"
import { HomeView } from "./components/HomeView"
import { runStorageMigration } from "./utils/storage_migration"

let isPresentingHome = false
const supportsMinimization =
  typeof Script.supportsMinimization === "function" && Script.supportsMinimization()

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

  if (supportsMinimization) {
    return
  }

  Script.exit()
}

async function run() {
  runStorageMigration()

  const removeResume =
    supportsMinimization && typeof Script.onResume === "function"
      ? Script.onResume(() => {
          void presentHome()
        })
      : () => {}

  await presentHome()

  if (!supportsMinimization) {
    removeResume()
  }
}

run()
