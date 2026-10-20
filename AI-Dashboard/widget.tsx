import { Script, Widget } from "scripting"
import "./services/app_intents"
import { loadWidgetRenderData, WidgetRootView } from "./widgets"
import { loadDashboardSettings } from "./utils/credential_store"

async function run() {
  try {
    const data = loadWidgetRenderData()
    const settings = loadDashboardSettings()
    const intervalMinutes = settings.widgetRefreshIntervalMinutes ?? 30

    // 建议 WidgetKit 按设置进行后台时间线拉取（默认 30 分钟）
    const nextReload = new Date(Date.now() + 1000 * 60 * intervalMinutes)

    Widget.present(<WidgetRootView data={data} />, {
      reloadPolicy: {
        policy: "after",
        date: nextReload,
      },
    })
  } catch (err) {
    console.warn("[AI Dashboard Widget] Render error:", err)
  }
  Script.exit()
}

void run()
