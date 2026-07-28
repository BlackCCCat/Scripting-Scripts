// App 首页 Tab 入口：该文件必须位于脚本根目录，且默认导出函数组件。
// 注意：Home Screen UI 已由 Scripting 外层提供 NavigationStack，这里不能再自行包一层。
import { CalendarTimerView } from "./components/CalendarTimerView"

export default function HomeScreenDefaultUI() {
  return <CalendarTimerView homeScreenMode />
}
