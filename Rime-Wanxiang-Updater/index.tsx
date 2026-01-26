// File: index.tsx
import { Navigation, Script } from "scripting"
import { HomeView } from "./components/HomeView"

async function run() {
  await Navigation.present({
    element: <HomeView />,
  })

  // 视图关闭后退出脚本（Scripting 推荐模式）
  Script.exit()
}

run()