import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { refreshAllAccountsFromBackground } from "./refresh_service"

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
 * 桌面小组件一键刷新所有账号用量
 */
export const RefreshAIDashboardAllIntent = AppIntentManager.register({
  name: "RefreshAIDashboardAllIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    await refreshAllAccountsFromBackground()
  },
})
