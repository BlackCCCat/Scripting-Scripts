import { PasswordGeneratorView } from "./components/PasswordGeneratorView"

function run() {
  const keyboard = (globalThis as any).CustomKeyboard
  if (!keyboard || typeof keyboard.present !== "function") {
    throw new Error("当前运行环境不支持自定义键盘")
  }
  try { keyboard.setToolbarVisible(false) } catch {}
  try { keyboard.setHasDictationKey(false) } catch {}
  keyboard.present(<PasswordGeneratorView mode="keyboard" />)
}

run()
