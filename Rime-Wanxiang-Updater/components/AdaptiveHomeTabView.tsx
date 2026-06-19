import {
  Device,
  Label,
  Tab,
  TabView,
  VStack,
} from "scripting"

type AdaptiveHomeTabViewProps = {
  selection: any
  editor: any
  main: any
  settings: any
}

function systemMajorVersion(): number {
  const major = Number.parseInt(String(Device.systemVersion ?? "").split(".")[0], 10)
  return Number.isFinite(major) ? major : 18
}

function LegacyTabPage(props: {
  title: string
  systemImage: string
  value: number
  children: any
}) {
  return (
    <VStack
      tag={props.value}
      tabItem={<Label title={props.title} systemImage={props.systemImage} />}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {props.children}
    </VStack>
  )
}

export function AdaptiveHomeTabView(props: AdaptiveHomeTabViewProps) {
  if (systemMajorVersion() < 18) {
    return (
      <TabView selection={props.selection} tint="systemBlue">
        <LegacyTabPage title="文件" systemImage="folder.fill" value={0}>
          {props.editor}
        </LegacyTabPage>
        <LegacyTabPage title="主页" systemImage="house.fill" value={1}>
          {props.main}
        </LegacyTabPage>
        <LegacyTabPage title="设置" systemImage="gearshape" value={2}>
          {props.settings}
        </LegacyTabPage>
      </TabView>
    )
  }

  return (
    <TabView
      selection={props.selection}
      tint="systemBlue"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
    >
      <Tab title="文件" systemImage="folder.fill" value={0}>
        {props.editor}
      </Tab>
      <Tab title="主页" systemImage="house.fill" value={1}>
        {props.main}
      </Tab>
      <Tab title="设置" systemImage="gearshape" value={2}>
        {props.settings}
      </Tab>
    </TabView>
  )
}
