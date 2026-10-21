import { Widget } from "scripting"
import type { WidgetRenderData } from "./types"
import { ExtraLargeWidgetView } from "./views/ExtraLargeWidgetView"
import { LargeWidgetView } from "./views/LargeWidgetView"
import { MediumWidgetView } from "./views/MediumWidgetView"
import { SmallWidgetView } from "./views/SmallWidgetView"

export function WidgetRootView(props: {
  data: WidgetRenderData
  family?: string
  onSelectWalletProvider?: (providerId: string) => void
}) {
  const { data, onSelectWalletProvider } = props
  const family = props.family || Widget.family

  switch (family) {
    case "systemSmall":
      return (
        <SmallWidgetView
          account={data.accounts[0]}
          allAccounts={data.accounts}
          lastUpdatedAt={data.lastUpdatedAt}
          adaptTransparent={data.widgetConnectionAdaptTransparent}
          onSelectProvider={onSelectWalletProvider}
        />
      )

    case "systemMedium":
      return (
        <MediumWidgetView
          accounts={data.accounts}
          lastUpdatedAt={data.lastUpdatedAt}
          adaptTransparent={data.widgetConnectionAdaptTransparent}
        />
      )

    case "systemLarge":
      return <LargeWidgetView data={data} />

    case "systemExtraLarge":
    case "systemExtraLargePortrait":
      return <ExtraLargeWidgetView data={data} />

    default:
      return (
        <SmallWidgetView
          account={data.accounts[0]}
          allAccounts={data.accounts}
          lastUpdatedAt={data.lastUpdatedAt}
          adaptTransparent={data.widgetConnectionAdaptTransparent}
          onSelectProvider={onSelectWalletProvider}
        />
      )
  }
}
