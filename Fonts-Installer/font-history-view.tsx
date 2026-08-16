import {
  Button,
  Device,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"
import {
  loadFontHistory,
  recordPickedFont,
  type FontHistoryEntry,
} from "./font-history"
import { presentInstalledFontPreview } from "./installed-font-preview"
import { colors, CustomGradientBackground } from "./theme"

const isIOS26OrLater = Number.parseInt(Device.systemVersion.split(".")[0] || "0", 10) >= 26

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function HistoryCard(props: { children: JSX.Element | JSX.Element[]; spacing?: number }) {
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

function HistoryDetailRow(props: { label: string; value: string }) {
  return (
    <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text
        font="subheadline"
        foregroundStyle={colors.secondary}
        frame={{ width: 82, alignment: "leading" }}
      >
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

function formatRecordedAt(timestamp: number): string {
  if (!timestamp) return "未知时间"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

export function FontHistoryView() {
  const dismiss = Navigation.useDismiss()
  const [entries, setEntries] = useState<FontHistoryEntry[]>(() => loadFontHistory())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(entries.length ? `共 ${entries.length} 条字体记录` : "暂无字体记录")

  const pickInstalledFont = async () => {
    if (busy) return
    setBusy(true)
    setStatus("正在打开系统字体选择器…")
    try {
      const fontName = await FontPicker.pickFont()
      if (!fontName) {
        setStatus(entries.length ? `共 ${entries.length} 条字体记录` : "未选择系统字体")
        return
      }
      const next = recordPickedFont(fontName)
      setEntries(next)
      setStatus(`已加入字体记录：${fontName}`)
      HapticFeedback.notificationSuccess()
    } catch (error) {
      setStatus("无法添加系统字体")
      await Dialog.alert({ title: "无法打开字体选择器", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const previewFont = async (entry: FontHistoryEntry) => {
    if (busy) return
    setBusy(true)
    setStatus(`正在预览：${entry.postScriptName}`)
    try {
      await presentInstalledFontPreview(entry.postScriptName, entry.supportsChinese === true)
      setStatus(`已选择：${entry.postScriptName}`)
    } catch (error) {
      setStatus("字体预览失败")
      await Dialog.alert({ title: "无法预览字体", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const copyFontName = async (fontName: string) => {
    try {
      await Pasteboard.setString(fontName)
      setStatus(`已复制字体名称：${fontName}`)
      HapticFeedback.notificationSuccess()
    } catch (error) {
      await Dialog.alert({ title: "无法复制字体名称", message: errorMessage(error) })
    }
  }

  return (
    <NavigationStack>
      <ZStack
        navigationTitle="字体历史"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => dismiss()} />,
          topBarTrailing: (
            <Button
              title=""
              systemImage="character.book.closed"
              accessibilityLabel="选择系统已安装字体"
              disabled={busy}
              action={() => void pickInstalledFont()}
            />
          ),
        }}
      >
        <CustomGradientBackground />
        <ScrollView>
          <VStack spacing={18} padding={{ top: 20, bottom: 36, leading: 18, trailing: 18 }}>
            {entries.length ? entries.map(entry => (
              <HistoryCard>
                <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Image systemName="textformat" font={28} foregroundStyle={colors.accent} />
                  <VStack
                    alignment="leading"
                    spacing={4}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <Text font="title3" fontWeight="semibold" foregroundStyle={colors.primary}>
                      {entry.fullName}
                    </Text>
                    <Text
                      font="caption"
                      foregroundStyle={colors.secondary}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {entry.postScriptName}
                    </Text>
                  </VStack>
                  <Text
                    font="caption"
                    foregroundStyle={entry.source === "installer" ? colors.success : colors.accent}
                    padding={{ horizontal: 10, vertical: 6 }}
                    background={{
                      style: entry.source === "installer"
                        ? { light: "rgba(15,138,104,0.12)", dark: "rgba(72,214,170,0.16)" }
                        : { light: "rgba(79,70,229,0.12)", dark: "rgba(129,140,248,0.18)" },
                      shape: { type: "capsule", style: "continuous" },
                    }}
                  >
                    {entry.source === "installer" ? "安装记录" : "系统选择"}
                  </Text>
                </HStack>

                <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  {entry.familyName ? <HistoryDetailRow label="字体家族" value={entry.familyName} /> : null}
                  {entry.styleName ? <HistoryDetailRow label="样式" value={entry.styleName} /> : null}
                  <HistoryDetailRow label="记录时间" value={formatRecordedAt(entry.recordedAt)} />
                  <HistoryDetailRow
                    label="中文预览"
                    value={entry.supportsChinese === true ? "支持" : "未确认，不显示中文样张"}
                  />
                </VStack>

                <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
                  <Button
                    title="预览字体"
                    systemImage="character.book.closed"
                    buttonStyle={isIOS26OrLater ? "glass" : "bordered"}
                    disabled={busy}
                    action={() => void previewFont(entry)}
                  />
                  <Spacer />
                  <Button
                    title="复制字体名"
                    systemImage="doc.on.doc"
                    buttonStyle={isIOS26OrLater ? "glassProminent" : "borderedProminent"}
                    disabled={busy}
                    action={() => void copyFontName(entry.postScriptName)}
                  />
                </HStack>
              </HistoryCard>
            )) : (
              <HistoryCard spacing={10}>
                <Image systemName="clock.arrow.circlepath" font={30} foregroundStyle={colors.accent} />
                <Text font="headline" foregroundStyle={colors.primary}>暂无字体记录</Text>
                <Text font="subheadline" foregroundStyle={colors.secondary}>
                  通过本脚本准备安装的字体会显示在这里。也可以点按右上角，从系统 FontPicker 选择一个已安装字体加入记录。
                </Text>
              </HistoryCard>
            )}

            <HistoryCard spacing={8}>
              <Text font="headline" foregroundStyle={colors.primary}>隐私说明</Text>
              <Text font="subheadline" foregroundStyle={colors.secondary}>
                历史记录仅保存在当前脚本的私有 Storage 中，只包含字体名称、来源、时间和字形支持信息，不保存原始字体文件或字体二进制数据。
              </Text>
            </HistoryCard>

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
