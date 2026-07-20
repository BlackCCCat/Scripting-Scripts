import { NavigationStack, List, Section, Button, Text, Toolbar, ToolbarItem, useState, Image } from 'scripting'
import { Person, AnniversaryEvent } from '../types'
import { PersonCard, EmptyState } from '../components'

// 分组排序：内置关系按此顺序，自定义关系排在后面
const GROUP_ORDER = ['自己', '伴侣', '子女', '家人', '朋友', '同学', '同事', '其他']

interface PeoplePageProps {
  persons: Person[]
  events: AnniversaryEvent[]
  onClose: () => void
  onSelectPerson: (person: Person) => void
  onAddPerson: () => void
  onDeletePerson: (person: Person) => void
  onTogglePinPerson: (person: Person) => void
}

export function PeoplePage({ persons, events, onClose, onSelectPerson, onAddPerson, onDeletePerson, onTogglePinPerson }: PeoplePageProps) {
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)

  const requestDeletePerson = (person: Person) => {
    setPersonToDelete(person)
    setShowDeleteAlert(true)
  }

  const confirmDeletePerson = () => {
    setShowDeleteAlert(false)
    if (personToDelete) {
      onDeletePerson(personToDelete)
      setPersonToDelete(null)
    }
  }

  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, 'zh-CN')
  const pinned = [...persons].filter(p => p.isPinned).sort(byName)
  const unpinned = [...persons].filter(p => !p.isPinned).sort(byName)

  // 按关系分组：自定义关系统一归入“其他”
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

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="人物"
        navigationBarTitleDisplayMode="large"
        scrollIndicator="hidden"
        alert={{
          title: '删除人物',
          message: <Text>确定要删除「{personToDelete?.name ?? ''}」吗？相关时光纪念也会被一并删除。</Text>,
          isPresented: showDeleteAlert,
          onChanged: setShowDeleteAlert,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => setShowDeleteAlert(false)} />
              <Button title="删除" role="destructive" action={confirmDeletePerson} />
            </>
          )
        }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="关闭" action={onClose}>
                <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button
                title="添加"
                systemImage="person.badge.plus"
                fontWeight="semibold"
                action={onAddPerson}
              />
            </ToolbarItem>
          </Toolbar>
        }
      >
        {persons.length === 0 ? (
          <EmptyState
            title="还没有人物"
            subtitle="点击右上角添加重要的人"
            systemImage="person.2"
          />
        ) : (
          <>
            {pinned.length > 0 && (
              <Section title="置顶">
                {pinned.map(person => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    eventCount={events.filter(e => e.personId === person.id).length}
                    onSelected={() => onSelectPerson(person)}
                    onDelete={() => requestDeletePerson(person)}
                    onTogglePin={() => onTogglePinPerson(person)}
                  />
                ))}
              </Section>
            )}
            {groupKeys.map(key => (
              <Section key={key} title={key}>
                {grouped[key].map(person => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    eventCount={events.filter(e => e.personId === person.id).length}
                    onSelected={() => onSelectPerson(person)}
                    onDelete={() => requestDeletePerson(person)}
                    onTogglePin={() => onTogglePinPerson(person)}
                  />
                ))}
              </Section>
            ))}
          </>
        )}
      </List>
    </NavigationStack>
  )
}
