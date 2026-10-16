import {
  Button, HStack, Image, List, Navigation, NavigationStack, Section,
  Spacer, Text, VStack, useEffect, useState,
} from "scripting"
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import {
  deleteTranslationHistory, listTranslationHistory,
  type TranslationHistoryRecord,
} from "../utils/translation_history"
import { EngineIcon } from "./EngineIcon"

function languageName(code: string) {
  return code === "auto"
    ? AUTO_LANGUAGE.label
    : LANGUAGE_OPTIONS.find((item) => item.code === code)?.label ?? code
}

function HistoryDetailView({ record }: { record: TranslationHistoryRecord }) {
  const dismiss = Navigation.useDismiss()
  const [toastMessage, setToastMessage] = useState("")

  async function copyText(text: string) {
    try {
      await Pasteboard.setString(text)
      setToastMessage("已复制")
    } catch {
      setToastMessage("复制失败")
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="历史详情"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{ topBarLeading: <Button title="关闭" action={() => dismiss()} /> }}
        toast={{
          message: toastMessage,
          isPresented: !!toastMessage,
          onChanged: (shown) => { if (!shown) setToastMessage("") },
        }}
      >
        <Section header={
          <HStack spacing={8}>
            <Text lineLimit={1}>原文 · {languageName(record.sourceLanguageCode)} → {languageName(record.targetLanguageCode)}</Text>
            <Spacer />
            <Button title="复制" systemImage="doc.on.doc" buttonStyle="borderless" action={() => {
              void copyText(record.sourceText)
            }} />
          </HStack>
        }>
          <Text textSelection={true} fixedSize={{ horizontal: false, vertical: true }}>
            {record.sourceText}
          </Text>
        </Section>
        {record.results.map((result) => (
          <Section
            key={result.engineId}
            header={
              <HStack spacing={8}>
                <EngineIcon kind={result.kind} mode={result.mode} size={18} />
                <Text>{result.engineName}</Text>
                <Spacer />
                <Button
                  title="复制"
                  systemImage="doc.on.doc"
                  buttonStyle="borderless"
                  disabled={!result.translatedText.trim() || !!result.errorText}
                  action={() => { void copyText(result.translatedText) }}
                />
              </HStack>
            }
          >
            <Text
              textSelection={true}
              onTapGesture={result.translatedText.trim() && !result.errorText
                ? () => { void copyText(result.translatedText) }
                : undefined}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              contentShape="rect"
              fixedSize={{ horizontal: false, vertical: true }}
              foregroundStyle={result.errorText ? "systemRed" : undefined}
            >
              {result.translatedText || result.errorText || "暂无译文"}
            </Text>
          </Section>
        ))}
      </List>
    </NavigationStack>
  )
}

export function TranslationHistoryView({ origin }: { origin?: "live" } = {}) {
  const dismiss = Navigation.useDismiss()
  const [records, setRecords] = useState<TranslationHistoryRecord[]>([])
  const [error, setError] = useState("")

  async function refresh() {
    try {
      setRecords(await listTranslationHistory(origin))
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(record: TranslationHistoryRecord) {
    const confirmed = await Dialog.confirm({
      title: "删除历史记录",
      message: "确定删除这条翻译记录吗？",
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!confirmed) return
    try {
      await deleteTranslationHistory(record.id)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={origin === "live" ? "浮窗翻译历史" : "翻译历史"}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{ topBarLeading: <Button title="关闭" action={() => dismiss()} /> }}
      >
        {error ? <Section><Text foregroundStyle="systemRed">{error}</Text></Section> : null}
        {records.length === 0 && !error ? (
          <Section><Text foregroundStyle="secondaryLabel">暂无翻译历史</Text></Section>
        ) : (
          <Section>
            {records.map((record) => (
              <Button
                key={record.id}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title="删除"
                      systemImage="trash"
                      tint="systemRed"
                      action={() => { void remove(record) }}
                    />,
                  ],
                }}
                action={() => {
                  void Navigation.present({ element: <HistoryDetailView record={record} /> })
                }}
              >
                <HStack spacing={10}>
                  <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                    <Text foregroundStyle="label" lineLimit={2} multilineTextAlignment="leading">{record.sourceText}</Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {new Date(record.createdAt).toLocaleString()} · {record.results.map((item) => item.engineName).join("、")}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
                </HStack>
              </Button>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
