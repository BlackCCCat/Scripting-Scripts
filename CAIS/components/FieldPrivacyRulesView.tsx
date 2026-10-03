import { Button, Form, Navigation, NavigationStack, Section, Text, TextField, useObservable } from "scripting"
import type { NavigationZoomTransition } from "../utils/navigation_zoom"
import { validatePrivateFieldRules } from "../utils/favorite_fields"

export function FieldPrivacyRulesView(props: {
  initial: string
  embedded?: boolean
  navigationTransition?: NavigationZoomTransition
  onSave?: (value: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  const value = useObservable(props.initial)

  async function save() {
    const error = validatePrivateFieldRules(value.value)
    if (error) {
      await Dialog.alert({ title: "隐私规则错误", message: error })
      return
    }
    const next = value.value.trim()
    if (props.onSave) props.onSave(next)
    else dismiss(next)
  }

  const form = <Form
    navigationTitle="字段隐私规则"
    navigationBarTitleDisplayMode="inline"
    navigationTransition={props.navigationTransition}
    tabBarVisibility={props.embedded ? "visible" : undefined}
    formStyle="grouped"
    toolbar={{
      topBarLeading: props.embedded ? undefined : <Button title="取消" role="cancel" action={() => dismiss(null)} />,
      topBarTrailing: <Button title="保存" action={() => void save()} />,
    }}
  >
    <Section
      header={<Text>匹配子字段名</Text>}
      footer={<Text>每行一个关键词或正则表达式。普通关键词不区分大小写；正则写作 /表达式/ 或 /表达式/i。旧设置中的逗号分隔关键词仍可使用。仅遮挡显示，不改变复制的值。</Text>}
    >
      <TextField
        title=""
        value={value}
        prompt="每行输入一个关键词或正则表达式"
        axis="vertical"
        lineLimit={{ min: 8, max: 12 }}
      />
    </Section>
  </Form>

  return props.embedded ? form : <NavigationStack>{form}</NavigationStack>
}
