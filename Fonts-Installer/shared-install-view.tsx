import {
  Button,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Path,
  Picker,
  ProgressView,
  Text,
  VStack,
  WebView,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { formatFileSize, type FontInfo } from "./font"
import { prepareFontForInstall } from "./font-instance"
import { CopyFontValueButton, FontDetailRow } from "./font-detail-row"
import { recordInstalledFont } from "./font-history"
import { openFontInstaller } from "./profile"
import { createFontPreviewHTML } from "./preview"
import { colors, CustomGradientBackground } from "./theme"

type PreviewState = "loading" | "ready" | { status: "error"; message: string }

const isIOS26OrLater = Number.parseInt(Device.systemVersion.split(".")[0] || "0", 10) >= 26

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SharedFontInstallView({ fonts, previewDirectory, fontFileName }: {
  fonts: FontInfo[]
  previewDirectory: string
  fontFileName: string
}) {
  const dismiss = Navigation.useDismiss()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const controller = useMemo(() => new WebViewController({ ephemeral: true }), [selectedIndex])
  const selectedFont = fonts[selectedIndex]
  const [previewState, setPreviewState] = useState<PreviewState>("loading")
  const [installing, setInstalling] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const previewReady = previewState === "ready"

  useEffect(() => {
    return () => controller.dispose()
  }, [controller])

  useEffect(() => {
    let active = true
    setPreviewState("loading")

    const loadPreview = async () => {
      try {
        const html = createFontPreviewHTML(selectedFont, null, {
          embedded: true,
          fontURL: fontFileName,
        })
        const htmlPath = Path.join(previewDirectory, `preview-${selectedIndex}.html`)
        await FileManager.writeAsString(htmlPath, html, "utf-8")
        const loaded = await controller.loadFile(htmlPath, previewDirectory)
        if (!loaded) throw new Error("无法载入字体预览。")
        if (active) setPreviewState("ready")
      } catch (error) {
        if (active) setPreviewState({ status: "error", message: errorMessage(error) })
      }
    }

    void loadPreview()
    return () => {
      active = false
    }
  }, [controller, selectedFont, selectedIndex, previewDirectory, fontFileName])

  const copyFontValue = async (value: string, label: string) => {
    try {
      await Pasteboard.setString(value)
      setCopyMessage(`已复制${label}`)
      HapticFeedback.notificationSuccess()
    } catch (error) {
      await Dialog.alert({ title: `无法复制${label}`, message: errorMessage(error) })
    }
  }

  const installFont = async () => {
    if (!previewReady || installing) return
    setInstalling(true)
    try {
      const data = await FileManager.readAsData(Path.join(previewDirectory, fontFileName))
      const font = await prepareFontForInstall({ info: selectedFont, data })
      await openFontInstaller(font.info, font.data)
      HapticFeedback.notificationSuccess()
      try {
        recordInstalledFont(font.info)
      } catch (historyError) {
        await Dialog.alert({
          title: "安装请求已发出",
          message: `系统已接收描述文件，但无法保存字体历史：${errorMessage(historyError)}`,
        })
      }
      dismiss()
    } catch (error) {
      await Dialog.alert({ title: "无法开始安装", message: errorMessage(error) })
      setInstalling(false)
    }
  }

  return (
    <NavigationStack>
      <ZStack
        navigationTitle="预览并安装"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss()} /> }}
      >
        <CustomGradientBackground />
        <VStack
          spacing={14}
          padding={{ top: 14, bottom: 18, leading: 16, trailing: 16 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          {fonts.length > 1 ? (
            <Picker
              title="选择字重"
              value={selectedIndex}
              disabled={installing}
              onChanged={(index: number) => {
                setPreviewState("loading")
                setCopyMessage(null)
                setSelectedIndex(index)
              }}
              pickerStyle="menu"
            >
              {fonts.map((font, index) => (
                <Text tag={index}>{font.styleName}</Text>
              ))}
            </Picker>
          ) : null}
          <VStack
            spacing={12}
            padding={14}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            {...(isIOS26OrLater
              ? { glassEffect: { type: "rect", cornerRadius: 20 } as any }
              : {
                  background: {
                    style: colors.nativeCard,
                    shape: { type: "rect", cornerRadius: 18 },
                  },
                })}
          >
            <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Image systemName="textformat" font={28} foregroundStyle={colors.accent} />
              <VStack
                alignment="leading"
                spacing={3}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                <Text font="headline" foregroundStyle={colors.primary}>{selectedFont.fullName}</Text>
                <Text font="caption" foregroundStyle={colors.secondary}>
                  {selectedFont.format} · {formatFileSize(selectedFont.fileSize)}
                </Text>
              </VStack>
            </HStack>

            <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <FontDetailRow
                label="字体家族"
                value={selectedFont.familyName}
                trailing={(
                  <CopyFontValueButton
                    accessibilityLabel="复制字体家族名称"
                    disabled={installing}
                    action={() => void copyFontValue(selectedFont.familyName, "字体家族名称")}
                  />
                )}
              />
              <FontDetailRow
                label="PostScript"
                value={selectedFont.postScriptName}
                trailing={(
                  <CopyFontValueButton
                    accessibilityLabel="复制 PostScript 名称"
                    disabled={installing}
                    action={() => void copyFontValue(selectedFont.postScriptName, "PostScript 名称")}
                  />
                )}
              />
            </VStack>

            {copyMessage ? (
              <Text font="footnote" foregroundStyle={colors.success}>{copyMessage}</Text>
            ) : null}
          </VStack>

          <ZStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            clipShape={{ type: "rect", cornerRadius: 22 }}
          >
            <WebView
              controller={controller}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            />
            {previewState === "loading" ? (
              <VStack spacing={10}>
                <ProgressView progressViewStyle="circular" />
                <Text font="footnote" foregroundStyle={colors.secondary}>正在生成字体预览…</Text>
              </VStack>
            ) : null}
            {typeof previewState === "object" ? (
              <VStack spacing={8} padding={20}>
                <Image systemName="exclamationmark.triangle" foregroundStyle={colors.warning} />
                <Text font="headline" foregroundStyle={colors.primary}>无法显示预览</Text>
                <Text font="footnote" foregroundStyle={colors.secondary}>{previewState.message}</Text>
              </VStack>
            ) : null}
          </ZStack>

          <Button
            title={installing ? "正在准备安装…" : "安装到系统"}
            systemImage="checkmark.shield"
            buttonStyle={isIOS26OrLater ? "glassProminent" : "borderedProminent"}
            disabled={!previewReady || installing}
            frame={{ maxWidth: "infinity" }}
            action={installFont}
          />
        </VStack>
      </ZStack>
    </NavigationStack>
  )
}
