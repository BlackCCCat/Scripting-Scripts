import { Button, HStack, Image, NavigationStack, Spacer, Text, Toolbar, ToolbarItem, ToolbarSpacer, VStack, ZStack, useRef, useState, type Rect, type VirtualNode } from "scripting"
import { createStateSource } from "../shared/EventBus"
import type { TabActions } from "../shared/TabActions"
import { useBusState } from "../hooks/useBusState"
import { createLiquidDock, LiquidDock, LiquidDockMenu, type DockMenuPresentation } from "./LiquidDock"
import { HomeView } from "./HomeView"
import { SubscriptionsView } from "./SubscriptionsView"
import { SettingsView } from "./SettingsView"
import { RemoteControlView } from "./RemoteControlView"
import { loadConfig } from "../utils/config"

const direct = (change: () => void) => change()

function DockMenuRow(props: { title: string; systemImage: string; disabled: boolean; action: () => void }) {
  return (
    <Button buttonStyle="plain" disabled={props.disabled} action={props.action} accessibilityLabel={props.title}>
      <HStack spacing={12} padding={{ horizontal: 18 }} frame={{ width: 220, height: 52 }} contentShape="rect" opacity={props.disabled ? 0.35 : 1}>
        <Image systemName={props.systemImage} font={18} frame={{ width: 24 }} />
        <Text>{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function SurgeApp(): VirtualNode {
  const [selection] = useState(() => createStateSource("modules"))
  const [moduleActions] = useState(() => createStateSource<TabActions | null>(null))
  const [subscriptionActions] = useState(() => createStateSource<TabActions | null>(null))
  const [menu, setMenu] = useState<DockMenuPresentation | null>(null)
  const [remoteVisible, setRemoteVisible] = useState(false)
  const [configRevision, setConfigRevision] = useState(0)
  const serial = useRef(0)
  const active = useBusState(selection, direct)

  function select(value: string) {
    if (value === selection.read()) return
    selection.write(value)
    setMenu(null)
    HapticFeedback.selection()
  }

  function openMenu(value: string, anchor: Rect, presented: () => void): boolean {
    select(value)
    if (value === "settings") {
      setMenu({
        id: ++serial.current, anchor, width: 220, height: 52, onPresented: presented,
        content: <DockMenuRow title="HTTP 远程控制" systemImage="switch.2" disabled={false}
          action={() => { setMenu(null); HapticFeedback.mediumImpact(); setRemoteVisible(true) }} />,
      })
      return true
    }
    const isModules = value === "modules"
    const source = isModules ? moduleActions : subscriptionActions
    const actions = source.read()
    if (!actions) return false
    const run = (kind: "add" | "update" | "search" | "batch") => {
      setMenu(null)
      const current = source.read()
      if (!current || (kind === "add" && !current.canAdd) || (kind === "update" && !current.canUpdate)) return
      HapticFeedback.mediumImpact()
      current[kind]()
    }
    setMenu({
      id: ++serial.current,
      anchor,
      width: 220,
      height: 208,
      onPresented: presented,
      content: (
        <VStack spacing={0}>
          <DockMenuRow title={isModules ? "添加模块" : "添加订阅"} systemImage="plus" disabled={!actions.canAdd} action={() => run("add")} />
          <DockMenuRow title={isModules ? "更新筛选模块" : "更新全部订阅"} systemImage="arrow.triangle.2.circlepath" disabled={!actions.canUpdate} action={() => run("update")} />
          <DockMenuRow title={actions.searchActive ? "关闭搜索" : "搜索"} systemImage="magnifyingglass" disabled={false} action={() => run("search")} />
          <DockMenuRow title={actions.batchActive ? "退出批量操作" : "批量操作"} systemImage="checklist" disabled={false} action={() => run("batch")} />
        </VStack>
      ),
    })
    return true
  }

  const [dock] = useState(() => createLiquidDock({
    selection,
    items: [
      { value: "modules", title: "模块", systemImage: "square.stack.3d.up" },
      { value: "subscriptions", title: "订阅", systemImage: "network" },
      { value: "settings", title: "设置", systemImage: "gearshape" },
    ],
    onSelectionChanged: select,
    onMenu: request => openMenu(request.value, request.anchor, request.presented) ? "accepted" : "rejected",
  }))
  const bottomBar = <LiquidDock controller={dock} />

  return (
    <NavigationStack>
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationTitle={active === "modules" ? "模块资料库" : active === "subscriptions" ? "节点订阅" : "设置"}
      navigationBarTitleDisplayMode="inline"
      toolbar={<Toolbar>
        <ToolbarSpacer placement="bottomBar" sizing="flexible" />
        <ToolbarItem placement="bottomBar" sharedBackgroundVisibility="hidden">{bottomBar}</ToolbarItem>
        <ToolbarSpacer placement="bottomBar" sizing="flexible" />
      </Toolbar>}
      toolbarBackground={{ style: "clear", bars: ["bottomBar"] }}
      toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["bottomBar"] }}
      sheet={{ isPresented: remoteVisible, onChanged: setRemoteVisible,
        content: <RemoteControlView initial={loadConfig()} onDone={() => {
          setRemoteVisible(false)
          setConfigRevision(value => value + 1)
        }} /> }}
      scrollEdgeEffectHidden={active !== "subscriptions" && parseInt(Device.systemVersion, 10) >= 26
        ? { edges: "bottom", hidden: true } : undefined}
      overlay={<ZStack ignoresSafeArea><LiquidDockMenu presentation={menu} onDismiss={() => setMenu(null)} /></ZStack>}>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} opacity={active === "modules" ? 1 : 0}
        allowsHitTesting={active === "modules"} accessibilityHidden={active !== "modules"}>
        <HomeView onActionsChange={moduleActions.write} configRevision={configRevision} />
      </VStack>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} opacity={active === "subscriptions" ? 1 : 0}
        allowsHitTesting={active === "subscriptions"} accessibilityHidden={active !== "subscriptions"}>
        <SubscriptionsView onActionsChange={subscriptionActions.write} />
      </VStack>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} opacity={active === "settings" ? 1 : 0}
        allowsHitTesting={active === "settings"} accessibilityHidden={active !== "settings"}>
        <SettingsView embedded active={active === "settings"} configRevision={configRevision}
          onDone={() => setConfigRevision(value => value + 1)} />
      </VStack>
    </ZStack>
    </NavigationStack>
  )
}
