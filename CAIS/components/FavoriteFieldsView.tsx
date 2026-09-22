import {
  Button,
  EmptyView,
  Form,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useObservable,
  useState,
} from "scripting"
import type { VirtualNode } from "scripting"

import type { FavoriteFormat } from "../types"
import {
  normalizeFavoriteDelimiter,
  parseFavoriteFields,
  type FavoriteField,
} from "../utils/favorite_fields"

export type FavoriteDraft = {
  title: string
  content: string
  format: FavoriteFormat
  fieldDelimiter?: string
}

function presentCopyToast(
  presented: ReturnType<typeof useObservable<boolean>>,
  setMessage: (value: string) => void,
  message: string,
) {
  setMessage(message)
  presented.setValue(false)
  ;(globalThis as any).setTimeout?.(() => presented.setValue(true), 0)
}

export function FavoriteEditorView(props: {
  initial?: FavoriteDraft
  defaultDelimiter: string
  onPreviewCopy: (field: FavoriteField) => Promise<string | void> | string | void
  onEditContentInEditor?: (content: string) => Promise<string | null>
  renderEmbeddedContentEditor?: (
    content: string,
    onSave: (content: string) => void,
    onCancel: () => void,
  ) => VirtualNode
  embedded?: boolean
  onCancel?: () => void
  onSave?: (draft: FavoriteDraft) => void
  renderFieldContextMenu?: (
    field: FavoriteField,
    copy: () => void,
  ) => VirtualNode
}) {
  const dismiss = Navigation.useDismiss()
  const copyToastPresented = useObservable(false)
  const [title, setTitle] = useState(props.initial?.title ?? "")
  const [content, setContent] = useState(props.initial?.content ?? "")
  const [format, setFormat] = useState<FavoriteFormat>(props.initial?.format ?? "plain")
  const [copyToastMessage, setCopyToastMessage] = useState("")
  const [customDelimiterEnabled, setCustomDelimiterEnabled] = useState(Boolean(props.initial?.fieldDelimiter))
  const [customDelimiter, setCustomDelimiter] = useState(
    props.initial?.fieldDelimiter ?? normalizeFavoriteDelimiter(props.defaultDelimiter),
  )
  const [expandedEditorContent, setExpandedEditorContent] = useState<string | undefined>(undefined)
  const [expandedEditorPresented, setExpandedEditorPresented] = useState(false)
  const globalDelimiter = normalizeFavoriteDelimiter(props.defaultDelimiter)
  const delimiter = customDelimiterEnabled ? customDelimiter : globalDelimiter
  const parsed = format === "fields" && delimiter
    ? parseFavoriteFields(content, delimiter)
    : null

  async function copyPreviewField(field: FavoriteField) {
    const message = await props.onPreviewCopy(field)
    if (!message) return
    presentCopyToast(copyToastPresented, setCopyToastMessage, message)
  }

  async function editContentInEditor() {
    if (props.renderEmbeddedContentEditor) {
      setExpandedEditorContent(content)
      setExpandedEditorPresented(true)
      return
    }
    const next = await props.onEditContentInEditor?.(content)
    if (next != null) setContent(next)
  }

  function cancel() {
    if (props.onCancel) {
      props.onCancel()
    } else {
      dismiss(null)
    }
  }

  async function save() {
    if (!content.trim()) {
      await Dialog.alert({ message: "内容不能为空" })
      return
    }
    if (format === "fields" && customDelimiterEnabled && !customDelimiter) {
      await Dialog.alert({ message: "独立分隔符不能为空" })
      return
    }
    if (parsed?.errors.length) {
      await Dialog.alert({ title: "无法保存", message: parsed.errors[0] })
      return
    }
    const draft = {
      title,
      content,
      format,
      fieldDelimiter: format === "fields" && customDelimiterEnabled ? delimiter : undefined,
    } satisfies FavoriteDraft
    if (props.onSave) {
      props.onSave(draft)
    } else {
      dismiss(draft)
    }
  }

  const form = (
    <Form
        navigationTitle={props.initial ? "编辑收藏" : "添加收藏"}
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility={props.embedded ? "visible" : undefined}
        formStyle="grouped"
        toast={{
          isPresented: copyToastPresented,
          message: copyToastMessage,
          duration: 2,
          position: "bottom",
        }}
        presentationDetents={[0.82, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: props.embedded
            ? undefined
            : <Button title="取消" role="cancel" action={cancel} />,
          topBarTrailing: <Button title="保存" disabled={!content.trim()} action={() => void save()} />,
        }}
        navigationDestination={props.renderEmbeddedContentEditor ? {
          isPresented: expandedEditorPresented,
          onChanged: (isPresented: boolean) => {
            setExpandedEditorPresented(isPresented)
            if (!isPresented) setExpandedEditorContent(undefined)
          },
          content: expandedEditorContent !== undefined
            ? props.renderEmbeddedContentEditor(
                expandedEditorContent,
                (nextContent) => {
                  setContent(nextContent)
                  setExpandedEditorPresented(false)
                },
                () => setExpandedEditorPresented(false),
              )
            : <EmptyView />,
        } : undefined}
      >
        <Section>
          <Picker
            title="收藏类型"
            pickerStyle="segmented"
            value={format === "fields" ? 1 : 0}
            onChanged={(value: number) => setFormat(value === 1 ? "fields" : "plain")}
          >
            <Text tag={0}>普通收藏</Text>
            <Text tag={1}>字段收藏</Text>
          </Picker>
        </Section>

        {format === "fields" ? (
          <Section
            header={<Text>分隔规则</Text>}
            footer={(
              <Text>
                {customDelimiterEnabled
                  ? "独立分隔符仅用于当前收藏，并覆盖全局设置。"
                  : `当前使用全局分隔符“${globalDelimiter}”。`}
              </Text>
            )}
          >
            <Toggle
              value={customDelimiterEnabled}
              onChanged={setCustomDelimiterEnabled}
              toggleStyle="switch"
            >
              <Text>使用独立分隔符</Text>
            </Toggle>
            {customDelimiterEnabled ? (
              <TextField
                title="独立分隔符"
                value={customDelimiter}
                prompt={globalDelimiter}
                onChanged={(value: string) => setCustomDelimiter(
                  value.replace(/[\r\n]/g, "").slice(0, 8),
                )}
              />
            ) : null}
          </Section>
        ) : null}

        <Section header={<Text>标题</Text>}>
          <TextField title="" value={title} prompt="可选，留空则自动生成" onChanged={setTitle} />
        </Section>

        <Section
          header={(
            <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
              <Text>内容</Text>
              <Spacer />
              <Button
                title=""
                systemImage="rectangle.expand.vertical"
                accessibilityLabel="展开编辑"
                foregroundStyle="systemBlue"
                buttonStyle="plain"
                action={() => void editContentInEditor()}
              />
            </HStack>
          )}
          footer={format === "fields" ? (
            <Text>{`使用“${delimiter}”开始一个子字段；后续不带分隔符的非空行会分别作为该字段的值。`}</Text>
          ) : (
            <Text>{"可使用 {{text}}、{{date}}、{{time}}、{{datetime}}、{{timestamp}}。"}</Text>
          )}
        >
          <TextField
            title=""
            value={content}
            prompt={format === "fields" ? `例如：姓名${delimiter}张三` : "输入你想收藏的内容"}
            axis="vertical"
            lineLimit={{ min: format === "fields" ? 8 : 5, max: 14 }}
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            contentShape="rect"
            onChanged={setContent}
          />
        </Section>

        {format === "fields" ? (
          <Section
            header={(
              <Text
                font="headline"
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                multilineTextAlignment="leading"
              >
                子字段预览
              </Text>
            )}
            footer={<Text>点击子字段可复制对应的值。</Text>}
          >
            {parsed?.fields.length ? parsed.fields.map((field) => (
              <Button
                key={field.id}
                buttonStyle="plain"
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                background="rgba(0,0,0,0.001)"
                contentShape="rect"
                action={() => void copyPreviewField(field)}
                contextMenu={props.renderFieldContextMenu ? {
                  menuItems: props.renderFieldContextMenu(field, () => void copyPreviewField(field)),
                } : undefined}
              >
                <VStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                    <Text
                      font="headline"
                      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {field.name}
                    </Text>
                    <Image systemName="doc.on.doc" foregroundStyle="systemBlue" />
                  </HStack>
                  <Text
                    foregroundStyle="secondaryLabel"
                    frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                    multilineTextAlignment="leading"
                  >
                    {field.value}
                  </Text>
                </VStack>
              </Button>
            )) : (
              <Text foregroundStyle="secondaryLabel">输入内容后将在这里显示解析结果</Text>
            )}
            {parsed?.errors.length ? (
              <Text foregroundStyle="systemRed">{parsed.errors[0]}</Text>
            ) : null}
          </Section>
        ) : null}
    </Form>
  )

  return props.embedded ? form : <NavigationStack>{form}</NavigationStack>
}

export function FavoriteFieldsDetailView(props: {
  title: string
  fields: FavoriteField[]
  onCopy: (field: FavoriteField) => Promise<string | void> | string | void
  onCopyAll: () => Promise<string | void> | string | void
  embedded?: boolean
  onClose?: () => void
  renderFieldContextMenu?: (
    field: FavoriteField,
    copy: () => void,
  ) => VirtualNode
}) {
  const dismiss = Navigation.useDismiss()
  const copyToastPresented = useObservable(false)
  const [copyToastMessage, setCopyToastMessage] = useState("")

  async function copyField(field: FavoriteField) {
    const message = await props.onCopy(field)
    if (!message) return
    presentCopyToast(copyToastPresented, setCopyToastMessage, message)
  }

  async function copyAll() {
    const message = await props.onCopyAll()
    if (!message) return
    presentCopyToast(copyToastPresented, setCopyToastMessage, message)
  }

  function close() {
    if (props.onClose) {
      props.onClose()
    } else {
      dismiss()
    }
  }

  const form = (
    <Form
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility={props.embedded ? "visible" : undefined}
        formStyle="grouped"
        toast={{
          isPresented: copyToastPresented,
          message: copyToastMessage,
          duration: 2,
          position: "bottom",
        }}
        presentationDetents={[0.72, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: props.embedded
            ? undefined
            : <Button title="" systemImage="xmark" accessibilityLabel="关闭" role="cancel" action={close} />,
          topBarTrailing: <Button title="" systemImage="doc.on.doc" accessibilityLabel="复制全部" action={() => void copyAll()} />,
        }}
      >
        <Section
          header={(
            <Text
              font="headline"
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              multilineTextAlignment="leading"
            >
              子字段
            </Text>
          )}
          footer={<Text>点击任意子字段可复制对应的值。</Text>}
        >
          {props.fields.map((field) => (
            <Button
              key={field.id}
              buttonStyle="plain"
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              background="rgba(0,0,0,0.001)"
              contentShape="rect"
              action={() => void copyField(field)}
              contextMenu={props.renderFieldContextMenu ? {
                menuItems: props.renderFieldContextMenu(field, () => void copyField(field)),
              } : undefined}
            >
              <VStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                  <Text
                    font="headline"
                    frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                    multilineTextAlignment="leading"
                  >
                    {field.name}
                  </Text>
                  <Spacer />
                  <Image systemName="doc.on.doc" foregroundStyle="systemBlue" />
                </HStack>
                <Text
                  foregroundStyle="secondaryLabel"
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  multilineTextAlignment="leading"
                >
                  {field.value}
                </Text>
              </VStack>
            </Button>
          ))}
        </Section>
    </Form>
  )

  return props.embedded ? form : <NavigationStack>{form}</NavigationStack>
}
