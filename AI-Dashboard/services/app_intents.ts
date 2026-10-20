import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

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
