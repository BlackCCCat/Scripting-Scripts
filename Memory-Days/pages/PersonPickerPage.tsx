import { NavigationLink, List, Section, Button, Text, HStack, VStack, Spacer, Toolbar, ToolbarItem, Image } from 'scripting'
import { Person } from '../types'
import { Avatar, RelationshipTag, EmptyState } from '../components'

// 分组排序：内置关系按此顺序，自定义关系排在后面（与人物页保持一致）
const GROUP_ORDER = ['自己', '伴侣', '子女', '家人', '朋友', '同学', '同事', '其他']

interface PersonPickerPageProps {
  persons: Person[]
  onCreatePerson: () => void | Promise<Person | void>
  title?: string
  onCancel?: () => void
  destinationForPerson: (person: Person) => any
}

export function PersonPickerPage({ persons, onCreatePerson, title = '选择人物', onCancel, destinationForPerson }: PersonPickerPageProps) {
  // 排序逻辑与人物页保持一致：置顶优先 → 按关系分组 → 组内按姓名排序
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, 'zh-CN')
  const pinned = [...persons].filter(p => p.isPinned).sort(byName)
  const unpinned = [...persons].filter(p => !p.isPinned).sort(byName)

  const grouped: Record<string, Person[]> = {}
  for (const person of unpinned) {
    const key = person.relationship && GROUP_ORDER.includes(person.relationship)
      ? person.relationship
      : '其他'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(person)
  }
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    const indexA = GROUP_ORDER.indexOf(a)
    const indexB = GROUP_ORDER.indexOf(b)
    if (indexA >= 0 && indexB >= 0) return indexA - indexB
    if (indexA >= 0) return -1
    if (indexB >= 0) return 1
    return a.localeCompare(b, 'zh-CN')
  })

  const sortedPersons = [...pinned, ...groupKeys.flatMap(key => grouped[key])]

  const createPerson = async () => {
    await onCreatePerson()
  }

  const renderPersonRow = (person: Person) => (
    <HStack spacing={12} frame={{ maxWidth: Infinity }} alignment="center">
      <Avatar person={person} size={40} />
      <VStack alignment="leading" spacing={2}>
        <Text fontWeight="semibold">{person.name}</Text>
        <RelationshipTag relationship={person.relationship} />
      </VStack>
      <Spacer />
    </HStack>
  )

  const content = (
    <List
        listStyle="insetGroup"
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        scrollIndicator="hidden"
        toolbar={
          <Toolbar>
            {onCancel ? (
              <ToolbarItem placement="topBarTrailing">
                <Button title="" systemImage="xmark" role="cancel" foregroundStyle="red" action={onCancel} />
              </ToolbarItem>
            ) : null}
          </Toolbar>
        }
      >
        <Section>
          <Button action={createPerson}>
            <HStack spacing={12} frame={{ maxWidth: Infinity }} alignment="center">
              <Image systemName="person.badge.plus" font={24} foregroundStyle="accentColor" />
              <Text fontWeight="semibold">新建人物</Text>
              <Spacer />
              <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>
        </Section>

        {sortedPersons.length > 0 ? (
          <Section title="现有人物">
            {sortedPersons.map(person => (
              <NavigationLink key={person.id} destination={destinationForPerson(person)}>
                {renderPersonRow(person)}
              </NavigationLink>
            ))}
          </Section>
        ) : (
          <EmptyState title="还没有人物" subtitle="点击上方新建人物" systemImage="person.2" />
        )}
      </List>
  )

  return content
}
