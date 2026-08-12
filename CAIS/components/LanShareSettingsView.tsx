import {
  Button,
  Form,
  HStack,
  Image,
  QRImage,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useObservable,
} from "scripting"
import type { CaisSettings } from "../types"
import type { LanShareRuntimeStatus } from "../services/lan_share_server"
import { writeTextToPasteboard } from "../services/pasteboard_adapter"

export function LanShareSettingsView(props: {
  value: CaisSettings
  status?: LanShareRuntimeStatus
  onChanged: (settings: CaisSettings) => void
  onRotateToken?: () => void
}) {
  const settings = props.value
  const status = props.status
  const available = status?.state === "running" || status?.state === "delegated"
  const addressCopied = useObservable(false)

  function update(next: Partial<CaisSettings>) {
    props.onChanged({ ...settings, ...next })
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
          onChanged={(lanSharingEnabled: boolean) => update({ lanSharingEnabled })}
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
          footer={<Text>电脑打开上方地址，然后输入访问码。访问码只保存在当前设备。</Text>}
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
            action={() => props.onRotateToken?.()}
          />
        </Section>
      ) : null}
    </Form>
  )
}
