import { KeyboardView } from "./components/KeyboardView"
import { runStorageMigration } from "./utils/storage_migration"

function run() {
  runStorageMigration()
  const keyboard = (globalThis as any).CustomKeyboard
  if (!keyboard || typeof keyboard.present !== "function") {
    throw new Error("当前运行环境不支持自定义键盘")
  }
  keyboard.present(<KeyboardView />)
}

run()
