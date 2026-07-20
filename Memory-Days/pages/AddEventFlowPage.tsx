import { List, Section, Text, Image, VStack, HStack, Spacer, NavigationLink } from 'scripting'
import { AnniversaryEvent, AnniversaryWidgetSize, AppSettings, Person } from '../types'
import { PersonPickerPage } from './PersonPickerPage'
import { EventEditorPage } from './EventEditorPage'

interface AddEventFlowPageProps {
  persons: Person[]
  settings: AppSettings
  onCancel: () => void
  onSave: (event: AnniversaryEvent | AnniversaryEvent[]) => void | Promise<void>
  onCreatePerson: () => Promise<Person | void>
}

const SIZE_OPTIONS = [
  { value: 'systemLarge' as const, title: '大卡片', subtitle: '选择两个人物，组成一张大卡片' },
  { value: 'systemMedium' as const, title: '中卡片', subtitle: '选择一个人物，适配中号小组件' },
  { value: 'systemSmall' as const, title: '小卡片', subtitle: '选择一个人物，适配小号小组件' }
]

export function AddEventFlowPage({ persons, settings, onCancel, onSave, onCreatePerson }: AddEventFlowPageProps) {
  const saveAndClose = async (event: AnniversaryEvent | AnniversaryEvent[]) => {
    await onSave(event)
  }

  const renderSingleEditor = (size: Exclude<AnniversaryWidgetSize, 'systemLarge'>, person: Person) => (
    <EventEditorPage
      embedded
      person={person}
      settings={settings}
      initialWidgetSize={size}
      onCancel={onCancel}
      onSave={saveAndClose}
    />
  )

  const renderLargeEditor = (firstPerson: Person, secondPerson: Person) => (
    <EventEditorPage
      embedded
      person={firstPerson}
      secondPerson={secondPerson}
      settings={settings}
      initialWidgetSize="systemLarge"
      onCancel={onCancel}
      onSave={saveAndClose}
    />
  )

  const renderSecondPersonPicker = (firstPerson: Person) => (
    <PersonPickerPage
      title="选择第二个人物"
      persons={persons}
      onCancel={onCancel}
      onCreatePerson={onCreatePerson}
      destinationForPerson={(secondPerson) => renderLargeEditor(firstPerson, secondPerson)}
    />
  )

  const renderFirstPersonPicker = (size: AnniversaryWidgetSize) => (
    <PersonPickerPage
      title={size === 'systemLarge' ? '选择第一个人物' : '选择人物'}
      persons={persons}
      onCancel={onCancel}
      onCreatePerson={onCreatePerson}
      destinationForPerson={(person) => (
        size === 'systemLarge'
          ? renderSecondPersonPicker(person)
          : renderSingleEditor(size, person)
      )}
    />
  )

  return (
    <List
      listStyle="insetGroup"
      navigationTitle="添加时光纪念"
      navigationBarTitleDisplayMode="inline"
    >
      <Section title="选择卡片尺寸">
        {SIZE_OPTIONS.map(option => (
          <NavigationLink key={option.value} destination={renderFirstPersonPicker(option.value)}>
            <HStack spacing={12} frame={{ maxWidth: Infinity }}>
              <Image systemName={option.value === 'systemLarge' ? 'rectangle.stack.fill' : option.value === 'systemMedium' ? 'rectangle.fill' : 'square.fill'} foregroundStyle="accentColor" />
              <VStack alignment="leading" spacing={3}>
                <Text fontWeight="semibold">{option.title}</Text>
                <Text foregroundStyle="secondaryLabel" font={13}>{option.subtitle}</Text>
              </VStack>
              <Spacer />
            </HStack>
          </NavigationLink>
        ))}
      </Section>
    </List>
  )
}
