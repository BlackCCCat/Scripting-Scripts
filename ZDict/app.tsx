import {
  Button,
  HStack,
  Navigation,
  Script,
  ScrollView,
  Text,
  TextField,
  VStack,
  ZStack,
  useRef,
  useState,
} from "scripting"

import {
  GlassPanel,
  ResultView,
  hapticLight,
  hapticSuccess,
  isChineseQuery,
  logZDictError,
  logZDictEvent,
  lookupZdic,
  normalizeQuery,
  type ZdicResult,
} from "./shared"

function SearchInputPanel(props: {
  value: string
  canQuery: boolean
  loading: boolean
  hasResult: boolean
  hasError: boolean
  onChanged: (value: string) => void
  onClear: () => void
  onQuery: () => void
}) {
  return (
    <GlassPanel padding={10}>
      <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          <ZStack
            frame={{ maxWidth: "infinity", height: 40, alignment: "leading" as any }}
            background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 10 } } as any}
            glassEffect={{ type: "rect", cornerRadius: 10 } as any}
            clipShape={{ type: "rect", cornerRadius: 10 } as any}
          >
            <TextField
              title=""
              value={props.value}
              prompt="输入汉字、词语或成语"
              onChanged={props.onChanged}
              submitLabel="search"
              onSubmit={() => {
                if (!props.canQuery || props.loading) return
                props.onQuery()
              }}
              padding={{ leading: 12, trailing: 12 }}
              frame={{ maxWidth: "infinity", height: 40, alignment: "leading" as any }}
            />
          </ZStack>
          <Button
            title="清空"
            systemImage="xmark.circle"
            disabled={!props.value && !props.hasResult && !props.hasError}
            action={props.onClear}
          />
          <Button
            title="查询"
            systemImage="magnifyingglass"
            disabled={!props.canQuery || props.loading}
            action={props.onQuery}
          />
        </HStack>
        {!props.canQuery && normalizeQuery(props.value) ? (
          <Text font="caption" foregroundStyle="secondaryLabel">
            仅支持查询中文汉字、词语或成语。
          </Text>
        ) : null}
      </VStack>
    </GlassPanel>
  )
}

function ZDictScriptView() {
  const [inputText, setInputText] = useState("")
  const queryText = normalizeQuery(inputText)
  const canQuery = isChineseQuery(queryText)
  const [result, setResult] = useState<ZdicResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState("")
  const requestIdRef = useRef(0)

  async function runLookup(nextQuery = queryText) {
    const normalized = normalizeQuery(nextQuery)
    if (!isChineseQuery(normalized)) {
      logZDictEvent("脚本页拒绝查询", {
        query: normalized,
      })
      setResult(null)
      setErrorText(normalized ? "仅支持查询中文汉字或词语" : "")
      return
    }
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    const startedAt = Date.now()
    logZDictEvent("脚本页提交查询", {
      requestId,
      query: normalized,
    })
    setLoading(true)
    setErrorText("")
    try {
      const nextResult = await lookupZdic(normalized)
      if (requestId !== requestIdRef.current) {
        logZDictEvent("脚本页丢弃过期查询结果", {
          requestId,
          activeRequestId: requestIdRef.current,
          query: normalized,
        })
        return
      }
      setResult(nextResult)
      logZDictEvent("脚本页查询成功", {
        requestId,
        query: normalized,
        elapsedMs: Date.now() - startedAt,
        sectionCount: nextResult.sections.length,
      })
      hapticSuccess()
    } catch (error: any) {
      if (requestId !== requestIdRef.current) {
        logZDictEvent("脚本页丢弃过期查询错误", {
          requestId,
          activeRequestId: requestIdRef.current,
          query: normalized,
        })
        return
      }
      const message = String(error?.message ?? error ?? "查询失败")
      logZDictError("脚本页查询失败", {
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

  function queryLinkedText(text: string) {
    const normalized = normalizeQuery(text)
    if (!isChineseQuery(normalized)) return
    logZDictEvent("脚本页点击结果联查", {
      query: normalized,
    })
    setInputText(normalized)
    hapticLight()
    void runLookup(normalized)
  }

  function clearQuery() {
    logZDictEvent("脚本页清空查询")
    hapticLight()
    setInputText("")
    setResult(null)
    setErrorText("")
  }

  function submitQuery() {
    logZDictEvent("脚本页触发查询", {
      query: queryText,
    })
    hapticLight()
    void runLookup(queryText)
  }

  return (
    <VStack
      spacing={14}
      padding={16}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
    >
      <ScrollView axes="vertical" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <ResultView
          result={result}
          loading={loading}
          errorText={errorText}
          emptyText="请输入中文词条后查询。"
          onQuery={queryLinkedText}
        />
      </ScrollView>
      <SearchInputPanel
        value={inputText}
        canQuery={canQuery}
        loading={loading}
        hasResult={Boolean(result)}
        hasError={Boolean(errorText)}
        onChanged={setInputText}
        onClear={clearQuery}
        onQuery={submitQuery}
      />
    </VStack>
  )
}

export async function run() {
  try {
    logZDictEvent("打开脚本查询页")
    await Navigation.present({
      element: <ZDictScriptView />,
    })
  } finally {
    logZDictEvent("关闭脚本查询页")
    Script.exit()
  }
}
