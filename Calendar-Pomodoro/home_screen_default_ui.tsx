// App 首页 Tab 入口：该文件必须位于脚本根目录，且默认导出函数组件。
// Home Screen UI 现在需要脚本自己提供导航结构，Reload 菜单会挂到这个导航栏上。
import { NavigationStack } from "scripting"
import { CalendarTimerView } from "./components/CalendarTimerView"

export default function HomeScreenDefaultUI() {
  return (
    <NavigationStack>
      <CalendarTimerView homeScreenMode />
    </NavigationStack>
  )
}
