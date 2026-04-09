import {
  Button,
  ForEach,
  Form,
  NavigationStack,
  Section,
  TextField,
  useState,
} from "scripting"

import { normalizeKeywords } from "../utils"

export function KeywordEditorPage(props: {
  initialKeywords: string[]
  onKeywordsChanged: (next: string[]) => void | Promise<void>
}) {
  const [draftKeywords, setDraftKeywords] = useState<string[]>(
    props.initialKeywords.length > 0 ? props.initialKeywords : [""]
  )

  function persist(nextDraftKeywords: string[]) {
    const normalized = normalizeKeywords(nextDraftKeywords)
    setDraftKeywords(nextDraftKeywords.length > 0 ? nextDraftKeywords : [""])
    void props.onKeywordsChanged(normalized)
  }

  function addKeyword() {
    persist([...draftKeywords, ""])
  }

  function updateKeyword(index: number, value: string) {
    persist(draftKeywords.map((item, idx) => idx === index ? value : item))
  }

  function removeKeyword(index: number) {
    persist(draftKeywords.filter((_, idx) => idx !== index))
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="关键字"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={{
          topBarTrailing: (
            <Button title="" systemImage="plus" action={addKeyword} />
          ),
        }}
      >
        <Section>
          <ForEach
            count={draftKeywords.length}
            itemBuilder={(index) => (
              <TextField
                key={`keyword-${index}`}
                title={`关键字 ${index + 1}`}
                value={draftKeywords[index]}
                onChanged={(value) => updateKeyword(index, value)}
              />
            )}
            onDelete={(indices) => {
              const toDelete = new Set(indices)
              persist(draftKeywords.filter((_, index) => !toDelete.has(index)))
            }}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
