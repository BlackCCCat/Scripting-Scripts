import {
  Button,
  ForEach,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  useEffect,
  useState,
} from "scripting"

import type {
  CaisSettings,
  KeyboardCustomAction,
  KeyboardCustomActionMode,
  KeyboardMenuBuiltinAction,
} from "../types"
import { makeId } from "../utils/common"

const INTERVAL_OPTIONS = [100, 200, 300, 400, 500]
const MAX_ITEM_OPTIONS = [200, 500, 1000, 3000]
const KEYBOARD_MAX_ITEM_OPTIONS = [10, 20, 30, 40, 50]

const BUILTIN_ACTIONS: Array<{
  key: KeyboardMenuBuiltinAction
  title: string
}> = [
    { key: "pin", title: "置顶" },
    { key: "favorite", title: "收藏" },
    { key: "base64Encode", title: "Base64 编码" },
    { key: "base64Decode", title: "Base64 解码" },
    { key: "cleanWhitespace", title: "移除空格" },
    { key: "uppercase", title: "转为大写" },
    { key: "lowercase", title: "转为​小写" },
    { key: "openUrl", title: "打开链接" },
  ]
const FIXED_BUILTIN_ACTION_KEYS: KeyboardMenuBuiltinAction[] = ["pin", "favorite"]
const CONFIGURABLE_BUILTIN_ACTIONS = BUILTIN_ACTIONS.filter(
  (action) => !FIXED_BUILTIN_ACTION_KEYS.includes(action.key)
)

function optionIndex(options: number[], value: number): number {
  const index = options.findIndex((item) => item === value)
  return index >= 0 ? index : 0
}

function CustomActionEditorView(props: {
  action?: KeyboardCustomAction
}) {
  const dismiss = Navigation.useDismiss()
  const [title, setTitle] = useState(props.action?.title ?? "")
  const [mode, setMode] = useState<KeyboardCustomActionMode>(props.action?.mode ?? "template")
  const [template, setTemplate] = useState(props.action?.template ?? "{{text}}")
  const [regex, setRegex] = useState(props.action?.regex ?? "")

  async function save() {
    const fixedTitle = title.trim()
    const fixedTemplate = template.trim()
    const fixedRegex = regex.trim()
    if (!fixedTitle) {
      await Dialog.alert({ message: "请输入功能名称" })
      return
    }
    if (mode === "template" && !fixedTemplate) {
      await Dialog.alert({ message: "请输入模板内容" })
      return
    }
    if (mode === "regex" && !fixedRegex) {
      await Dialog.alert({ message: "请输入正则表达式" })
      return
    }
    dismiss({
      id: props.action?.id ?? makeId("menu"),
      title: fixedTitle,
      mode,
      template: mode === "template" ? fixedTemplate : "",
      regex: mode === "regex" ? fixedRegex : "",
      enabled: props.action?.enabled ?? true,
    })
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.action ? "编辑功能" : "添加功能"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.72, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: (
            <Button title="取消" role="cancel" action={() => dismiss(null)} />
          ),
          topBarTrailing: (
            <Button title="保存" action={() => void save()} />
          ),
        }}
      >
        <Section header={<Text>基本信息</Text>}>
          <TextField title="名称" value={title} prompt="例如：提取手机号" onChanged={setTitle} />
          <Picker
            title="类型"
            pickerStyle="menu"
            value={mode === "template" ? 0 : 1}
            onChanged={(index: number) => setMode(index === 1 ? "regex" : "template")}
          >
            <Text tag={0}>模板替换</Text>
            <Text tag={1}>正则提取</Text>
          </Picker>
        </Section>

        {mode === "template" ? (
          <Section
            header={<Text>模板</Text>}
            footer={<Text>{"可使用 {{text}}、{{date}}、{{time}}、{{datetime}}、{{timestamp}}。"}</Text>}
          >
            <TextField
              title=""
              value={template}
              prompt={'例如："{{text}}" - {{datetime}}'}
              axis="vertical"
              frame={{ minHeight: 92, maxWidth: "infinity", alignment: "topLeading" as any }}
              onChanged={setTemplate}
            />
          </Section>
        ) : (
          <Section
            header={<Text>正则表达式</Text>}
            footer={<Text>应用时会插入第一个捕获组；没有捕获组时插入完整匹配结果。</Text>}
          >
            <TextField
              title=""
              value={regex}
              prompt={"例如：[\\w.-]+@[\\w.-]+\\.[A-Za-z]{2,}"}
              axis="vertical"
              frame={{ minHeight: 92, maxWidth: "infinity", alignment: "topLeading" as any }}
              onChanged={setRegex}
            />
          </Section>
        )}
      </Form>
    </NavigationStack>
  )
}

export function SettingsView(props: {
  value: CaisSettings
  onChanged: (settings: CaisSettings) => void
  addActionToken?: number
  leadingToolbar?: any
  trailingToolbar?: any
}) {
  const settings = props.value

  useEffect(() => {
    if (!props.addActionToken) return
    void presentCustomActionEditor()
  }, [props.addActionToken])

  function update(next: Partial<CaisSettings>) {
    props.onChanged({ ...settings, ...next })
  }

  function getOrderedBuiltinActions() {
    const order = settings.keyboardMenu.builtinOrder?.filter(
      (key) => !FIXED_BUILTIN_ACTION_KEYS.includes(key)
    )
    if (!order || !order.length) return CONFIGURABLE_BUILTIN_ACTIONS
    const sorted = order
      .map((key) => CONFIGURABLE_BUILTIN_ACTIONS.find((a) => a.key === key))
      .filter(Boolean) as typeof BUILTIN_ACTIONS
    const missing = CONFIGURABLE_BUILTIN_ACTIONS.filter((a) => !order.includes(a.key))
    return [...sorted, ...missing]
  }

  function reorderBuiltins(indices: number[], newOffset: number) {
    const ordered = getOrderedBuiltinActions()
    const moving = indices.map((i) => ordered[i])
    const rest = ordered.filter((_, i) => !indices.includes(i))
    rest.splice(newOffset, 0, ...moving)
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        builtinOrder: rest.map((a) => a.key),
      },
    })
  }

  function reorderCustomActions(indices: number[], newOffset: number) {
    const arr = [...settings.keyboardMenu.customActions]
    const moving = indices.map((i) => arr[i])
    const rest = arr.filter((_, i) => !indices.includes(i))
    rest.splice(newOffset, 0, ...moving)
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: rest,
      },
    })
  }

  function updateBuiltin(key: KeyboardMenuBuiltinAction, value: boolean) {
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        builtins: {
          ...settings.keyboardMenu.builtins,
          [key]: value,
        },
      },
    })
  }

  function updateCustomAction(id: string, patch: Partial<KeyboardCustomAction>) {
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: settings.keyboardMenu.customActions.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      },
    })
  }

  function saveCustomAction(action: KeyboardCustomAction) {
    const exists = settings.keyboardMenu.customActions.some((item) => item.id === action.id)
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: exists
          ? settings.keyboardMenu.customActions.map((item) => item.id === action.id ? action : item)
          : [...settings.keyboardMenu.customActions, action].slice(0, 12),
      },
    })
  }

  function removeCustomAction(id: string) {
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: settings.keyboardMenu.customActions.filter((item) => item.id !== id),
      },
    })
  }

  async function presentCustomActionEditor(action?: KeyboardCustomAction) {
    const next = await Navigation.present<KeyboardCustomAction | null>({
      element: <CustomActionEditorView action={action} />,
      modalPresentationStyle: "pageSheet",
    })
    if (next) saveCustomAction(next)
  }

  return (
    <Form
      navigationTitle="设置"
      navigationBarTitleDisplayMode="inline"
      formStyle="grouped"
      toolbar={{
        topBarLeading: props.leadingToolbar,
        topBarTrailing: props.trailingToolbar,
      }}
    >

      <Section header={<Text>采集类型</Text>}>
        <Toggle
          value={settings.captureText}
          onChanged={(captureText: boolean) => update({ captureText })}
          toggleStyle="switch"
        >
          <Text>文本</Text>
        </Toggle>
        <Toggle
          value={settings.captureImages}
          onChanged={(captureImages: boolean) => update({ captureImages })}
          toggleStyle="switch"
        >
          <Text>图片</Text>
        </Toggle>
      </Section>

      <Section header={<Text>采集策略</Text>}>
        <Picker
          title="重复内容"
          pickerStyle="menu"
          value={settings.duplicatePolicy === "skip" ? 1 : 0}
          onChanged={(index: number) => update({ duplicatePolicy: index === 1 ? "skip" : "bump" })}
        >
          <Text tag={0}>更新到顶部</Text>
          <Text tag={1}>跳过</Text>
        </Picker>
        <Picker
          title="监听间隔"
          pickerStyle="menu"
          value={optionIndex(INTERVAL_OPTIONS, settings.monitorIntervalMs)}
          onChanged={(index: number) => update({ monitorIntervalMs: INTERVAL_OPTIONS[index] ?? 500 })}
        >
          {INTERVAL_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>{value} ms</Text>
          ))}
        </Picker>
        <Picker
          title="最多保留"
          pickerStyle="menu"
          value={optionIndex(MAX_ITEM_OPTIONS, settings.maxItems)}
          onChanged={(index: number) => update({ maxItems: MAX_ITEM_OPTIONS[index] ?? 1000 })}
        >
          {MAX_ITEM_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>{value} 条</Text>
          ))}
        </Picker>
        <Picker
          title="键盘保留条数"
          pickerStyle="menu"
          value={optionIndex(KEYBOARD_MAX_ITEM_OPTIONS, settings.keyboardMaxItems)}
          onChanged={(index: number) => update({ keyboardMaxItems: KEYBOARD_MAX_ITEM_OPTIONS[index] ?? 30 })}
        >
          {KEYBOARD_MAX_ITEM_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>{value} 条</Text>
          ))}
        </Picker>
      </Section>

      <Section header={<Text>键盘长按菜单</Text>}>
        <ForEach
          count={getOrderedBuiltinActions().length}
          itemBuilder={(index) => {
            const action = getOrderedBuiltinActions()[index]
            return action ? (
              <Toggle
                key={action.key}
                value={settings.keyboardMenu.builtins[action.key]}
                onChanged={(value: boolean) => updateBuiltin(action.key, value)}
                toggleStyle="switch"
              >
                <Text>{action.title}</Text>
              </Toggle>
            ) : (null as any)
          }}
          onMove={reorderBuiltins}
        />
      </Section>

      <Section header={<Text>自定义长按功能</Text>}>
        {settings.keyboardMenu.customActions.length ? (
          <ForEach
            count={settings.keyboardMenu.customActions.length}
            itemBuilder={(index) => {
              const action = settings.keyboardMenu.customActions[index]
              return action ? (
                <HStack
                  key={action.id}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        title=""
                        systemImage="square.and.pencil"
                        tint="systemOrange"
                        action={() => void presentCustomActionEditor(action)}
                      />,
                      <Button
                        title=""
                        systemImage="trash"
                        role="destructive"
                        tint="systemRed"
                        action={() => removeCustomAction(action.id)}
                      />,
                    ],
                  }}
                >
                  <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{action.title}</Text>
                  <Spacer />
                  <Toggle
                    title=""
                    value={action.enabled}
                    onChanged={(enabled: boolean) => updateCustomAction(action.id, { enabled })}
                    toggleStyle="switch"
                  />
                </HStack>
              ) : (null as any)
            }}
            onMove={reorderCustomActions}
          />
        ) : (
          <Text foregroundStyle="secondaryLabel">点击右上角添加自定义功能</Text>
        )}
      </Section>
    </Form>
  )
}
