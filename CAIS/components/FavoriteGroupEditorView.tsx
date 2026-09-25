import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  Toggle,
  useState,
} from "scripting"

import type { FavoriteGroup, FavoriteGroupRuleType } from "../types"
import { validateRegexPattern } from "../utils/custom_action"

export type FavoriteGroupDraft = {
  title: string
  ruleType: FavoriteGroupRuleType
  pattern: string
  ignoreCase: boolean
}

export function FavoriteGroupEditorView(props: {
  initial?: FavoriteGroup
  embedded?: boolean
  onCancel?: () => void
  onSave?: (draft: FavoriteGroupDraft) => Promise<void> | void
}) {
  const dismiss = Navigation.useDismiss()
  const [title, setTitle] = useState(props.initial?.title ?? "")
  const [ruleType, setRuleType] = useState<FavoriteGroupRuleType>(props.initial?.ruleType ?? "keyword")
  const [pattern, setPattern] = useState(props.initial?.pattern ?? "")
  const [ignoreCase, setIgnoreCase] = useState(props.initial?.ignoreCase ?? true)
  const [saving, setSaving] = useState(false)

  function cancel() {
    if (props.onCancel) props.onCancel()
    else dismiss(null)
  }

  async function save() {
    if (saving) return
    if (!title.trim()) {
      await Dialog.alert({ message: "分组名称不能为空" })
      return
    }
    if (!pattern.trim()) {
      await Dialog.alert({ message: "匹配内容不能为空" })
      return
    }
    if (ruleType === "regex") {
      const error = validateRegexPattern(pattern)
      if (error) {
        await Dialog.alert({ title: "正则表达式无效", message: error })
        return
      }
    }
    const draft = {
      title: title.trim(),
      ruleType,
      pattern,
      ignoreCase: ruleType === "keyword" && ignoreCase,
    } satisfies FavoriteGroupDraft
    setSaving(true)
    try {
      if (props.onSave) await props.onSave(draft)
      else dismiss(draft)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分组保存失败") })
    } finally {
      setSaving(false)
    }
  }

  const form = (
    <Form
      navigationTitle={props.initial ? "编辑收藏分组" : "添加收藏分组"}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility={props.embedded ? "visible" : undefined}
      formStyle="grouped"
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
      toolbar={{
        topBarLeading: props.embedded
          ? undefined
          : <Button title="取消" role="cancel" action={cancel} />,
        topBarTrailing: (
          <Button
            title="保存"
            disabled={saving || !title.trim() || !pattern.trim()}
            action={() => void save()}
          />
        ),
      }}
    >
      <Section header={<Text>分组名称</Text>}>
        <TextField title="" value={title} prompt="输入分组名称" onChanged={setTitle} />
      </Section>

      <Section
        header={<Text>匹配规则</Text>}
        footer={(
          <Text>
            {ruleType === "keyword"
              ? "标题或内容包含关键词时自动归入此分组。"
              : "正则表达式匹配标题或内容时自动归入此分组。"}
          </Text>
        )}
      >
        <Picker
          title="规则类型"
          pickerStyle="segmented"
          value={ruleType === "regex" ? 1 : 0}
          onChanged={(value: number) => setRuleType(value === 1 ? "regex" : "keyword")}
        >
          <Text tag={0}>关键词</Text>
          <Text tag={1}>正则表达式</Text>
        </Picker>
        <TextField
          title="匹配内容"
          value={pattern}
          prompt={ruleType === "regex" ? "输入正则表达式" : "输入关键词"}
          onChanged={setPattern}
        />
        {ruleType === "keyword" ? (
          <Toggle value={ignoreCase} onChanged={setIgnoreCase} toggleStyle="switch">
            <Text>忽略大小写</Text>
          </Toggle>
        ) : null}
      </Section>
    </Form>
  )

  return props.embedded ? form : <NavigationStack>{form}</NavigationStack>
}
