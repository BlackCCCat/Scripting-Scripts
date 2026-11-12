// Exact README navigation example.
import { useObservable, useState } from "scripting"
import { createLiquidDock, LiquidDock, type DockAppearance } from "./index"

const palette: DockAppearance = { surface: "#EEEDE7", foreground: "#77786F",
  selectedSurface: "#DDE5D5", selectedForeground: "#39482F", border: "#C8CCBF", shadow: "#00000018" }

function NavigationBar() {
  const selection = useObservable("search")
  const [dock] = useState(() => createLiquidDock({
    selection,
    items: [
      { value: "home", title: "首页", systemImage: "house" },
      { value: "search", title: "搜索", systemImage: "magnifyingglass" },
      { value: "saved", title: "收藏", systemImage: "bookmark" },
    ],
  }))
  return <LiquidDock controller={dock} appearance={palette} width={258} />
}
