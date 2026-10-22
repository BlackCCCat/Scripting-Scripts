import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import {
  refreshAllAccountsFromBackground,
  setWidgetRefreshingState,
} from "./services/refresh_service"

export const ACTIVE_WALLET_KEY = "ai-dashboard:active-wallet:v1"

/**
 * 点击某个钱包卡片时，将该卡片置于最底端活跃展示
 */
export const SelectWalletIntent = AppIntentManager.register({
  name: "SelectWalletIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (providerId: string) => {
    if (providerId) {
      Storage.set(ACTIVE_WALLET_KEY, providerId)
      Widget.reloadAll()
    }
  },
})

/**
 * 桌面小组件右上角一键刷新所有账号用量
 * 支持 0.1s 即时响应动画反馈与展示卡片优先极速刷新
 */
export const RefreshAIDashboardAllIntent = AppIntentManager.register({
  name: "RefreshAIDashboardAllIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    // 1. 立即标记正在刷新状态并广播，让小组件 0.1 秒内出现响应反馈（“正在刷新...”）
    setWidgetRefreshingState(true)
    try {
      Widget.reloadAll()
    } catch {}

    // 2. 优先并发拉取小组件正在展示的核心账号，并在成功后立即落盘并刷新小组件
    try {
      await refreshAllAccountsFromBackground()
    } finally {
      setWidgetRefreshingState(false)
      try {
        Widget.reloadAll()
      } catch {}
    }
  },
})
