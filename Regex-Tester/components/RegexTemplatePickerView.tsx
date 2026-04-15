import { Button, HStack, Image, List, Navigation, NavigationStack, Section, Text, VStack, useState } from "scripting"
import { RegexListRow } from "./RegexListRow"
import { addRegexItems, createRegexItemFromTemplate } from "../utils/library"
import { REGEX_TEMPLATES } from "../utils/templates"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

export function RegexTemplatePickerView() {
  const dismiss = Navigation.useDismiss()
  const [selectedTitles, setSelectedTitles] = useState<string[]>([])

  function toggleTemplate(title: string) {
    setSelectedTitles((current) => (
      current.includes(title)
        ? current.filter((item) => item !== title)
        : [...current, title]
    ))
  }

  async function saveSelected() {
    const picked = REGEX_TEMPLATES
      .filter((template) => selectedTitles.includes(template.title))
      .map((template) => createRegexItemFromTemplate(template))
    if (!picked.length) return
    addRegexItems(picked)
    dismiss()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="常用模板"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
            <Button title="保存" disabled={!selectedTitles.length} action={withHaptic(saveSelected)} />
          ),
        }}
      >
        <Section header={<Text>选择模板后保存到首页</Text>}>
          {REGEX_TEMPLATES.map((template) => {
            const item = createRegexItemFromTemplate(template)
            const selected = selectedTitles.includes(template.title)
            return (
              <Button
                key={template.title}
                buttonStyle="plain"
                action={withHaptic(() => toggleTemplate(template.title))}
                frame={{ maxWidth: "infinity" }}
              >
                <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                  <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                    <RegexListRow item={item} />
                  </VStack>
                  <Image
                    systemName={selected ? "checkmark.circle.fill" : "circle"}
                    foregroundStyle={selected ? "systemBlue" : "secondaryLabel"}
                  />
                </HStack>
              </Button>
            )
          })}
        </Section>
      </List>
    </NavigationStack>
  )
}
