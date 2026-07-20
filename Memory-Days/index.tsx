import { Script, Navigation, TabView, VStack, Text, Image, useObservable, useEffect, Widget } from 'scripting'
import { Person, AnniversaryEvent, AppData, AppSettings } from './types'
import { exportAppData, importAppData, loadAppData, saveAppData, generateId, deleteAvatar, setAppDataStorageMode } from './storage'
import { refreshNotifications } from './notifications'
import { HomePage } from './pages/HomePage'
import { PeoplePage } from './pages/PeoplePage'
import { SettingsPage } from './pages/SettingsPage'
import { PersonDetailPage } from './pages/PersonDetailPage'
import { PersonEditorPage } from './pages/PersonEditorPage'
import { EventEditorPage } from './pages/EventEditorPage'

function MainView() {
  const dismiss = Navigation.useDismiss()
  const persons = useObservable<Person[]>([])
  const events = useObservable<AnniversaryEvent[]>([])
  const settings = useObservable<AppSettings>({
    defaultReminderDays: [1, 3],
    defaultRemindOnDay: true,
    notificationsEnabled: true,
    groupPastEvents: true,
    iCloudSyncEnabled: false,
    notificationHour: 9,
    notificationMinute: 0
  })
  const isLoading = useObservable(true)
  const selectedTab = useObservable(0)

  // 加载数据
  useEffect(() => {
    loadAppData().then((data: import('./types').AppData) => {
      persons.setValue(data.persons)
      events.setValue(data.events)
      settings.setValue(data.settings)
      isLoading.setValue(false)
      // 首次加载后刷新通知
      refreshNotifications(data.events, data.persons, data.settings)
    })
  }, [])

  // 持久化、刷新小组件与通知
  const commit = async (newPersons?: Person[], newEvents?: AnniversaryEvent[], newSettings?: AppSettings) => {
    const payload: AppData = {
      persons: newPersons ?? persons.value,
      events: newEvents ?? events.value,
      settings: newSettings ?? settings.value,
      version: 1
    }
    await saveAppData(payload)
    // 数据保存后立即请求刷新所有小组件，不等通知调度完成
    Widget.reloadAll()
    try {
      await refreshNotifications(payload.events, payload.persons, payload.settings)
    } catch (err) {
      console.log('刷新通知失败:', err)
    }
  }

  const handleSavePerson = async (person: Person) => {
    const list = [...persons.value]
    if (person.id) {
      const idx = list.findIndex(p => p.id === person.id)
      if (idx >= 0) list[idx] = person
    } else {
      person.id = generateId()
      list.push(person)
    }
    persons.setValue(list)
    await commit(list, undefined, undefined)
  }

  const handleDeletePerson = async (person: Person) => {
    const removedEvents = events.value.filter(e => e.personId === person.id)
    const newEvents = events.value.filter(e => e.personId !== person.id)
    const newPersons = persons.value.filter(p => p.id !== person.id)
    persons.setValue(newPersons)
    events.setValue(newEvents)
    await deleteAvatar(person.avatarPath)
    const removedPhotoPaths = Array.from(new Set(removedEvents.map(e => e.photoPath).filter(Boolean))) as string[]
    for (const path of removedPhotoPaths) {
      if (!newEvents.some(e => e.photoPath === path)) {
        await deleteAvatar(path)
      }
    }
    await commit(newPersons, newEvents, undefined)
  }

  const handleSaveEvent = async (eventOrEvents: AnniversaryEvent | AnniversaryEvent[]) => {
    const list = [...events.value]
    const incoming = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]
    for (const event of incoming) {
      if (event.id) {
        const idx = list.findIndex(e => e.id === event.id)
        if (idx >= 0) {
          const previousPhotoPath = list[idx].photoPath ?? null
          list[idx] = event
          if (
            previousPhotoPath &&
            previousPhotoPath !== (event.photoPath ?? null) &&
            !list.some(other => other.id !== event.id && other.photoPath === previousPhotoPath)
          ) {
            await deleteAvatar(previousPhotoPath)
          }
        }
      } else {
        event.id = generateId()
        list.push(event)
      }
    }
    events.setValue(list)
    await commit(undefined, list, undefined)
  }

  const handleDeleteEvent = async (event: AnniversaryEvent) => {
    const list = events.value.filter(e => e.id !== event.id)
    events.setValue(list)
    if (event.photoPath && !list.some(e => e.photoPath === event.photoPath)) {
      await deleteAvatar(event.photoPath)
    }
    // commit 内部会调用 refreshNotifications 清除全部通知并重建，无需单独删除
    await commit(undefined, list, undefined)
  }

  const handleTogglePinEvent = async (event: AnniversaryEvent) => {
    const list = events.value.map(e =>
      e.id === event.id ? { ...e, isPinned: !e.isPinned } : e
    )
    events.setValue(list)
    await commit(undefined, list, undefined)
  }

  const handleToggleCountdownFormatEvent = async (event: AnniversaryEvent) => {
    const list = events.value.map(e =>
      e.id === event.id ? { ...e, showYearsAndDays: !e.showYearsAndDays } : e
    )
    events.setValue(list)
    await commit(undefined, list, undefined)
  }

  const handleTogglePinPerson = async (person: Person) => {
    const list = persons.value.map(p =>
      p.id === person.id ? { ...p, isPinned: !p.isPinned } : p
    )
    persons.setValue(list)
    await commit(list, undefined, undefined)
  }

  const handleClearAll = async () => {
    for (const person of persons.value) {
      await deleteAvatar(person.avatarPath)
    }
    const photoPaths = Array.from(new Set(events.value.map(event => event.photoPath).filter(Boolean))) as string[]
    for (const path of photoPaths) {
      await deleteAvatar(path)
    }
    persons.setValue([])
    events.setValue([])
    await commit([], [], settings.value)
  }

  const handleSettingsChange = async (newSettings: AppSettings) => {
    const previousICloud = !!settings.value.iCloudSyncEnabled
    const nextICloud = !!newSettings.iCloudSyncEnabled
    if (previousICloud !== nextICloud) {
      const payload: AppData = {
        persons: persons.value,
        events: events.value,
        settings: newSettings,
        version: 1
      }
      const migrated = await setAppDataStorageMode(nextICloud, payload)
      persons.setValue(migrated.persons)
      events.setValue(migrated.events)
      settings.setValue(migrated.settings)
      Widget.reloadAll()
      await refreshNotifications(migrated.events, migrated.persons, migrated.settings)
      return
    }
    settings.setValue(newSettings)
    await commit(undefined, undefined, newSettings)
  }

  const handleExportData = async () => {
    return await exportAppData({
      persons: persons.value,
      events: events.value,
      settings: settings.value,
      version: 1
    })
  }

  const handleImportData = async () => {
    const result = await importAppData({
      persons: persons.value,
      events: events.value,
      settings: settings.value,
      version: 1
    })
    persons.setValue(result.data.persons)
    events.setValue(result.data.events)
    settings.setValue(result.data.settings)
    await commit(result.data.persons, result.data.events, result.data.settings)
    return result
  }

  // 呈现人物编辑器
  const presentPersonEditor = (person?: Person) => {
    Navigation.present(
      <PersonEditorPage
        person={person}
        onSave={handleSavePerson}
      />
    )
  }

  // 呈现时光纪念编辑器
  const presentEventEditor = (person: Person, event?: AnniversaryEvent) => {
    const largeEvents = event?.largeGroupId
      ? events.value
        .filter(e => e.largeGroupId === event.largeGroupId)
        .sort((a, b) => {
          const indexA = a.largePartIndex
          const indexB = b.largePartIndex
          if (typeof indexA === 'number' && typeof indexB === 'number' && indexA !== indexB) return indexA - indexB
          if (typeof indexA === 'number' && typeof indexB !== 'number') return -1
          if (typeof indexA !== 'number' && typeof indexB === 'number') return 1
          return a.createdAt - b.createdAt
        })
      : []
    const firstEvent = largeEvents[0] ?? event
    const pairedEvent = largeEvents.length > 1 ? largeEvents[1] : undefined
    const firstPerson = firstEvent
      ? persons.value.find(p => p.id === firstEvent.personId) ?? person
      : person
    const pairedPerson = pairedEvent
      ? persons.value.find(p => p.id === pairedEvent.personId)
      : undefined
    Navigation.present(
      <EventEditorPage
        event={firstEvent}
        pairedEvent={pairedEvent}
        person={firstPerson}
        secondPerson={pairedPerson}
        settings={settings.value}
        onSave={handleSaveEvent}
        onDelete={event ? async (target) => {
          const targets = Array.isArray(target) ? target : [target]
          for (const item of targets) {
            await handleDeleteEvent(item)
          }
        } : undefined}
      />
    )
  }

  // 新建人物并继续添加时光纪念
  const presentNewPersonForEvent = async (): Promise<Person | void> => {
    return await Navigation.present<Person>(
      <PersonEditorPage
        person={undefined}
        onSave={handleSavePerson}
      />
    )
  }

  // 呈现人物详情页（传入 Observable，使详情页可订阅实时刷新）
  const presentPersonDetail = (person: Person) => {
    Navigation.present(
      <PersonDetailPage
        person={person}
        persons={persons}
        events={events}
        onEdit={() => presentPersonEditor(persons.value.find(p => p.id === person.id) ?? person)}
        onAddEvent={() => presentEventEditor(persons.value.find(p => p.id === person.id) ?? person)}
        onEditEvent={(event) => {
          const latestPerson = persons.value.find(p => p.id === person.id) ?? person
          const latestEvent = events.value.find(e => e.id === event.id) ?? event
          presentEventEditor(latestPerson, latestEvent)
        }}
        onDeletePerson={() => handleDeletePerson(person)}
      />
    )
  }

  if (isLoading.value) {
    return (
      <TabView tabIndex={selectedTab.value}>
        <Text>加载中…</Text>
      </TabView>
    )
  }

  return (
    <TabView tabIndex={selectedTab.value}>
      <VStack tabItem={<><Image systemName="heart.text.square.fill" font={20} /><Text>时光纪念</Text></>} tag={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <HomePage
          events={events.value}
          persons={persons.value}
          settings={settings.value}
          onClose={dismiss}
          onSelectEvent={(event: AnniversaryEvent) => {
            const person = persons.value.find((p: Person) => p.id === event.personId)
            if (person) presentEventEditor(person, event)
          }}
          onDeleteEvent={handleDeleteEvent}
          onTogglePinEvent={handleTogglePinEvent}
          onToggleCountdownFormatEvent={handleToggleCountdownFormatEvent}
          onSaveEvent={handleSaveEvent}
          onCreatePersonForEvent={presentNewPersonForEvent}
        />
      </VStack>
      <VStack tabItem={<><Image systemName="person.2.fill" font={20} /><Text>人物</Text></>} tag={1} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <PeoplePage
          persons={persons.value}
          events={events.value}
          onClose={dismiss}
          onSelectPerson={presentPersonDetail}
          onAddPerson={() => presentPersonEditor()}
          onDeletePerson={handleDeletePerson}
          onTogglePinPerson={handleTogglePinPerson}
        />
      </VStack>
      <VStack tabItem={<><Image systemName="gearshape.fill" font={20} /><Text>设置</Text></>} tag={2} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <SettingsPage
          settings={settings.value}
          onClose={dismiss}
          onSettingsChange={handleSettingsChange}
          onClearAllData={handleClearAll}
          onExportData={handleExportData}
          onImportData={handleImportData}
        />
      </VStack>
    </TabView>
  )
}

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
