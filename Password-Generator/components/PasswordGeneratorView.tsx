import {
  Button,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  ScrollView,
  Slider,
  Spacer,
  Text,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"

import {
  addPasswordHistory,
  formatDateTime,
  loadPasswordHistory,
  type PasswordHistoryItem,
} from "../utils/history"
import { PasswordHistoryView } from "./PasswordHistoryView"
import { SymbolSettingsView } from "./SymbolSettingsView"
import {
  buildPasswordStyledText,
  evaluatePasswordStrength,
  generatePassword,
  type PasswordOptions,
  summarizePasswordOptions,
} from "../utils/password"
import {
  loadSymbolSettings,
  saveSymbolSettings,
  symbolPool,
  type SymbolSettings,
} from "../utils/symbol_settings"

type ViewMode = "app" | "keyboard"

function createDefaultOptions(symbolSettings: SymbolSettings): PasswordOptions {
  return {
    length: 16,
    includeLetters: true,
    includeNumbers: true,
    includeSymbols: true,
    symbols: symbolPool(symbolSettings),
  }
}

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function enabledCount(options: PasswordOptions) {
  return [
    options.includeLetters,
    options.includeNumbers,
    options.includeSymbols,
  ].filter(Boolean).length
}

function optionSummary(options: PasswordOptions) {
  return summarizePasswordOptions(options)
}

function Card(props: {
  children: any
  padding?: {
    top?: number
    bottom?: number
    leading?: number
    trailing?: number
  } | true
}) {
  return (
    <VStack
      spacing={10}
      padding={props.padding ?? { top: 14, bottom: 14, leading: 14, trailing: 14 }}
      background={{
        style: "secondarySystemBackground",
        shape: { type: "rect", cornerRadius: 16 },
      }}
    >
      {props.children}
    </VStack>
  )
}

function ActionButton(props: {
  title: string
  icon: string
  color?: any
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  const tint: any = props.disabled ? "secondaryLabel" : (props.color ?? "systemBlue")
  return (
    <Button
      buttonStyle="bordered"
      tint={tint}
      disabled={props.disabled}
      action={withHaptic(props.onPress)}
      frame={{ maxWidth: "infinity", minHeight: 42 }}
    >
      <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
        <Image systemName={props.icon} font="subheadline" foregroundStyle={tint} />
        <Text font="subheadline" foregroundStyle={tint}>
          {props.title}
        </Text>
      </HStack>
    </Button>
  )
}

function KeyboardTopIconButton(props: {
  icon: string
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      disabled={props.disabled}
      action={withHaptic(props.onPress)}
    >
      <Image
        systemName={props.icon}
        font="subheadline"
        frame={{ width: 44, alignment: "center" as any }}
      />
    </Button>
  )
}

function ToggleRow(props: {
  title: string
  subtitle: string
  icon: string
  value: boolean
  disabled?: boolean
  onChanged: (value: boolean) => void
}) {
  return (
    <Toggle
      value={props.value}
      onChanged={props.onChanged}
      toggleStyle="switch"
      disabled={props.disabled}
    >
      <HStack frame={{ width: "100%" as any }} spacing={12} alignment="center">
        <Image
          systemName={props.icon}
          font="headline"
          foregroundStyle={props.disabled ? "secondaryLabel" : "systemBlue"}
          frame={{ width: 24, alignment: "center" as any }}
        />
        <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={3}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {props.title}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {props.subtitle}
          </Text>
        </VStack>
      </HStack>
    </Toggle>
  )
}

export function PasswordGeneratorView(props: { mode: ViewMode }) {
  const [symbolSettings, setSymbolSettings] = useState<SymbolSettings>(() => loadSymbolSettings())
  const [options, setOptions] = useState<PasswordOptions>(() => createDefaultOptions(loadSymbolSettings()))
  const [password, setPassword] = useState(() => generatePassword(createDefaultOptions(loadSymbolSettings())))
  const [lastFilledLength, setLastFilledLength] = useState(0)
  const [showKeyboardHistory, setShowKeyboardHistory] = useState(false)
  const [keyboardHistoryItems, setKeyboardHistoryItems] = useState<PasswordHistoryItem[]>([])
  const [statusText, setStatusText] = useState(
    props.mode === "keyboard"
      ? "点按密码即可复制，填入也会写入历史"
      : "拖动长度或切换字符类型会立即生成新密码"
  )

  useEffect(() => {
    if (props.mode !== "keyboard") return
    try { CustomKeyboard.setToolbarVisible(false) } catch {}
    try { CustomKeyboard.setHasDictationKey(false) } catch {}
  }, [props.mode])

  function regenerate(nextOptions = options) {
    setPassword(generatePassword(nextOptions))
  }

  function updateOptions(nextOptions: PasswordOptions, message?: string) {
    setOptions(nextOptions)
    setPassword(generatePassword(nextOptions))
    if (message) setStatusText(message)
  }

  function updateLength(value: number) {
    const nextOptions = {
      ...options,
      length: Math.round(value),
    }
    updateOptions(nextOptions, `已生成 ${nextOptions.length} 位密码`)
  }

  function updateToggle(key: "includeLetters" | "includeNumbers" | "includeSymbols", value: boolean) {
    if (!value && enabledCount(options) <= 1) {
      setStatusText("至少保留一种字符类型")
      return
    }
    const nextOptions = {
      ...options,
      [key]: value,
    }
    updateOptions(nextOptions, `已切换为：${summarizePasswordOptions(nextOptions)}`)
  }

  async function copyPassword(target: string) {
    await Pasteboard.setString(target)
    addPasswordHistory({
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      copiedAt: Date.now(),
      password: target,
      options: { ...options, length: target.length },
    })
    setStatusText("已复制当前密码，并写入历史")
  }

  async function openHistory() {
    if (props.mode === "keyboard") {
      setKeyboardHistoryItems(loadPasswordHistory())
      setShowKeyboardHistory(true)
      return
    }
    await Navigation.present({
      element: <PasswordHistoryView />,
    })
  }

  async function openSymbolSettings() {
    const next = await Navigation.present({
      element: <SymbolSettingsView initial={symbolSettings} />,
    })
    if (!next) return
    const safeNext = next as SymbolSettings
    saveSymbolSettings(safeNext)
    setSymbolSettings(safeNext)
    const nextOptions = {
      ...options,
      symbols: symbolPool(safeNext),
    }
    updateOptions(nextOptions, "已更新特殊符号列表")
  }

  async function fillPassword(target: string, sourceOptions?: PasswordOptions, statusMessage = "已填入到当前光标处，并写入历史") {
    if (props.mode !== "keyboard") return
    try {
      addPasswordHistory({
        id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        copiedAt: Date.now(),
        password: target,
        options: { ...(sourceOptions ?? options), length: target.length },
      })
      CustomKeyboard.insertText(target)
      try { CustomKeyboard.playInputClick() } catch {}
      setLastFilledLength(target.length)
      setStatusText(statusMessage)
    } catch (error: any) {
      setStatusText(`填入失败：${String(error?.message ?? error)}`)
    }
  }

  async function insertPassword() {
    await fillPassword(password)
  }

  async function undoLastFill() {
    if (props.mode !== "keyboard") return
    if (!lastFilledLength) {
      setStatusText("暂无可撤销的填入")
      return
    }
    try {
      for (let i = 0; i < lastFilledLength; i += 1) {
        CustomKeyboard.deleteBackward()
      }
      setLastFilledLength(0)
      setStatusText("已撤销上一次填入")
    } catch (error: any) {
      setStatusText(`撤销失败：${String(error?.message ?? error)}`)
    }
  }

  async function switchKeyboard() {
    if (props.mode !== "keyboard") return
    try {
      CustomKeyboard.nextKeyboard()
    } catch (error: any) {
      setStatusText(`切换失败：${String(error?.message ?? error)}`)
    }
  }

  const strength = evaluatePasswordStrength(password, options)
  const onlyOneEnabled = enabledCount(options) === 1
  const topPadding = props.mode === "keyboard" ? 6 : 12

  async function fillFromHistoryItem(item: PasswordHistoryItem) {
    await fillPassword(item.password, item.options, "已从历史记录填入，并写入历史")
    setShowKeyboardHistory(false)
    setKeyboardHistoryItems(loadPasswordHistory())
  }

  const keyboardTopBar = (
    <HStack frame={{ width: "100%" as any }}>
      <KeyboardTopIconButton icon="globe" onPress={switchKeyboard} />
      <Spacer />
      <ZStack frame={{ width: 44, alignment: "center" as any }}>
        <VStack opacity={showKeyboardHistory ? 0 : 1}>
          <KeyboardTopIconButton
            icon="clock.arrow.circlepath"
            disabled={showKeyboardHistory}
            onPress={openHistory}
          />
        </VStack>
        <VStack opacity={showKeyboardHistory ? 1 : 0}>
          <KeyboardTopIconButton
            icon="chevron.left"
            disabled={!showKeyboardHistory}
            onPress={() => setShowKeyboardHistory(false)}
          />
        </VStack>
      </ZStack>
    </HStack>
  )

  const keyboardHistoryContent = keyboardHistoryItems.length ? (
    keyboardHistoryItems.map((item) => {
      const itemStrength = evaluatePasswordStrength(item.password, item.options)
      return (
        <Button
          key={item.id}
          buttonStyle="plain"
          action={withHaptic(() => fillFromHistoryItem(item))}
          frame={{ maxWidth: "infinity" }}
        >
          <VStack
            spacing={8}
            padding={{ top: 10, bottom: 10, leading: 10, trailing: 10 }}
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            background={{
              style: "secondarySystemBackground",
              shape: { type: "rect", cornerRadius: 12 },
            }}
          >
            <HStack frame={{ width: "100%" as any }}>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {formatDateTime(item.copiedAt)}
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle="secondaryLabel">
                点击填入
              </Text>
            </HStack>
            <Text
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              styledText={buildPasswordStyledText(item.password)}
              lineLimit={1}
            />
            <HStack frame={{ width: "100%" as any }}>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {summarizePasswordOptions(item.options)}
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle={itemStrength.color}>
                {itemStrength.score} 分
              </Text>
            </HStack>
          </VStack>
        </Button>
      )
    })
  ) : (
    <Card>
      <Text font="caption" foregroundStyle="secondaryLabel">
        暂无历史记录
      </Text>
    </Card>
  )

  const firstCard = (
    <Card>
      <HStack frame={{ width: "100%" as any }}>
        <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            随机密码生成
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {optionSummary(options)}
          </Text>
        </VStack>
        <VStack spacing={4} frame={{ width: 118, alignment: "trailing" as any }}>
          <Text font="caption" foregroundStyle={strength.color} frame={{ maxWidth: "infinity", alignment: "trailing" as any }}>
            {strength.score}/100
          </Text>
          <ProgressView
            value={strength.score / 100}
            total={1}
            progressViewStyle="linear"
            tint={strength.color}
            foregroundStyle={strength.color}
            frame={{ maxWidth: "infinity" }}
          />
        </VStack>
      </HStack>

      <Button
        buttonStyle="plain"
        action={withHaptic(() => copyPassword(password))}
        frame={{ maxWidth: "infinity" }}
      >
        <VStack
          spacing={8}
          frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
          padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
          background={{
            style: "tertiarySystemBackground",
            shape: { type: "rect", cornerRadius: 14 },
          }}
        >
          <HStack frame={{ width: "100%" as any }}>
            <Text font="caption" foregroundStyle="secondaryLabel">
              当前密码
            </Text>
            <Spacer />
            <Text font="caption" foregroundStyle="systemBlue">
              点按复制
            </Text>
          </HStack>
          <Text
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
            styledText={buildPasswordStyledText(password)}
          />
        </VStack>
      </Button>

      <Text font="caption" foregroundStyle="secondaryLabel">
        {strength.description}
      </Text>

      <VStack spacing={8}>
        <HStack frame={{ width: "100%" as any }}>
          <Text font="subheadline">密码长度</Text>
          <Spacer />
          <Text font="headline" foregroundStyle="systemBlue">
            {options.length}
          </Text>
        </HStack>
        <Slider
          min={6}
          max={40}
          step={1}
          value={options.length}
          onChanged={updateLength}
          label={<Text>密码长度</Text>}
        />
        {props.mode === "app" ? (
          <HStack frame={{ width: "100%" as any }}>
            <Text font="caption" foregroundStyle="secondaryLabel">6</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">40</Text>
          </HStack>
        ) : null}
      </VStack>

      <HStack spacing={8}>
        <ActionButton
          title="重新生成"
          icon="arrow.triangle.2.circlepath"
          onPress={() => {
            regenerate()
            setStatusText("已生成一组新密码")
          }}
        />
        {props.mode === "keyboard" ? (
          <ActionButton
            title="填入"
            icon="arrow.down.to.line"
            color="systemGreen"
            onPress={insertPassword}
          />
        ) : null}
        {props.mode === "keyboard" ? (
          <ActionButton
            title="撤销"
            icon="arrow.uturn.backward.circle"
            color="systemRed"
            disabled={!lastFilledLength}
            onPress={undoLastFill}
          />
        ) : null}
      </HStack>
    </Card>
  )

  const statusCard = (
    <Card>
      <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          状态
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {statusText}
        </Text>
      </VStack>
    </Card>
  )

  const content = (
    <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack spacing={12} padding={{ top: topPadding, bottom: 20, leading: 12, trailing: 12 }}>
        {props.mode === "keyboard" ? (
          <HStack frame={{ width: "100%" as any }}>
            <KeyboardTopIconButton icon="globe" onPress={switchKeyboard} />
            <Spacer />
            <KeyboardTopIconButton icon="clock.arrow.circlepath" onPress={openHistory} />
          </HStack>
        ) : null}

        {firstCard}

        {props.mode === "app" ? (
          <Card>
            <VStack spacing={2}>
              <ToggleRow
                title="英文字母"
                subtitle="包含大写和小写字母"
                icon="textformat"
                value={options.includeLetters}
                disabled={onlyOneEnabled && options.includeLetters}
                onChanged={(value) => updateToggle("includeLetters", value)}
              />
              <ToggleRow
                title="数字"
                subtitle="包含 0-9"
                icon="123.rectangle"
                value={options.includeNumbers}
                disabled={onlyOneEnabled && options.includeNumbers}
                onChanged={(value) => updateToggle("includeNumbers", value)}
              />
              <ToggleRow
                title="特殊符号"
                subtitle={`当前 ${symbolSettings.enabledSymbols.length} 个可用符号`}
                icon="at.circle"
                value={options.includeSymbols}
                disabled={onlyOneEnabled && options.includeSymbols}
                onChanged={(value) => updateToggle("includeSymbols", value)}
              />
            </VStack>

            <Text font="caption" foregroundStyle="secondaryLabel">
              至少保留一种字符类型。生成器会确保每个已开启的字符类型都至少出现一次。
            </Text>
          </Card>
        ) : null}

        {props.mode === "app" ? statusCard : null}
      </VStack>
    </ScrollView>
  )

  if (props.mode === "keyboard") {
    return (
      <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <VStack spacing={12} padding={{ top: topPadding, bottom: 20, leading: 12, trailing: 12 }}>
          {keyboardTopBar}
          {showKeyboardHistory ? keyboardHistoryContent : firstCard}
        </VStack>
      </ScrollView>
    )
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="Password Generator"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="gearshape"
              action={withHaptic(openSymbolSettings)}
            />
          ),
          topBarTrailing: (
            <Button
              title=""
              systemImage="clock.arrow.circlepath"
              action={withHaptic(openHistory)}
            />
          ),
        }}
      >
        {content}
      </VStack>
    </NavigationStack>
  )
}
