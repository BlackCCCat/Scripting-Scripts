import {
  Button,
  Form,
  Image,
  Navigation,
  NavigationStack,
  Slider,
  Section,
  Text,
  Toggle,
  HStack,
  VStack,
  useState,
} from "scripting"

import { CenterDestructiveRow } from "./common"
import { KeywordEditorPage } from "./KeywordEditorPage"
import type { Config } from "../types"
import {
  clearPicked,
  clampShowCount,
  DEFAULT_CONFIG,
  loadConfig,
  normalizeKeywords,
  resetConfig,
  saveConfig,
  safeRefreshWidget,
} from "../utils"

export function SettingsPage(props: {
  onChanged: () => void
}) {
  const cfg = loadConfig()
  const [autoDetect, setAutoDetect] = useState(cfg.autoDetectSMS)
  const [keywords, setKeywords] = useState<string[]>(cfg.keywords)
  const [showCount, setShowCount] = useState(cfg.widgetShowCount)
  const [showDate, setShowDate] = useState(cfg.showDate)

  const [showSavedToast, setShowSavedToast] = useState(false)
  const [toastMessage, setToastMessage] = useState("已保存")

  function presentToast(message: string) {
    setToastMessage(message)
    setShowSavedToast(true)
  }

  function persistSettings(next: Partial<Config>, options?: { silent?: boolean }) {
    const merged = {
      autoDetectSMS: next.autoDetectSMS ?? autoDetect,
      keywords: normalizeKeywords(next.keywords ?? keywords),
      widgetShowCount: clampShowCount(Number(next.widgetShowCount ?? showCount)),
      showDate: next.showDate ?? showDate,
    }

    saveConfig(merged)
    setAutoDetect(merged.autoDetectSMS)
    setKeywords(merged.keywords)
    setShowCount(merged.widgetShowCount)
    setShowDate(merged.showDate)
    if (!options?.silent) {
      presentToast("已保存")
    }
    safeRefreshWidget()
    props.onChanged()
  }

  async function openKeywordEditor() {
    await Navigation.present({
      element: (
        <KeywordEditorPage
          initialKeywords={keywords}
          onKeywordsChanged={(next) => {
            persistSettings({ keywords: next }, { silent: true })
          }}
        />
      ),
    })
    setKeywords(loadConfig().keywords)
    props.onChanged()
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toast={{
          isPresented: showSavedToast,
          onChanged: setShowSavedToast,
          message: toastMessage,
          duration: 1.5,
          position: "bottom",
        }}
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={() => persistSettings({})}
            />
          ),
        }}
      >
        <Section header={<Text>识别设置</Text>}>
          <Toggle title="启用自动短信识别" value={autoDetect} onChanged={setAutoDetect} />
          <Toggle title="显示短信时间" value={showDate} onChanged={setShowDate} />

          <Button buttonStyle="plain" action={() => void openKeywordEditor()}>
            <HStack frame={{ width: "100%" as any }} spacing={8}>
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>关键字</Text>
              <Text font="subheadline" opacity={0.48}>{keywords.length} 个</Text>
              <Image systemName="chevron.right" font="caption2" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>

          <VStack alignment="leading" spacing={8} padding={{ vertical: 6 }}>
            <HStack>
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>显示条数</Text>
              <Text font="subheadline" opacity={0.48}>{showCount}</Text>
            </HStack>
            <Slider
              min={1}
              max={50}
              step={1}
              value={showCount}
              onChanged={setShowCount}
              minValueLabel={<Text>1</Text>}
              maxValueLabel={<Text>50</Text>}
              label={<Text>显示条数</Text>}
            />
          </VStack>
        </Section>

        <Section header={<Text>数据管理</Text>}>
          <CenterDestructiveRow
            title="清除已取记录"
            onPress={async () => {
              const ok = await Dialog.confirm({
                title: "清除已取记录",
                message: "仅清除已处理状态，已导入短信会保留。",
                confirmLabel: "清除",
              })
              if (!ok) return
              clearPicked()
              safeRefreshWidget()
              props.onChanged()
              presentToast("已清除")
            }}
          />

          <CenterDestructiveRow
            title="重置全部数据"
            onPress={async () => {
              const ok = await Dialog.confirm({
                title: "重置全部数据",
                message: "这会清空已导入短信、已取记录和当前设置。",
                confirmLabel: "重置",
              })
              if (!ok) return
              resetConfig()
              setAutoDetect(DEFAULT_CONFIG.autoDetectSMS)
              setKeywords(DEFAULT_CONFIG.keywords)
              setShowCount(DEFAULT_CONFIG.widgetShowCount)
              setShowDate(DEFAULT_CONFIG.showDate)
              safeRefreshWidget()
              props.onChanged()
              presentToast("已重置")
            }}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
