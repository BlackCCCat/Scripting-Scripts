import {
  Button,
  ForEach,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useState,
} from "scripting"

import {
  type SymbolSettings,
  PRESET_SYMBOLS,
  normalizeSymbolSettings,
} from "../utils/symbol_settings"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function uniqueCharsFromInput(value: string) {
  return Array.from(new Set(Array.from(String(value ?? "").trim()).filter(Boolean)))
}

function SymbolToggleRow(props: {
  value: string
  enabled: boolean
  onChanged: (next: boolean) => void
}) {
  return (
    <Toggle
      value={props.enabled}
      onChanged={props.onChanged}
      toggleStyle="switch"
    >
      <HStack
        frame={{ width: "100%" as any }}
        spacing={12}
        alignment="center"
        padding={{ top: 8, bottom: 8 }}
      >
        <Text font="title3" frame={{ width: 28, alignment: "center" as any }}>
          {props.value}
        </Text>
        <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            符号 {props.value}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            开启后会加入密码生成字符池
          </Text>
        </VStack>
        <Spacer />
      </HStack>
    </Toggle>
  )
}

export function SymbolSettingsView(props: { initial: SymbolSettings }) {
  const dismiss = Navigation.useDismiss()
  const initial = normalizeSymbolSettings(props.initial)
  const [enabledSymbols, setEnabledSymbols] = useState<string[]>(initial.enabledSymbols)
  const [customSymbols, setCustomSymbols] = useState<string[]>(initial.customSymbols)
  const [draft, setDraft] = useState("")
  const [statusText, setStatusText] = useState("可选符号会在开启特殊符号时参与生成")

  function availableSymbols() {
    return new Set([...PRESET_SYMBOLS, ...customSymbols])
  }

  function canDisable(value: string) {
    return enabledSymbols.includes(value) && enabledSymbols.length <= 1
  }

  function toggleSymbol(value: string, next: boolean) {
    if (!next && canDisable(value)) {
      setStatusText("至少保留一个可用特殊符号")
      return
    }
    const current = new Set(enabledSymbols)
    if (next) current.add(value)
    else current.delete(value)
    const normalized = Array.from(current).filter((item) => availableSymbols().has(item))
    setEnabledSymbols(normalized)
    setStatusText(next ? `已启用符号 ${value}` : `已停用符号 ${value}`)
  }

  async function addCustomSymbols() {
    const items = uniqueCharsFromInput(draft)
    if (!items.length) {
      setStatusText("请输入至少一个特殊符号")
      return
    }
    const all = availableSymbols()
    const existing = items.filter((item) => all.has(item))
    const fresh = items.filter((item) => !all.has(item))
    if (!fresh.length) {
      await Dialog.alert({
        title: "符号已存在",
        message: existing.length ? `以下符号已存在：${existing.join(" ")}` : "添加的符号已存在于列表中",
      })
      return
    }
    setCustomSymbols((current) => [...current, ...fresh])
    setEnabledSymbols((current) => Array.from(new Set([...current, ...fresh])))
    setDraft("")
    setStatusText(`已新增符号：${fresh.join(" ")}`)
  }

  function removeCustomSymbol(value: string) {
    if (enabledSymbols.includes(value) && enabledSymbols.length <= 1) {
      setStatusText("至少保留一个可用特殊符号")
      return
    }
    setCustomSymbols((current) => current.filter((item) => item !== value))
    setEnabledSymbols((current) => current.filter((item) => item !== value))
    setStatusText(`已删除自定义符号 ${value}`)
  }

  function deleteCustomSymbolsAt(indices: number[]) {
    const targets = indices
      .map((index) => customSymbols[index])
      .filter(Boolean) as string[]
    for (const value of targets) removeCustomSymbol(value)
  }

  function saveAndClose() {
    dismiss(normalizeSymbolSettings({
      enabledSymbols,
      customSymbols,
    }))
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="特殊符号"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={withHaptic(saveAndClose)}
            />
          ),
        }}
      >
        <Section header={<Text>预设符号</Text>} footer={<Text>{statusText}</Text>}>
          {PRESET_SYMBOLS.map((symbol) => (
            <SymbolToggleRow
              key={symbol}
              value={symbol}
              enabled={enabledSymbols.includes(symbol)}
              onChanged={(next) => toggleSymbol(symbol, next)}
            />
          ))}
        </Section>

        <Section header={<Text>新增符号</Text>}>
          <TextField
            title="手动新增"
            value={draft}
            onChanged={setDraft}
            prompt="输入一个或多个符号"
          />
          <Button title="添加到列表" action={withHaptic(addCustomSymbols)} />
        </Section>

        <Section header={<Text>自定义符号</Text>} footer={<Text>左滑可删除自定义符号</Text>}>
          {customSymbols.length ? (
            <ForEach
              count={customSymbols.length}
              onDelete={deleteCustomSymbolsAt}
              itemBuilder={(index) => {
                const symbol = customSymbols[index]
                return (
                  <SymbolToggleRow
                    key={symbol}
                    value={symbol}
                    enabled={enabledSymbols.includes(symbol)}
                    onChanged={(next) => toggleSymbol(symbol, next)}
                  />
                )
              }}
            />
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无自定义符号</Text>
          )}
        </Section>
      </Form>
    </NavigationStack>
  )
}
