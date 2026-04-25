import { KeyboardView, preloadKeyboardInitialState, type KeyboardInitialState } from "./components/KeyboardView"

async function run() {
  const keyboard = (globalThis as any).CustomKeyboard
  if (!keyboard || typeof keyboard.present !== "function") {
    throw new Error("当前运行环境不支持自定义键盘")
  }
  try { keyboard.setToolbarVisible(false) } catch {}
  try { keyboard.setHasDictationKey(false) } catch {}
  let initialState: KeyboardInitialState | undefined
  try {
    initialState = await preloadKeyboardInitialState()
  } catch {
    initialState = undefined
  }
  keyboard.present(<KeyboardView initialState={initialState} />)
}

void run()
