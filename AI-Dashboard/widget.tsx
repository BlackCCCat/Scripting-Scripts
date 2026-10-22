import { Script, Widget } from "scripting"
import "./services/app_intents"
import { loadWidgetRenderData, WidgetRootView } from "./widgets"
import {
  loadDashboardSettings,
  loadStoredSnapshots,
} from "./utils/credential_store"
import {
  getWidgetRefreshMetadata,
  refreshAccountById,
} from "./services/refresh_service"
import { resolveWidgetReloadPolicy } from "./widgets/refresh_planner"

async function run() {
  try {
    let data = loadWidgetRenderData()
    const settings = loadDashboardSettings()
    const intervalMinutes = settings.widgetRefreshIntervalMinutes ?? 30

    // 小组件被 WidgetKit 唤醒时，针对当前小组件展示的账号（单账号或多账号看板）检测过期并进行后台活刷新
    if (!settings.isDemoMode && intervalMinutes > 0 && data.accounts.length > 0) {
      const currentSnapshots = loadStoredSnapshots()
      const now = Date.now()

      const staleAccounts = data.accounts.filter((acc) => {
        const meta = getWidgetRefreshMetadata(acc.id)
        const snap = currentSnapshots[acc.id]
        const fetchedAtMs = snap?.collectedAt
          ? new Date(snap.collectedAt).getTime()
          : 0
        const isStale = !fetchedAtMs || now - fetchedAtMs >= intervalMinutes * 60_000
        const isBackoff =
          meta.nextAutomaticAttemptAt &&
          new Date(meta.nextAutomaticAttemptAt).getTime() > now
        const isUnauthorized =
          meta.lastErrorCode === "invalidCredential" ||
          meta.lastErrorCode === "missingCredential"
        return isStale && !isBackoff && !isUnauthorized
      })

      if (staleAccounts.length > 0) {
        try {
          await Promise.race([
            (async () => {
              const CONCURRENCY = 3
              for (let i = 0; i < staleAccounts.length; i += CONCURRENCY) {
                const chunk = staleAccounts.slice(i, i + CONCURRENCY)
                await Promise.allSettled(chunk.map((a) => refreshAccountById(a.id)))
              }
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Widget fetch timeout")), 8500)
            ),
          ])
          data = loadWidgetRenderData()
        } catch {
          // 超时或部分失败时平滑降级，继续渲染已有快照
        }
      }
    }

    // 智能规划 WidgetKit 时间线重载策略（对齐 AI Usage：支持 fetchedAt 倒推、429退避与鉴权失效停更）
    const snapshots = loadStoredSnapshots()
    const metadataList = data.accounts.map((a) => getWidgetRefreshMetadata(a.id))
    const reloadPolicy = resolveWidgetReloadPolicy({
      snapshots: Object.values(snapshots),
      metadataList,
      reloadMinutes: intervalMinutes,
      now: Date.now(),
    })

    Widget.present(<WidgetRootView data={data} />, { reloadPolicy })
  } catch (err) {
    console.warn("[AI Dashboard Widget] Render error:", err)
  }
  Script.exit()
}

void run()
