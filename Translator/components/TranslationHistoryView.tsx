import {
  Button, HStack, Image, List, Navigation, NavigationStack, Section,
  Spacer, Text, VStack, useEffect, useState,
} from "scripting"
import { LANGUAGE_OPTIONS } from "../constants"
import {
  deleteTranslationHistory, listTranslationHistory,
  type TranslationHistoryRecord,
} from "../utils/translation_history"
import { EngineIcon } from "./EngineIcon"

function languageName(code: string) {
  return code === "auto"
    ? "自动检测"
    : LANGUAGE_OPTIONS.find((item) => item.code === code)?.label ?? code
}

function HistoryDetailView({ record }: { record: TranslationHistoryRecord }) {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <List
        navigationTitle="历史详情"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{ topBarLeading: <Button title="关闭" action={() => dismiss()} /> }}
      >
        <Section header={<Text>原文 · {languageName(record.sourceLanguageCode)} → {languageName(record.targetLanguageCode)}</Text>}>
          <Text selectionDisabled={false} fixedSize={{ horizontal: false, vertical: true }}>
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
              </HStack>
            }
          >
            <Text
              selectionDisabled={false}
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

export function TranslationHistoryView() {
  const dismiss = Navigation.useDismiss()
  const [records, setRecords] = useState<TranslationHistoryRecord[]>([])
  const [error, setError] = useState("")

  async function refresh() {
    try {
      setRecords(await listTranslationHistory())
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
        navigationTitle="翻译历史"
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
                  <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
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
