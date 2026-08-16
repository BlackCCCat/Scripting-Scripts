import {
  Button,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Path,
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
import { CopyFontValueButton, FontDetailRow } from "./font-detail-row"
import { useMarkdownChangelogSheet } from "./changelog"
import { recordInstalledFont } from "./font-history"
import { FontHistoryView } from "./font-history-view"
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

function FontsInstallerView() {
  const dismiss = Navigation.useDismiss()
  const changelogSheet = useMarkdownChangelogSheet({
    markdownFile: "changelog.md",
    storageKey: "fonts-installer:changelog:last-seen-hash",
    title: "更新说明",
  })
  const [selectedFonts, setSelectedFonts] = useState<InspectedFont[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("选择一个或多个 .ttf / .otf 文件开始")

  const copyFontName = async (fontName: string) => {
    try {
      await Pasteboard.setString(fontName)
      setStatus(`已复制字体名称：${fontName}`)
      HapticFeedback.notificationSuccess()
    } catch (error) {
      await Dialog.alert({ title: "无法复制字体名称", message: errorMessage(error) })
    }
  }

  const openFontHistory = async () => {
    if (busy) return
    await Navigation.present({ element: <FontHistoryView /> })
  }

  const importFont = async () => {
    if (busy) return
    setBusy(true)
    setStatus("正在读取字体…")
    try {
      const paths = await DocumentPicker.pickFiles({
        types: ["public.font"],
        allowsMultipleSelection: true,
        shouldShowFileExtensions: true,
      })
      if (!paths.length) {
        setStatus(selectedFonts.length ? "已保留当前字体" : "未选择字体")
        return
      }

      const importedFonts: InspectedFont[] = []
      const failures: string[] = []
      for (const path of paths) {
        try {
          importedFonts.push(await inspectFontFile(path))
        } catch (error) {
          failures.push(`${Path.basename(path)}：${errorMessage(error)}`)
        }
      }
      if (!importedFonts.length) {
        throw new Error(failures[0] ?? "没有可用的字体文件。")
      }

      setSelectedFonts(importedFonts)
      setStatus(`已导入 ${importedFonts.length} 个字体，可逐个预览或安装`)
      HapticFeedback.notificationSuccess()
      if (failures.length) {
        await Dialog.alert({
          title: "部分字体未导入",
          message: `成功 ${importedFonts.length} 个，失败 ${failures.length} 个。\n\n${failures.join("\n")}`,
        })
      }
    } catch (error) {
      setStatus("导入失败")
      await Dialog.alert({ title: "无法导入字体", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const previewFont = async (selected: InspectedFont) => {
    if (busy) return
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

  const installFont = async (selected: InspectedFont) => {
    if (busy) return
    setBusy(true)
    setStatus("正在生成配置描述文件…")
    try {
      await openFontInstaller(selected.info, selected.data)
      setStatus("描述文件已交给系统，请在“设置”中确认安装")
      HapticFeedback.notificationSuccess()
      try {
        recordInstalledFont(selected.info)
      } catch (historyError) {
        setStatus("描述文件已交给系统，但历史记录保存失败")
        await Dialog.alert({
          title: "安装请求已发出",
          message: `系统已接收描述文件，但无法保存字体历史：${errorMessage(historyError)}`,
        })
      }
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
        toolbar={{
          cancellationAction: (
            <Button
              title=""
              systemImage="xmark"
              accessibilityLabel="关闭"
              action={() => dismiss()}
            />
          ),
          topBarTrailing: (
            <Button
              title=""
              systemImage="clock.arrow.circlepath"
              accessibilityLabel="字体历史记录"
              disabled={busy}
              action={() => void openFontHistory()}
            />
          ),
        }}
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
                title={selectedFonts.length ? "更换字体" : "导入字体"}
                systemImage="square.and.arrow.down"
                buttonStyle={isIOS26OrLater ? "glassProminent" : "borderedProminent"}
                disabled={busy}
                action={importFont}
              />
            </Card>

            {selectedFonts.map(selected => (
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
                  <FontDetailRow
                    label="字体家族"
                    value={selected.info.familyName}
                    trailing={(
                      <CopyFontValueButton
                        accessibilityLabel="复制字体家族名称"
                        action={() => void copyFontName(selected.info.familyName)}
                      />
                    )}
                  />
                  <FontDetailRow label="样式" value={selected.info.styleName} />
                  <FontDetailRow
                    label="PostScript"
                    value={selected.info.postScriptName}
                    trailing={(
                      <CopyFontValueButton
                        accessibilityLabel="复制字体名称"
                        action={() => void copyFontName(selected.info.postScriptName)}
                      />
                    )}
                  />
                  <FontDetailRow label="格式" value={`${selected.info.format} · ${formatFileSize(selected.info.fileSize)}`} />
                </VStack>

                <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
                  <Button
                    title="预览字体"
                    systemImage="character.book.closed"
                    buttonStyle={isIOS26OrLater ? "glass" : "bordered"}
                    disabled={busy}
                    action={() => void previewFont(selected)}
                  />
                  <Spacer />
                  <Button
                    title="安装到系统"
                    systemImage="checkmark.shield"
                    buttonStyle={isIOS26OrLater ? "glassProminent" : "borderedProminent"}
                    disabled={busy}
                    action={() => void installFont(selected)}
                  />
                </HStack>
              </Card>
            ))}

            {!selectedFonts.length ? (
              <Card spacing={8}>
                <Text font="headline" foregroundStyle={colors.primary}>支持的字体</Text>
                <Text font="subheadline" foregroundStyle={colors.secondary}>
                  支持一次导入多个 TrueType (.ttf) 与 OpenType (.otf) 字体，并逐个预览或安装。Apple 不允许通过字体描述文件安装 .ttc 或 .otc 字体集合。
                </Text>
              </Card>
            ) : null}

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
  let pendingSharedFontPath = sharedFontPath
  try {
    await removeExpiredStagedFonts()
    if (sharedFontPath) {
      const font = await inspectFontFile(sharedFontPath)
      try {
        await removeStagedFont(sharedFontPath)
        pendingSharedFontPath = null
      } catch (error) {
        console.warn("字体已识别，但暂时无法清理分享的字体副本", error)
      }
      await Navigation.present({ element: <SharedFontInstallView selectedFont={font} /> })
    } else {
      await Navigation.present({ element: <FontsInstallerView /> })
    }
  } catch (error) {
    await Dialog.alert({ title: "无法打开字体", message: errorMessage(error) })
  } finally {
    if (pendingSharedFontPath) {
      try {
        await removeStagedFont(pendingSharedFontPath)
      } catch (error) {
        console.warn("无法清理分享的字体副本", error)
      }
    }
    DocumentPicker.stopAcessingSecurityScopedResources()
    Script.exit()
  }
}

run()
