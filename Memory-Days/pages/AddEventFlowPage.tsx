import { Navigation, NavigationStack, List, Section, Text, Button, Toolbar, ToolbarItem, Image, VStack, HStack, Spacer } from 'scripting'
import { useState } from 'scripting'
import { AnniversaryEvent, AnniversaryWidgetSize, AppSettings, Person } from '../types'
import { PersonPickerPage } from './PersonPickerPage'
import { EventEditorPage } from './EventEditorPage'

interface AddEventFlowPageProps {
  persons: Person[]
  settings: AppSettings
  onSave: (event: AnniversaryEvent | AnniversaryEvent[]) => void | Promise<void>
  onCreatePerson: () => Promise<Person | void>
}

export function AddEventFlowPage({ persons, settings, onSave, onCreatePerson }: AddEventFlowPageProps) {
  const dismiss = Navigation.useDismiss()
  const [size, setSize] = useState<AnniversaryWidgetSize | null>(null)
  const [firstPerson, setFirstPerson] = useState<Person | null>(null)
  const [secondPerson, setSecondPerson] = useState<Person | null>(null)

  const saveAndClose = async (event: AnniversaryEvent | AnniversaryEvent[]) => {
    await onSave(event)
    dismiss()
  }

  if (!size) {
    return (
      <NavigationStack>
        <List
          listStyle="insetGroup"
          navigationTitle="添加时光纪念"
          navigationBarTitleDisplayMode="inline"
          toolbar={
            <Toolbar>
              <ToolbarItem placement="topBarLeading">
                <Button title="取消" role="cancel" action={dismiss} />
              </ToolbarItem>
            </Toolbar>
          }
        >
          <Section title="选择卡片尺寸">
            {([
              { value: 'systemLarge' as const, title: '大卡片', subtitle: '选择两个人物，组成一张大卡片' },
              { value: 'systemMedium' as const, title: '中卡片', subtitle: '选择一个人物，适配中号小组件' },
              { value: 'systemSmall' as const, title: '小卡片', subtitle: '选择一个人物，适配小号小组件' }
            ]).map(option => (
              <Button key={option.value} action={() => setSize(option.value)}>
                <HStack spacing={12} frame={{ maxWidth: Infinity }}>
                  <Image systemName={option.value === 'systemLarge' ? 'rectangle.stack.fill' : option.value === 'systemMedium' ? 'rectangle.fill' : 'square.fill'} foregroundStyle="accentColor" />
                  <VStack alignment="leading" spacing={3}>
                    <Text fontWeight="semibold">{option.title}</Text>
                    <Text foregroundStyle="secondaryLabel" font={13}>{option.subtitle}</Text>
                  </VStack>
                  <Spacer />
                  <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
                </HStack>
              </Button>
            ))}
          </Section>
        </List>
      </NavigationStack>
    )
  }

  if (size !== 'systemLarge') {
    if (!firstPerson) {
      return (
        <PersonPickerPage
          embedded
          title="选择人物"
          persons={persons}
          onCreatePerson={async () => {
            const person = await onCreatePerson()
            if (person) setFirstPerson(person)
            return person
          }}
          onSelectPerson={setFirstPerson}
        />
      )
    }
    return (
      <EventEditorPage
        embedded
        person={firstPerson}
        settings={settings}
        initialWidgetSize={size}
        onSave={saveAndClose}
      />
    )
  }

  if (!firstPerson || !secondPerson) {
    const selectingSecond = !!firstPerson
    return (
      <PersonPickerPage
        embedded
        title={selectingSecond ? '选择第二个人物' : '选择第一个人物'}
        persons={persons}
        onCreatePerson={async () => {
          const person = await onCreatePerson()
          if (person) {
            selectingSecond ? setSecondPerson(person) : setFirstPerson(person)
          }
          return person
        }}
        onSelectPerson={(person) => {
          selectingSecond ? setSecondPerson(person) : setFirstPerson(person)
        }}
      />
    )
  }

  return (
    <EventEditorPage
      embedded
      person={firstPerson}
      secondPerson={secondPerson}
      settings={settings}
      initialWidgetSize="systemLarge"
      onSave={saveAndClose}
    />
  )
}
