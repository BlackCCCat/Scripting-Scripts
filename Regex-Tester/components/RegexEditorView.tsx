import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

import { PatternHighlightPreview } from "./PatternHighlightPreview"
import { RegexFlowView } from "./RegexFlowView"
import { ResultBox } from "./ResultBox"
import { createEmptyRegexItem, upsertRegexItem, type RegexItem } from "../utils/library"
import {
  runLineMatch,
  runLineReplace,
  validateRegexPattern,
  type MatchMode,
  type RegexOutputLine,
} from "../utils/regex"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function normalizeName(name: string) {
  const trimmed = String(name ?? "").trim()
  return trimmed || "Untitled"
}

function shouldPersistDraft(item: RegexItem) {
  return Boolean(
    String(item.pattern ?? "").trim() ||
    String(item.sampleText ?? "").trim() ||
    String(item.replacementTemplate ?? "").trim() ||
    normalizeName(item.name) !== "Untitled",
  )
}

export function RegexEditorView(props: { item?: RegexItem; isNew?: boolean; standalone?: boolean }) {
  const dismiss = Navigation.useDismiss()
  const [draftItem] = useState<RegexItem>(() => props.item ?? createEmptyRegexItem())
  const baseItem = props.item ?? draftItem
  const [name, setName] = useState(baseItem.name || "Untitled")
  const [pattern, setPattern] = useState(baseItem.pattern || "")
  const [matchMode, setMatchMode] = useState<MatchMode>(baseItem.matchMode || "search")
  const [sampleText, setSampleText] = useState(baseItem.sampleText || "")
  const [replacementTemplate, setReplacementTemplate] = useState(baseItem.replacementTemplate || "")
  const [onlyMatched, setOnlyMatched] = useState(false)
  const [resultLines, setResultLines] = useState<RegexOutputLine[]>([])
  const [matchedCount, setMatchedCount] = useState(0)
  const [replaceOutput, setReplaceOutput] = useState("")
  const [status, setStatus] = useState("点击测试结果开始匹配")
  const [flowClosingShown, setFlowClosingShown] = useState(false)
  const [flowToastShown, setFlowToastShown] = useState(false)
  const [flowToastMessage, setFlowToastMessage] = useState("流程图已关闭")
  const flowCloseTimerRef = useRef<any>(null)

  const validation = pattern.trim() ? validateRegexPattern(pattern) : { ok: true, ignoredFlags: [] as string[] }
  const totalLines = sampleText ? String(sampleText).replace(/\r\n/g, "\n").split("\n").length : 0
  const visibleLines = onlyMatched ? resultLines.filter((line) => line.matched) : resultLines
  const visibleText = visibleLines.map((line) => line.text).join("\n")

  function buildItem(): RegexItem {
      return {
      ...baseItem,
      name: normalizeName(name),
      pattern,
      matchMode,
      sampleText,
      replacementTemplate,
    }
  }

  function setPending(next = "点击测试结果开始匹配") {
    setResultLines([])
    setMatchedCount(0)
    setReplaceOutput("")
    setOnlyMatched(false)
    setStatus(next)
  }

  useEffect(() => {
    const next = buildItem()
    if (props.isNew && !shouldPersistDraft(next)) return
    upsertRegexItem(next)
  }, [name, pattern, matchMode, sampleText, replacementTemplate])

  useEffect(() => {
    const next = props.item ?? draftItem
    setName(next.name || "Untitled")
    setPattern(next.pattern || "")
    setMatchMode(next.matchMode || "search")
    setSampleText(next.sampleText || "")
    setReplacementTemplate(next.replacementTemplate || "")
    setOnlyMatched(false)
    setResultLines([])
    setMatchedCount(0)
    setReplaceOutput("")
    setStatus("点击测试结果开始匹配")
  }, [props.item?.id, draftItem.id])

  useEffect(() => {
    return () => {
      if (flowCloseTimerRef.current) {
        clearTimeout(flowCloseTimerRef.current)
        flowCloseTimerRef.current = null
      }
    }
  }, [])

  async function copyPattern() {
    if (!pattern.trim()) return
    await Pasteboard.setString(pattern)
    await Dialog.alert({ message: "已复制正则表达式" })
  }

  async function copyResult() {
    if (!visibleText.trim()) return
    await Pasteboard.setString(visibleText)
    await Dialog.alert({ message: onlyMatched ? "已复制命中结果" : "已复制测试结果" })
  }

  async function copyReplacement() {
    if (!replaceOutput.trim()) return
    await Pasteboard.setString(replaceOutput)
    await Dialog.alert({ message: "已复制替换结果" })
  }

  async function closeEditor() {
    dismiss()
  }

  async function openFlow() {
    if (!pattern.trim()) return
    await Navigation.present({
      element: (
        <RegexFlowView
          pattern={pattern}
          onDismissHint={() => {
            if (flowCloseTimerRef.current) {
              clearTimeout(flowCloseTimerRef.current)
              flowCloseTimerRef.current = null
            }
            setFlowToastShown(false)
            setFlowClosingShown(true)
            setFlowToastMessage("流程图已关闭")
            flowCloseTimerRef.current = setTimeout(() => {
              setFlowClosingShown(false)
              setFlowToastShown(true)
              flowCloseTimerRef.current = null
            }, 320)
          }}
        />
      ),
    })
  }

  function runPreview() {
    if (!pattern.trim()) {
      setPending("请输入正则表达式")
      return
    }
    if (!sampleText) {
      setPending("请输入示例文字")
      return
    }
    if (!validation.ok) {
      setPending(`正则错误：${validation.error}`)
      return
    }

    const matchResult = runLineMatch(pattern, sampleText, matchMode)
    setResultLines(matchResult.lines)
    setMatchedCount(matchResult.matchedCount)

    if (replacementTemplate) {
      const replaceResult = runLineReplace(pattern, sampleText, replacementTemplate, matchMode)
      setReplaceOutput(replaceResult.output)
    } else {
      setReplaceOutput("")
    }

    if (matchResult.ignoredFlags.length) {
      setStatus(`完成，已忽略 flags: ${matchResult.ignoredFlags.join(", ")}`)
    } else {
      setStatus("完成")
    }
  }

  const form = (
    <Form
      navigationTitle={normalizeName(name)}
      navigationBarTitleDisplayMode="inline"
      toast={{
        isPresented: flowToastShown,
        onChanged: setFlowToastShown,
        message: flowToastMessage,
        duration: 1.2,
        position: "bottom",
      }}
      toolbar={{
        topBarLeading: props.standalone ? (
          <Button
            title=""
            systemImage="xmark"
            action={withHaptic(closeEditor)}
          />
        ) : undefined,
        topBarTrailing: (
          <Button
            title=""
            systemImage="point.3.connected.trianglepath.dotted"
            disabled={!pattern.trim()}
            action={withHaptic(openFlow)}
          />
        ),
      }}
      formStyle="grouped"
    >
      <Section header={<Text>名字</Text>}>
        <TextField
          title=""
          value={name}
          prompt="输入名称"
          frame={{ height: 52, maxWidth: "infinity", alignment: "leading" }}
          onChanged={(value: string) => {
            setName(value)
          }}
        />
      </Section>

        <Section header={<Text>正则表达式</Text>}>
          <TextField
            title=""
            value={pattern}
            axis="vertical"
            prompt="输入正则表达式"
            frame={{ minHeight: 96, maxWidth: "infinity", alignment: "topLeading" }}
            onChanged={(value: string) => {
              setPattern(value)
              setPending(value.trim() ? "已修改表达式，点击测试结果重新匹配" : "点击测试结果开始匹配")
            }}
          />
          <PatternHighlightPreview pattern={pattern} onPress={withHaptic(copyPattern)} />
          <Picker
            title="匹配模式"
            value={matchMode}
            onChanged={(value: string) => {
              setMatchMode(value as MatchMode)
              setPending("已切换匹配模式，点击测试结果重新匹配")
            }}
            pickerStyle="segmented"
          >
            <Text tag="search">搜索</Text>
            <Text tag="full">整行匹配</Text>
          </Picker>
          <Text foregroundStyle="secondaryLabel" font="footnote">
            {matchMode === "search" ? "保留整行文本，仅高亮命中片段" : "整行必须完整符合表达式才算命中"}
          </Text>
          {!validation.ok ? (
            <Text foregroundStyle="#DC2626">正则错误：{validation.error}</Text>
          ) : null}
        </Section>

        <Section header={<Text>示例文字</Text>}>
          <TextField
            title=""
            value={sampleText}
            axis="vertical"
            prompt="输入示例文字或测试文本"
            frame={{ minHeight: 132, maxWidth: "infinity", alignment: "topLeading" }}
            onChanged={(value: string) => {
              setSampleText(value)
              setPending("已修改示例文字，点击测试结果重新匹配")
            }}
          />
        </Section>

        <Section header={<Text>替换模板</Text>}>
          <TextField
            title=""
            value={replacementTemplate}
            axis="vertical"
            prompt="例如：Price: $$$1.$2\\n"
            frame={{ minHeight: 92, maxWidth: "infinity", alignment: "topLeading" }}
            onChanged={(value: string) => {
              setReplacementTemplate(value)
              setPending("已修改替换模板，点击测试结果重新生成")
            }}
          />
        </Section>

        <Section
          header={(
            <HStack>
              <Text>结果</Text>
              <Spacer />
              <Button
                title=""
                systemImage={onlyMatched ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"}
                disabled={!matchedCount}
                action={withHaptic(() => setOnlyMatched((v) => !v))}
              />
              <Button
                title=""
                systemImage="doc.on.doc"
                disabled={!visibleText.trim()}
                action={withHaptic(copyResult)}
              />
            </HStack>
          )}
          footer={(
            <Text>
              状态：{status} ｜ 共 {totalLines} 行 ｜ 命中 {matchedCount} 行
              {onlyMatched ? " ｜ 仅显示命中" : ""}
              {validation.ok && validation.ignoredFlags.length ? ` ｜ 已忽略 flags: ${validation.ignoredFlags.join(", ")}` : ""}
            </Text>
          )}
        >
          <ResultBox
            text={visibleText}
            lines={visibleLines}
            placeholder={matchedCount === 0 && visibleText ? "没有命中" : "点击开始匹配"}
            onPress={runPreview}
          />
          {replacementTemplate.trim() ? (
            <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
              <HStack padding={{ top: 8, bottom: 4 }}>
                <Text font="footnote" foregroundStyle="secondaryLabel">替换预览</Text>
                <Spacer />
                <Button
                  title=""
                  systemImage="doc.on.doc"
                  disabled={!replaceOutput.trim()}
                  action={withHaptic(copyReplacement)}
                />
              </HStack>
              <ResultBox
                text={replaceOutput}
                placeholder="点击开始匹配并生成替换结果"
                onPress={runPreview}
              />
            </VStack>
          ) : null}
        </Section>
    </Form>
  )

  const content = (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}>
      {form}
      {flowClosingShown ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
          background="rgba(0,0,0,0.08)"
        >
          <VStack
            spacing={12}
            padding={{ top: 18, bottom: 18, leading: 20, trailing: 20 }}
            background={{
              style: "secondarySystemBackground",
              shape: { type: "rect", cornerRadius: 20 },
            }}
          >
            <ProgressView progressViewStyle="circular" />
            <Text foregroundStyle="secondaryLabel">正在关闭流程图...</Text>
          </VStack>
        </VStack>
      ) : null}
    </ZStack>
  )

  return props.standalone ? (
    <NavigationStack>{content}</NavigationStack>
  ) : content
}
