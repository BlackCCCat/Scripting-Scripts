import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
  HStack,
  Spacer,
  Picker,
  useMemo,
  useState,
} from "scripting"

import type { ModuleInfo } from "../utils/storage"

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Button role={props.role} action={props.onPress} disabled={props.disabled}>
      <HStack frame={{ width: "100%" as any }} padding={{ top: 14, bottom: 14 }}>
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function EditModuleView(props: {
  title: string
  categories: string[]
  initial?: ModuleInfo
}) {
  const dismiss = Navigation.useDismiss()

  const initial = props.initial
  const [name, setName] = useState<string>(initial?.name ?? "")
  const [link, setLink] = useState<string>(initial?.link ?? "")

  const categoryOptions = useMemo<string[]>(() => ["不设置分类", ...props.categories], [props.categories])
  const initialIdx = Math.max(
    0,
    categoryOptions.findIndex((c) => c === (initial?.category ?? ""))
  )
  const [categoryIdx, setCategoryIdx] = useState<number>(initialIdx >= 0 ? initialIdx : 0)

  async function onSave() {
    const trimmedName = name.trim()
    const trimmedLink = link.trim()
    const cat = categoryOptions[categoryIdx] === "不设置分类" ? undefined : categoryOptions[categoryIdx]

    if (!trimmedName || !trimmedLink) {
      await Dialog.alert({ message: "名称和链接不能为空" })
      return
    }

    const result: ModuleInfo = {
      name: trimmedName,
      link: trimmedLink,
      category: cat,
    }
    dismiss(result)
  }

  return (
    <NavigationStack>
      <VStack navigationTitle={props.title} navigationBarTitleDisplayMode={"inline"}>
        <Form formStyle="grouped">
          <Section header={<Text>模块信息</Text>}>
            <TextField
              label={<Text>名称</Text>}
              value={name}
              onChanged={(v: string) => setName(v)}
              prompt="模块名称"
              textFieldStyle="roundedBorder"
            />
            <TextField
              label={<Text>链接</Text>}
              value={link}
              onChanged={(v: string) => setLink(v)}
              prompt="https://"
              textFieldStyle="roundedBorder"
            />
          </Section>

          <Section header={<Text>分类</Text>}>
            <Picker
              title={"模块分类"}
              pickerStyle="menu"
              value={categoryIdx}
              onChanged={(idx: number) => setCategoryIdx(idx)}
            >
              {categoryOptions.map((c, idx) => (
                <Text key={`${c}-${idx}`} tag={idx}>
                  {c}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section>
            <CenterRowButton title="保存" onPress={onSave} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
