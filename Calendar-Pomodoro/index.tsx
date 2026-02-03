// Scripting 导航能力（用于展示页面）
import { Navigation } from "scripting"
// 主页面组件
import { CalendarTimerView } from "./components/CalendarTimerView"

async function run() {
  // 脚本入口：以全屏模态方式呈现主界面
  await Navigation.present({
    element: <CalendarTimerView />,
    modalPresentationStyle: "fullScreen",
  })
}

// 启动脚本
run()
