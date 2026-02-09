import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useState,
} from "scripting"

import { HistoryView } from "./HistoryView"
import { PatternHighlightPreview } from "./PatternHighlightPreview"
import { ResultBox } from "./ResultBox"
import { runLineMatch, type RegexOutputLine } from "../utils/regex"
import { addRegexHistory, type RegexHistoryItem } from "../utils/history"
import {
  loadState,
  saveState,
  type RegexTesterState,
} from "../utils/storage"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

export function HomeView() {
  const [init] = useState<RegexTesterState>(() => loadState())
  const [pattern, setPattern] = useState<string>(init.pattern)
  const [text, setText] = useState<string>(init.text)
  const [result, setResult] = useState<string>(init.result)
  const [resultLines, setResultLines] = useState<RegexOutputLine[]>(
    init.result ? String(init.result).split(/\r?\n/g).map((v) => ({ text: v, matched: false })) : []
  )
  const [matchedCount, setMatchedCount] = useState<number>(init.matchedCount)
  const [status, setStatus] = useState<string>(init.result ? "已载入上次结果" : "就绪")

  function setPending(nextPattern?: string) {
    const p = String(nextPattern ?? pattern).trim()
    setResult("")
    setResultLines([])
    setMatchedCount(0)
    setStatus(p ? "待匹配，点击输出框开始匹配" : "请输入正则表达式")
  }

  function clearPattern() {
    setPattern("")
    setPending("")
    setStatus("已清空正则表达式")
  }

  function clearText() {
    setText("")
    setPending()
    setStatus("已清空待匹配文本")
  }

  async function copyPatternFromPreview() {
    const value = pattern.trim()
    if (!value) return
    await Pasteboard.setString(pattern)
    setStatus("已复制正则表达式")
  }

  function runMatch() {
    const p = pattern.trim()
    if (!p) {
      setResult("")
      setResultLines([])
      setMatchedCount(0)
      setStatus("请输入正则表达式")
      return
    }
    try {
      const res = runLineMatch(pattern, text)
      setResult(res.output)
      setResultLines(res.lines)
      setMatchedCount(res.matchedCount)
      addRegexHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        pattern,
        text,
      })
      if (res.ignoredFlags.length) {
        setStatus(`完成，已忽略 flags: ${res.ignoredFlags.join(", ")}`)
      } else {
        setStatus("完成")
      }
    } catch (e: any) {
      setResult("")
      setResultLines([])
      setMatchedCount(0)
      setStatus(`正则错误：${String(e?.message ?? e)}`)
    }
  }

  async function openHistory() {
    const picked = await Navigation.present<RegexHistoryItem>({
      element: <HistoryView />,
    })
    if (!picked) return
    setPattern(String(picked.pattern ?? ""))
    setText(String(picked.text ?? ""))
    setPending(String(picked.pattern ?? ""))
    setStatus("已从历史记录恢复，点击输出框开始匹配")
  }

  useEffect(() => {
    const next: RegexTesterState = { pattern, text, result, matchedCount }
    saveState(next)
  }, [pattern, text, result, matchedCount])

  return (
    <NavigationStack>
      <VStack
        navigationTitle="Regex Tester"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: (
            <Button
              title=""
              systemImage="clock"
              action={withHaptic(openHistory)}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section
            header={(
              <HStack>
                <Text>正则表达式</Text>
                <Spacer />
                <Button
                  title=""
                  systemImage="trash.fill"
                  role="destructive"
                  disabled={!pattern.trim()}
                  foregroundStyle={pattern.trim() ? "#DC2626" : "secondaryLabel"}
                  action={withHaptic(clearPattern)}
                />
              </HStack>
            )}
          >
            <TextField
              title=""
              value={pattern}
              frame={{ height: 44, maxWidth: "infinity", alignment: "leading" }}
              prompt="输入正则表达式"
              autofocus
              onChanged={(v: string) => {
                setPattern(v)
                setPending(v)
              }}
            />
            <PatternHighlightPreview
              pattern={pattern}
              onPress={withHaptic(copyPatternFromPreview)}
            />
          </Section>

          <Section
            header={(
              <HStack>
                <Text>待匹配文本</Text>
                <Spacer />
                <Button
                  title=""
                  systemImage="trash.fill"
                  role="destructive"
                  disabled={!text.trim()}
                  foregroundStyle={text.trim() ? "#DC2626" : "secondaryLabel"}
                  action={withHaptic(clearText)}
                />
              </HStack>
            )}
          >
            <TextField
              title=""
              value={text}
              axis="vertical"
              frame={{ height: 150, maxWidth: "infinity", alignment: "topLeading" }}
              prompt="输入待匹配文本（支持多行）"
              onChanged={(v: string) => {
                setText(v)
                setPending()
              }}
            />
          </Section>

          <Section header={<Text>输出</Text>} footer={<Text>状态：{status} ｜ 命中：{matchedCount}</Text>}>
            <ResultBox text={result} lines={resultLines} onPress={runMatch} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
