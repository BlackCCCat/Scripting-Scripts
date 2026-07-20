import { NavigationStack, List, Section, Text, Button, Toolbar, ToolbarItem, useState, Image, EmptyView } from 'scripting'
import { AnniversaryEvent, Person, AppSettings, AnniversaryWidgetSize, OccurrenceInfo } from '../types'
import { AnniversaryLargeWidgetCard, AnniversaryWidgetCard, EmptyState } from '../components'
import { buildOccurrenceList } from '../dateUtils'
import { AddEventFlowPage } from './AddEventFlowPage'

interface HomePageProps {
  events: AnniversaryEvent[]
  persons: Person[]
  settings: AppSettings
  onClose: () => void
  onSelectEvent: (event: AnniversaryEvent) => void
  onDeleteEvent: (event: AnniversaryEvent) => void | Promise<void>
  onTogglePinEvent: (event: AnniversaryEvent) => void
  onToggleCountdownFormatEvent: (event: AnniversaryEvent) => void
  onSaveEvent: (event: AnniversaryEvent | AnniversaryEvent[]) => void | Promise<void>
  onCreatePersonForEvent: () => Promise<Person | void>
}

const SIZE_SECTIONS: { size: AnniversaryWidgetSize; title: string; emptyText: string }[] = [
  { size: 'systemLarge', title: '大', emptyText: '暂无大卡片时光纪念' },
  { size: 'systemMedium', title: '中', emptyText: '暂无中卡片时光纪念' },
  { size: 'systemSmall', title: '小', emptyText: '暂无小卡片时光纪念' }
]

function getEventWidgetSize(event: AnniversaryEvent): AnniversaryWidgetSize {
  return event.widgetSize ?? 'systemMedium'
}

function getSingleWidgetCardSize(size: AnniversaryWidgetSize): Exclude<AnniversaryWidgetSize, 'systemLarge'> {
  return size === 'systemMedium' ? 'systemMedium' : 'systemSmall'
}

function sortOccurrences(items: OccurrenceInfo[]): OccurrenceInfo[] {
  return [...items].sort((a, b) => {
    const pinnedA = !!a.event.isPinned
    const pinnedB = !!b.event.isPinned
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1

    const pastA = a.daysLeft < 0
    const pastB = b.daysLeft < 0
    if (pastA !== pastB) return pastA ? 1 : -1
    if (pastA && pastB) return b.nextDate.getTime() - a.nextDate.getTime()
    return a.daysLeft - b.daysLeft
  })
}

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = []
  for (let index = 0; index < items.length; index += 2) {
    pairs.push(items.slice(index, index + 2))
  }
  return pairs
}

function compareLargePartOrder(a: OccurrenceInfo, b: OccurrenceInfo): number {
  const indexA = a.event.largePartIndex
  const indexB = b.event.largePartIndex
  if (typeof indexA === 'number' && typeof indexB === 'number' && indexA !== indexB) return indexA - indexB
  if (typeof indexA === 'number' && typeof indexB !== 'number') return -1
  if (typeof indexA !== 'number' && typeof indexB === 'number') return 1
  return a.event.createdAt - b.event.createdAt
}

function groupLargeOccurrences(items: OccurrenceInfo[]): OccurrenceInfo[][] {
  const grouped = new Map<string, OccurrenceInfo[]>()
  const ungrouped: OccurrenceInfo[] = []

  for (const item of items) {
    const groupId = item.event.largeGroupId
    if (!groupId) {
      ungrouped.push(item)
      continue
    }
    const group = grouped.get(groupId) ?? []
    group.push(item)
    grouped.set(groupId, group)
  }

  const groups = Array.from(grouped.values()).map(group => [...group].sort(compareLargePartOrder))
  return [...groups, ...chunkPairs(ungrouped)]
}

export function HomePage({ events, persons, settings, onClose, onSelectEvent, onDeleteEvent, onTogglePinEvent, onToggleCountdownFormatEvent, onSaveEvent, onCreatePersonForEvent }: HomePageProps) {
  const [eventsToDelete, setEventsToDelete] = useState<AnniversaryEvent[]>([])
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [showAddFlow, setShowAddFlow] = useState(false)

  const requestDeleteEvent = (event: AnniversaryEvent) => {
    setEventsToDelete([event])
    setShowDeleteAlert(true)
  }

  const requestDeleteEvents = (items: OccurrenceInfo[]) => {
    setEventsToDelete(items.map(item => item.event))
    setShowDeleteAlert(true)
  }

  const confirmDeleteEvent = async () => {
    setShowDeleteAlert(false)
    if (eventsToDelete.length > 0) {
      for (const event of eventsToDelete) {
        await onDeleteEvent(event)
      }
      setEventsToDelete([])
    }
  }

  const occurrences = buildOccurrenceList(
    events,
    (id) => persons.find(p => p.id === id),
    new Date()
  )
  const visibleOccurrences = settings.groupPastEvents
    ? occurrences
    : occurrences.filter(item => item.daysLeft >= 0)

  const groupedBySize = SIZE_SECTIONS.reduce((acc, section) => {
    acc[section.size] = sortOccurrences(
      visibleOccurrences.filter(item => getEventWidgetSize(item.event) === section.size)
    )
    return acc
  }, {} as Record<AnniversaryWidgetSize, OccurrenceInfo[]>)

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="时光纪念"
        navigationBarTitleDisplayMode="large"
        scrollIndicator="hidden"
        listRowSpacing={10}
        listRowSeparator={{ visibility: 'hidden', edges: 'all' as any }}
        listSectionSeparator={{ visibility: 'hidden', edges: 'all' as any }}
        navigationDestination={{
          isPresented: showAddFlow,
          onChanged: (value) => {
            if (!value) setShowAddFlow(false)
          },
          content: (
            <AddEventFlowPage
              persons={persons}
              settings={settings}
              onSave={onSaveEvent}
              onCreatePerson={onCreatePersonForEvent}
            />
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
                key="添加时光纪念"
                action={() => setShowAddFlow(true)}
              >
                <Image systemName="plus" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
        alert={{
          title: '删除时光纪念',
          message: <Text>{eventsToDelete.length > 1 ? '确定要删除这张大卡片里的时光纪念吗？' : '确定要删除这条时光纪念吗？'}</Text>,
          isPresented: showDeleteAlert,
          onChanged: setShowDeleteAlert,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => setShowDeleteAlert(false)} />
              <Button title="删除" role="destructive" action={confirmDeleteEvent} />
            </>
          )
        }}
      >
        {visibleOccurrences.length === 0 ? (
          <EmptyState
            title="还没有时光纪念"
            subtitle="点击右上角添加重要的人与日子"
            systemImage="heart.text.square"
          />
        ) : (
          <>
            {SIZE_SECTIONS.map(section => (
              <Section key={section.size} title={section.title}>
                {groupedBySize[section.size].length > 0 ? (
                  section.size === 'systemLarge' ? (
                    groupLargeOccurrences(groupedBySize[section.size]).map(group => (
                      <AnniversaryLargeWidgetCard
                        key={group.map(item => item.event.id).join('-')}
                        items={group}
                        onSelected={onSelectEvent}
                        onDelete={() => requestDeleteEvents(group)}
                        onTogglePin={onTogglePinEvent}
                        onToggleCountdownFormat={onToggleCountdownFormatEvent}
                      />
                    ))
                  ) : (
                    groupedBySize[section.size].map(item => (
                      <AnniversaryWidgetCard
                        key={item.event.id}
                        item={item}
                        size={getSingleWidgetCardSize(section.size)}
                        onSelected={() => onSelectEvent(item.event)}
                        onDelete={() => requestDeleteEvent(item.event)}
                        onTogglePin={() => onTogglePinEvent(item.event)}
                        onToggleCountdownFormat={() => onToggleCountdownFormatEvent(item.event)}
                      />
                    ))
                  )
                ) : (
                  <Text
                    foregroundStyle="tertiaryLabel"
                    font={14}
                    padding={{ vertical: 12, horizontal: 8 }}
                    listRowBackground={<EmptyView />}
                  >
                    {section.emptyText}
                  </Text>
                )}
              </Section>
            ))}
          </>
        )}
      </List>
    </NavigationStack>
  )
}
