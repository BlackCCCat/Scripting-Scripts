import {
  Button,
  Form,
  HStack,
  Image,
  Navigation,
  NavigationLink,
  NavigationStack,
  QRImage,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useObservable,
  useState,
} from "scripting"
import type { CaisSettings } from "../types"
import { getLanShareRuntimeStatus, type LanShareRuntimeStatus } from "../services/lan_share_server"
import type { NavigationZoomNamespace, NavigationZoomTransition } from "../utils/navigation_zoom"
import { writeTextToPasteboard } from "../services/pasteboard_adapter"
import { listTrustedDevices, revokeTrustedDevice, type TrustedDevice } from "../services/lan_share_credentials"
import { formatDateTime } from "../utils/common"
import { browserIcon } from "../assets/browser_icons"

function displayDeviceName(name: string): string {
  return name.replace(/^MacIntel(?= · )/, "Mac").replace(/^Win32(?= · )/, "Windows")
}

function TrustedDevicesView(props: { navigationTransition?: NavigationZoomTransition }) {
  const [devices, setDevices] = useState<TrustedDevice[]>(() => listTrustedDevices())

  async function remove(device: TrustedDevice) {
    const confirmed = await Dialog.confirm({
      title: `移除“${displayDeviceName(device.name)}”？`,
      message: "此浏览器下次连接需要重新输入访问码。",
      cancelLabel: "取消",
      confirmLabel: "移除",
    })
    if (!confirmed) return
    try {
      revokeTrustedDevice(device.id)
      setDevices(listTrustedDevices())
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "移除失败") })
    }
  }

  return (
    <Form
      formStyle="grouped"
      navigationTransition={props.navigationTransition}
      navigationTitle="信任设备"
      navigationBarTitleDisplayMode="inline"
      onAppear={() => setDevices(listTrustedDevices())}
    >
      <Section footer={<Text>信任的是当前浏览器资料。移除后若设备仍保存带访问码的扫码链接，请同时更换访问码。</Text>}>
        {devices.length ? devices.map((device) => {
          const icon = browserIcon(device.name.split(" · ").pop() ?? "")
          return (
            <HStack key={device.id} spacing={12}>
              {icon ? (
                <Image
                  image={icon}
                  resizable
                  frame={{ width: 22, height: 22 }}
                />
              ) : <Image systemName="globe" foregroundStyle="systemIndigo" frame={{ width: 22, height: 22 }} />}
              <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  {displayDeviceName(device.name)}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  {formatDateTime(device.createdAt)}
                </Text>
              </VStack>
              <Button
                title=""
                systemImage="trash"
                accessibilityLabel={`移除${displayDeviceName(device.name)}`}
                role="destructive"
                action={() => void remove(device)}
              />
            </HStack>
          )
        }) : <Text foregroundStyle="secondaryLabel">暂无信任设备</Text>}
      </Section>
    </Form>
  )
}

export function LanShareSettingsView(props: {
  value: CaisSettings
  status?: LanShareRuntimeStatus
  standalone?: boolean
  navigationTransition?: NavigationZoomTransition
  zoomNamespace?: NavigationZoomNamespace
  onChanged: (settings: CaisSettings) => void | Promise<void>
  onRotateToken?: () => void | Promise<void>
}) {
  const [localSettings, setLocalSettings] = useState(props.value)
  const [localStatus, setLocalStatus] = useState(props.status)
  const settings = props.standalone ? localSettings : props.value
  const status = props.standalone ? localStatus : props.status
  const available = status?.state === "running" || status?.state === "delegated"
  const addressCopied = useObservable(false)

  async function update(next: Partial<CaisSettings>) {
    const updated = { ...settings, ...next }
    if (props.standalone) setLocalSettings(updated)
    await props.onChanged(updated)
    if (props.standalone) setLocalStatus(getLanShareRuntimeStatus(updated))
  }

  async function editPort() {
    const value = await Dialog.prompt({
      title: "局域网端口",
      message: "请输入 1024 到 65535 之间的端口。",
      defaultValue: String(settings.lanSharingPort),
      selectAll: true,
      keyboardType: "numberPad",
      cancelLabel: "取消",
      confirmLabel: "保存",
    })
    if (value == null) return
    const port = Number(value.trim())
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      await Dialog.alert({ title: "端口无效", message: "端口必须是 1024 到 65535 之间的整数。" })
      return
    }
    update({ lanSharingPort: port })
  }

  async function copyAddress() {
    if (!status?.address) return
    await writeTextToPasteboard(status.address)
    addressCopied.setValue(false)
    ;(globalThis as any).setTimeout?.(() => addressCopied.setValue(true), 0)
  }

  return (
    <Form
      formStyle="grouped"
      onAppear={props.standalone ? () => setLocalStatus(getLanShareRuntimeStatus(localSettings)) : undefined}
      navigationTransition={props.navigationTransition}
      navigationTitle="局域网共享"
      navigationBarTitleDisplayMode="inline"
      toast={{
        isPresented: addressCopied,
        message: "已复制访问地址",
        duration: 2,
        position: "bottom",
      }}
    >
      <Section footer={<Text>服务只在 CAIS 或首页 UI 保持运行时可用，不会启用后台音频保活。</Text>}>
        <Toggle
          value={settings.lanSharingEnabled}
          onChanged={(lanSharingEnabled: boolean) => void update({ lanSharingEnabled })}
          toggleStyle="switch"
        >
          <HStack>
            <Image systemName="network" foregroundStyle="systemIndigo" />
            <Text>开启局域网共享</Text>
          </HStack>
        </Toggle>
        <Button
          title={`端口 ${settings.lanSharingPort}`}
          systemImage="number"
          disabled={!settings.lanSharingEnabled}
          action={editPort}
        />
      </Section>

      {settings.lanSharingEnabled ? (
        <Section header={<Text>连接状态</Text>}>
          <HStack
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            background="rgba(0,0,0,0.001)"
            contentShape="rect"
            spacing={10}
            onTapGesture={status?.address ? () => void copyAddress() : undefined}
          >
            <Image
              systemName={status?.state === "error" ? "exclamationmark.circle.fill" : "circle.fill"}
              foregroundStyle={available ? "systemGreen" : status?.state === "error" ? "systemRed" : "systemOrange"}
              font="caption"
            />
            <VStack frame={{ maxWidth: "infinity", alignment: "leading" as any }} spacing={3}>
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                {status?.message ?? "等待服务启动"}
              </Text>
              {status?.address ? (
                <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }} spacing={6}>
                  <Text foregroundStyle="secondaryLabel" font="caption">{status.address}</Text>
                  <Text foregroundStyle="systemIndigo" font="caption">点击复制</Text>
                </HStack>
              ) : null}
            </VStack>
          </HStack>
        </Section>
      ) : null}

      {settings.lanSharingEnabled && available && status?.accessUrl ? (
        <Section
          header={<Text>扫码连接</Text>}
          footer={<Text>手机或平板扫描二维码后可直接完成验证。</Text>}
        >
          <VStack
            frame={{ maxWidth: "infinity", alignment: "center" as any }}
            padding={{ top: 14, bottom: 14 }}
            spacing={12}
          >
            <QRImage data={status.accessUrl} size={210} />
            <Text foregroundStyle="secondaryLabel" font="caption">{status.address ?? ""}</Text>
          </VStack>
        </Section>
      ) : null}

      {settings.lanSharingEnabled ? (
        <Section
          header={<Text>手动连接</Text>}
          footer={<Text>电脑打开上方地址，然后输入访问码。浏览器支持持久存储时，下次连接无需重复输入。</Text>}
        >
          <HStack>
            <Image systemName="key.fill" foregroundStyle="systemOrange" />
            <Text>访问码</Text>
            <Spacer />
            <Text font={{ name: "Menlo", size: 18 }}>{status?.accessCode || "--------"}</Text>
          </HStack>
          <Button
            title="复制访问码"
            systemImage="doc.on.doc"
            action={async () => {
              if (status?.accessCode) await writeTextToPasteboard(status.accessCode)
            }}
          />
          <Button
            title="更换访问码"
            systemImage="arrow.triangle.2.circlepath"
            action={async () => {
              await props.onRotateToken?.()
              if (props.standalone) setLocalStatus(getLanShareRuntimeStatus(settings))
            }}
          />
        </Section>
      ) : null}

      <Section>
        {props.standalone ? (
          <Button
            buttonStyle="plain"
            action={() => void Navigation.present({
              element: <NavigationStack><TrustedDevicesView /></NavigationStack>,
              modalPresentationStyle: "pageSheet",
            })}
          >
            <HStack
              spacing={10}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              background="rgba(0,0,0,0.001)"
              contentShape="rect"
            >
              <Image systemName="laptopcomputer.and.iphone" foregroundStyle="systemIndigo" />
              <Text>信任设备</Text>
              <Spacer />
              <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>
        ) : (
          <NavigationLink destination={<TrustedDevicesView navigationTransition={props.zoomNamespace ? {
            type: "zoom", sourceID: "lan-trusted-devices", namespace: props.zoomNamespace,
          } : undefined} />}>
            <HStack
              spacing={10}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              background="rgba(0,0,0,0.001)"
              contentShape="rect"
              matchedTransitionSource={props.zoomNamespace ? {
                id: "lan-trusted-devices", namespace: props.zoomNamespace,
              } : undefined}
            >
              <Image systemName="laptopcomputer.and.iphone" foregroundStyle="systemIndigo" />
              <Text>信任设备</Text>
            </HStack>
          </NavigationLink>
        )}
      </Section>
    </Form>
  )
}
