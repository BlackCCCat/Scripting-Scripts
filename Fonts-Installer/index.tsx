import {
  Button,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  Script,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"
import { formatFileSize, inspectFontFile, type InspectedFont } from "./font"
import { useMarkdownChangelogSheet } from "./changelog"
import { openFontInstaller } from "./profile"
import { presentFontPreview } from "./preview"
import {
  removeExpiredStagedFonts,
  removeStagedFont,
  sharedFontPathFromQuery,
} from "./shared-font"
import { SharedFontInstallView } from "./shared-install-view"
import { colors, CustomGradientBackground } from "./theme"

const isIOS26OrLater = Number.parseInt(Device.systemVersion.split(".")[0] || "0", 10) >= 26

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Card(props: { children: JSX.Element | JSX.Element[]; spacing?: number }) {
  return (
    <VStack
      spacing={props.spacing ?? 14}
      padding={20}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...(isIOS26OrLater
        ? { glassEffect: { type: "rect", cornerRadius: 24 } as any }
        : {
            background: {
              style: colors.nativeCard,
              shape: { type: "rect", cornerRadius: 20 },
            },
          })}
    >
      {props.children}
    </VStack>
  )
}

function DetailRow(props: { label: string; value: string }) {
  return (
    <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="subheadline" foregroundStyle={colors.secondary} frame={{ width: 92, alignment: "leading" }}>
        {props.label}
      </Text>
      <Text
        font="subheadline"
        foregroundStyle={colors.primary}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {props.value}
      </Text>
    </HStack>
  )
}

function FontsInstallerView() {
  const dismiss = Navigation.useDismiss()
  const changelogSheet = useMarkdownChangelogSheet({
    markdownFile: "changelog.md",
    storageKey: "fonts-installer:changelog:last-seen-hash",
    title: "更新说明",
  })
  const [selected, setSelected] = useState<InspectedFont | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("选择一个 .ttf 或 .otf 文件开始")

  const importFont = async () => {
    if (busy) return
    setBusy(true)
    setStatus("正在读取字体…")
    try {
      const paths = await DocumentPicker.pickFiles({
        types: ["public.font"],
        allowsMultipleSelection: false,
        shouldShowFileExtensions: true,
      })
      if (!paths.length) {
        setStatus(selected ? "已保留当前字体" : "未选择字体")
        return
      }
      const font = await inspectFontFile(paths[0])
      setSelected(font)
      setStatus("字体已就绪，可预览或安装")
      HapticFeedback.notificationSuccess()
    } catch (error) {
      setStatus("导入失败")
      await Dialog.alert({ title: "无法导入字体", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const previewFont = async () => {
    if (!selected || busy) return
    setBusy(true)
    setStatus("正在生成字体预览…")
    try {
      await presentFontPreview(selected.info, selected.data)
      setStatus("字体已就绪，可预览或安装")
    } catch (error) {
      setStatus("预览失败")
      await Dialog.alert({ title: "无法预览字体", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const installFont = async () => {
    if (!selected || busy) return
    setBusy(true)
    setStatus("正在生成配置描述文件…")
    try {
      await openFontInstaller(selected.info, selected.data)
      setStatus("描述文件已交给系统，请在“设置”中确认安装")
      HapticFeedback.notificationSuccess()
    } catch (error) {
      setStatus("安装请求失败")
      await Dialog.alert({ title: "无法开始安装", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <NavigationStack>
      <ZStack
        navigationTitle="Fonts Installer"
        navigationBarTitleDisplayMode="inline"
        sheet={changelogSheet}
        toolbar={{ cancellationAction: <Button title="关闭" action={() => dismiss()} /> }}
      >
        <CustomGradientBackground />
        <ScrollView>
          <VStack spacing={18} padding={{ top: 20, bottom: 36, leading: 18, trailing: 18 }}>
            <Card spacing={10}>
              <HStack spacing={14} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Image
                  systemName="textformat"
                  font={34}
                  foregroundStyle={colors.accent}
                  frame={{ width: 52, height: 52 }}
                />
                <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="title2" fontWeight="bold" foregroundStyle={colors.primary}>
                    字体查看与安装
                  </Text>
                  <Text font="subheadline" foregroundStyle={colors.secondary}>
                    验证字体、查看真实字形，并生成 iOS 配置描述文件。
                  </Text>
                </VStack>
              </HStack>
              <Button
                title={selected ? "更换字体" : "导入字体"}
                systemImage="square.and.arrow.down"
                buttonStyle={isIOS26OrLater ? "glassProminent" : "borderedProminent"}
                disabled={busy}
                action={importFont}
              />
            </Card>

            {selected ? (
              <Card>
                <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <VStack
                    alignment="leading"
                    spacing={4}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <Text font="title3" fontWeight="semibold" foregroundStyle={colors.primary}>
                      {selected.info.fullName}
                    </Text>
                    <Text font="caption" foregroundStyle={colors.secondary}>
                      {selected.info.fileName}
                    </Text>
                  </VStack>
                  <Text
                    font="caption"
                    foregroundStyle={colors.success}
                    padding={{ horizontal: 10, vertical: 6 }}
                    background={{
                      style: { light: "rgba(15,138,104,0.12)", dark: "rgba(72,214,170,0.16)" },
                      shape: { type: "capsule", style: "continuous" },
                    }}
                  >
                    已验证
                  </Text>
                </HStack>

                <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <DetailRow label="字体家族" value={selected.info.familyName} />
                  <DetailRow label="样式" value={selected.info.styleName} />
                  <DetailRow label="PostScript" value={selected.info.postScriptName} />
                  <DetailRow label="格式" value={`${selected.info.format} · ${formatFileSize(selected.info.fileSize)}`} />
                </VStack>

                <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
                  <Button
                    title="预览字体"
                    systemImage="character.book.closed"
                    buttonStyle={isIOS26OrLater ? "glass" : "bordered"}
                    disabled={busy}
                    action={previewFont}
                  />
                  <Spacer />
                  <Button
                    title="安装到系统"
                    systemImage="checkmark.shield"
                    buttonStyle={isIOS26OrLater ? "glassProminent" : "borderedProminent"}
                    disabled={busy}
                    action={installFont}
                  />
                </HStack>
              </Card>
            ) : (
              <Card spacing={8}>
                <Text font="headline" foregroundStyle={colors.primary}>支持的字体</Text>
                <Text font="subheadline" foregroundStyle={colors.secondary}>
                  支持单个 TrueType (.ttf) 与 OpenType (.otf)。Apple 不允许通过字体描述文件安装 .ttc 或 .otc 字体集合。
                </Text>
              </Card>
            )}

            <Card spacing={8}>
              <Text font="headline" foregroundStyle={colors.primary}>安装说明</Text>
              <Text font="subheadline" foregroundStyle={colors.secondary}>
                点按“安装到系统”后，iOS 会接管配置描述文件。请按照系统提示，在“设置”中检查字体名称并完成安装。删除字体时，也需要在“设置”的描述文件页面移除对应项目。
              </Text>
            </Card>

            <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" }}>
              {busy ? <ProgressView progressViewStyle="circular" /> : null}
              <Text font="footnote" foregroundStyle={colors.secondary}>{status}</Text>
            </HStack>
          </VStack>
        </ScrollView>
      </ZStack>
    </NavigationStack>
  )
}

async function run() {
  const sharedFontPath = sharedFontPathFromQuery()
  try {
    await removeExpiredStagedFonts()
    if (sharedFontPath) {
      const font = await inspectFontFile(sharedFontPath)
      await Navigation.present({ element: <SharedFontInstallView selectedFont={font} /> })
    } else {
      await Navigation.present({ element: <FontsInstallerView /> })
    }
  } catch (error) {
    await Dialog.alert({ title: "无法打开字体", message: errorMessage(error) })
  } finally {
    if (sharedFontPath) {
      try {
        await removeStagedFont(sharedFontPath)
      } catch (error) {
        console.warn("无法清理分享的字体副本", error)
      }
    }
    DocumentPicker.stopAcessingSecurityScopedResources()
    Script.exit()
  }
}

run()
