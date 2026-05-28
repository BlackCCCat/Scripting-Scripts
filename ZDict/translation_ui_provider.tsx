import {
  Button,
  HStack,
  ScrollView,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
} from "scripting"

import {
  GlassPanel,
  ResultView,
  TokenSelectionPanel,
  copyText,
  hapticLight,
  hapticSuccess,
  isChineseQuery,
  logZDictError,
  logZDictEvent,
  lookupZdic,
  normalizeQuery,
  selectedTokenText,
  tokenizeWords,
  type DictToken,
  type ZdicResult,
} from "./shared"

declare const TranslationUIProvider: {
  readonly inputText: string | null
  readonly allowsReplacement: boolean
  present(node: any): void
  finish(translation?: string | null): void
  expandSheet?(): void
}

function ZDictTranslationView() {
  const sourceText = TranslationUIProvider.inputText ?? ""
  const tokens = useMemo(() => tokenizeWords(sourceText), [sourceText])
  const initialSelectedIds = useMemo(() => {
    if (tokens.length > 1) return []
    const trimmed = normalizeQuery(sourceText)
    if (isChineseQuery(trimmed) && Array.from(trimmed).length <= 12) {
      const exactToken = tokens.find((item) => item.text === trimmed)
      if (exactToken) return [exactToken.id]
      return tokens.filter((item) => isChineseQuery(item.text)).map((item) => item.id)
    }
    const firstChineseToken = tokens.find((token) => isChineseQuery(token.text))
    return firstChineseToken ? [firstChineseToken.id] : []
  }, [sourceText, tokens])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialSelectedIds)
  const [directQueryText, setDirectQueryText] = useState("")
  const selectedText = selectedTokenText(tokens, selectedIds)
  const queryText = normalizeQuery(selectedText || directQueryText)
  const canQuery = isChineseQuery(queryText)
  const [result, setResult] = useState<ZdicResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState("")
  const requestIdRef = useRef(0)

  async function runLookup(nextQuery = queryText) {
    const normalized = normalizeQuery(nextQuery)
    if (!isChineseQuery(normalized)) {
      logZDictEvent("系统翻译页拒绝查询", {
        query: normalized,
      })
      setResult(null)
      setErrorText(normalized ? "仅支持查询中文汉字或词语" : "")
      return
    }
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    const startedAt = Date.now()
    logZDictEvent("系统翻译页提交查询", {
      requestId,
      query: normalized,
    })
    setLoading(true)
    setErrorText("")
    try {
      TranslationUIProvider.expandSheet?.()
      const nextResult = await lookupZdic(normalized)
      if (requestId !== requestIdRef.current) {
        logZDictEvent("系统翻译页丢弃过期查询结果", {
          requestId,
          activeRequestId: requestIdRef.current,
          query: normalized,
        })
        return
      }
      setResult(nextResult)
      logZDictEvent("系统翻译页查询成功", {
        requestId,
        query: normalized,
        elapsedMs: Date.now() - startedAt,
        sectionCount: nextResult.sections.length,
      })
      hapticSuccess()
    } catch (error: any) {
      if (requestId !== requestIdRef.current) {
        logZDictEvent("系统翻译页丢弃过期查询错误", {
          requestId,
          activeRequestId: requestIdRef.current,
          query: normalized,
        })
        return
      }
      const message = String(error?.message ?? error ?? "查询失败")
      logZDictError("系统翻译页查询失败", {
        requestId,
        query: normalized,
        elapsedMs: Date.now() - startedAt,
        error: message,
      })
      setResult(null)
      setErrorText(message)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  function toggleToken(token: DictToken) {
    setDirectQueryText("")
    setSelectedIds((ids) => {
      const selected = !ids.includes(token.id)
      const nextIds = selected
        ? [...ids, token.id]
        : ids.filter((id) => id !== token.id)
      logZDictEvent("系统翻译页切换分词", {
        token: token.text,
        selected,
        selectedText: selectedTokenText(tokens, nextIds),
      })
      return nextIds
    })
  }

  function queryLinkedText(text: string) {
    const normalized = normalizeQuery(text)
    if (!isChineseQuery(normalized)) return
    logZDictEvent("系统翻译页点击结果联查", {
      query: normalized,
    })
    setSelectedIds([])
    setDirectQueryText(normalized)
    hapticLight()
    void runLookup(normalized)
  }

  useEffect(() => {
    logZDictEvent("打开系统翻译查询页", {
      inputLength: Array.from(sourceText).length,
      allowsReplacement: TranslationUIProvider.allowsReplacement,
      tokenCount: tokens.length,
      initialQuery: queryText,
    })
    if (canQuery && !result && !loading) {
      logZDictEvent("系统翻译页自动查询", {
        query: queryText,
      })
      void runLookup(queryText)
    }
  }, [])

  return (
    <VStack
      spacing={14}
      padding={16}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
    >
      {sourceText.trim() && tokens.length > 1 ? (
        <TokenSelectionPanel
          tokens={tokens}
          selectedIds={selectedIds}
          selectedText={selectedText}
          onToggle={toggleToken}
        />
      ) : !sourceText.trim() ? (
        <GlassPanel padding={14}>
          <Text foregroundStyle="secondaryLabel">没有收到系统传入的文本。</Text>
        </GlassPanel>
      ) : null}

      <GlassPanel padding={10}>
        <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          <Text
            font="subheadline"
            foregroundStyle={canQuery ? "label" : "secondaryLabel"}
            lineLimit={1}
            truncationMode="tail"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {queryText || "请选择要查询的中文"}
          </Text>
          <Button
            title="复制"
            systemImage="doc.on.doc"
            disabled={!queryText}
            action={() => {
              logZDictEvent("系统翻译页复制选词", {
                query: queryText,
              })
              hapticLight()
              void copyText(queryText)
            }}
          />
          <Button
            title="清空"
            systemImage="arrow.counterclockwise"
            disabled={!selectedIds.length && !directQueryText}
            action={() => {
              logZDictEvent("系统翻译页清空选词", {
                query: queryText,
              })
              hapticLight()
              setDirectQueryText("")
              setSelectedIds([])
              setResult(null)
              setErrorText("")
            }}
          />
          <Button
            title="查询"
            systemImage="magnifyingglass"
            disabled={!canQuery || loading}
            action={() => {
              logZDictEvent("系统翻译页触发查询按钮", {
                query: queryText,
              })
              hapticLight()
              void runLookup(queryText)
            }}
          />
        </HStack>
      </GlassPanel>

      {!canQuery && queryText ? (
        <GlassPanel padding={10}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            当前选择包含非中文字符，汉典查询已禁用。
          </Text>
        </GlassPanel>
      ) : null}

      <ScrollView axes="vertical" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <ResultView result={result} loading={loading} errorText={errorText} onQuery={queryLinkedText} />
      </ScrollView>
    </VStack>
  )
}

TranslationUIProvider.present(<ZDictTranslationView />)
