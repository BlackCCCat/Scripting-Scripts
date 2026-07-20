import { NavigationStack, List, Section, Text, Button, HStack, VStack, Spacer, Toolbar, ToolbarItem, Navigation, useState, useEffect, Image } from 'scripting'
import { Person, AnniversaryEvent } from '../types'
import { Avatar, CompactEventRow, EmptyState, RelationshipTag } from '../components'
import { getNextOccurrence } from '../dateUtils'

interface PersonDetailPageProps {
  person: Person
  // 数据 Observable，使详情页在父级数据变化时自动刷新
  persons?: Observable<Person[]>
  events?: Observable<AnniversaryEvent[]>
  onEdit: () => void
  onAddEvent: () => void
  onEditEvent: (event: AnniversaryEvent) => void
  onDeletePerson: () => void
}

export function PersonDetailPage({
  person,
  persons,
  events,
  onEdit,
  onAddEvent,
  onEditEvent,
  onDeletePerson
}: PersonDetailPageProps) {
  const dismiss = Navigation.useDismiss()
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)

  // 直接从 Observable 读取最新数据，保证页面实时刷新
  const livePerson = persons?.value.find(p => p.id === person.id) ?? person
  const personEvents = (events?.value ?? [])
    .filter(e => e.personId === livePerson.id)
    .sort((a, b) => {
      const da = getNextOccurrence(a)
      const db = getNextOccurrence(b)
      if (!da || !db) return 0
      return da.getTime() - db.getTime()
    })

  // 若当前人物已不存在，则自动关闭详情页
  useEffect(() => {
    if (!persons?.value.find(p => p.id === person.id)) {
      dismiss()
    }
  }, [persons?.value, person.id])

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle={livePerson.name}
        navigationBarTitleDisplayMode="inline"
        scrollIndicator="hidden"
        alert={{
          title: '删除人物',
          message: <Text>确定要删除「{livePerson.name}」吗？相关时光纪念也会被一并删除。</Text>,
          isPresented: showDeleteAlert,
          onChanged: setShowDeleteAlert,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => setShowDeleteAlert(false)} />
              <Button
                title="删除"
                role="destructive"
                action={() => { setShowDeleteAlert(false); onDeletePerson() }}
              />
            </>
          )
        }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="返回" action={dismiss}>
                <Image systemName="chevron.down" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button title="编辑" systemImage="square.and.pencil" fontWeight="semibold" action={onEdit} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section>
          <HStack spacing={16} padding={16} frame={{ maxWidth: Infinity }} alignment="center">
            <Avatar person={livePerson} size={86} />
            <VStack alignment="leading" spacing={4}>
              <Text fontWeight="bold" font={24}>{livePerson.name}</Text>
              <RelationshipTag relationship={livePerson.relationship} />
              <Text foregroundStyle="secondaryLabel" font={15}>
                {personEvents.length > 0 ? `${personEvents.length} 个时光纪念` : '暂无时光纪念'}
              </Text>
            </VStack>
            <Spacer />
          </HStack>
          {livePerson.notes ? <Text padding={{ horizontal: 16, bottom: 16 }} foregroundStyle="secondaryLabel">{livePerson.notes}</Text> : null}
        </Section>

        <Section
          header={<Text fontWeight="semibold" padding={{ leading: 16 }}>时光纪念</Text>}
          footer={
            <HStack frame={{ maxWidth: Infinity }} padding={{ top: 8 }}>
              <Button title="添加时光纪念" systemImage="plus.circle" action={onAddEvent} />
            </HStack>
          }
        >
          {personEvents.length === 0 ? (
            <EmptyState
              title="还没有时光纪念"
              subtitle="点击下方按钮添加"
              systemImage="heart.text.square"
            />
          ) : (
            personEvents.map(event => (
              <CompactEventRow
                key={event.id}
                event={event}
                onSelected={() => onEditEvent(event)}
              />
            ))
          )}
        </Section>

        <Section>
          <HStack frame={{ maxWidth: Infinity }} alignment="center">
            <Button title="删除人物" role="destructive" action={() => setShowDeleteAlert(true)} />
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}
