import { NavigationStack, List, Section, Button, Text, Toolbar, ToolbarItem, useObservable, Image, Toggle, DatePicker } from 'scripting'
import { AppSettings } from '../types'
import { DataExportResult, DataImportResult } from '../storage'

interface SettingsPageProps {
  settings: AppSettings
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void | Promise<void>
  onClearAllData: () => void
  onExportData: () => Promise<DataExportResult>
  onImportData: () => Promise<DataImportResult>
}

export function SettingsPage({ settings, onClose, onSettingsChange, onClearAllData, onExportData, onImportData }: SettingsPageProps) {
  const showAlert = useObservable(false)
  const busyAction = useObservable<'icloud' | 'export' | 'import' | null>(null)
  const dataStatus = useObservable('')

  const handleToggleGroupPastEvents = (enabled: boolean) => {
    onSettingsChange({ ...settings, groupPastEvents: enabled })
  }

  const handleNotificationTimeChange = (value: number) => {
    const date = new Date(value)
    onSettingsChange({ ...settings, notificationHour: date.getHours(), notificationMinute: date.getMinutes() })
  }

  const handleClear = () => {
    showAlert.setValue(false)
    onClearAllData()
  }

  const handleICloudSyncChange = async (enabled: boolean) => {
    if (busyAction.value) return
    busyAction.setValue('icloud')
    dataStatus.setValue(enabled ? '正在迁移到 iCloud…' : '正在迁移到本地存储…')
    try {
      await onSettingsChange({ ...settings, iCloudSyncEnabled: enabled })
      dataStatus.setValue(enabled ? '当前数据已保存到 iCloud。' : '当前数据已保存到本地独立存储。')
    } catch (err) {
      dataStatus.setValue('')
      await Dialog.alert({
        title: enabled ? '开启 iCloud 同步失败' : '关闭 iCloud 同步失败',
        message: String((err as Error)?.message ?? err)
      })
    } finally {
      busyAction.setValue(null)
    }
  }

  const handleExportData = async () => {
    if (busyAction.value) return
    busyAction.setValue('export')
    dataStatus.setValue('正在导出数据…')
    try {
      const result = await onExportData()
      dataStatus.setValue(`已导出 ${result.persons} 位人物、${result.events} 条时光纪念。`)
      await Dialog.alert({
        title: '导出完成',
        message: `已导出 ${result.persons} 位人物、${result.events} 条时光纪念、${result.assets} 张照片。\n${result.path}`
      })
    } catch (err) {
      const message = String((err as Error)?.message ?? err)
      if (!message.startsWith('未选择')) {
        await Dialog.alert({ title: '导出失败', message })
      }
      dataStatus.setValue('')
    } finally {
      busyAction.setValue(null)
    }
  }

  const handleImportData = async () => {
    if (busyAction.value) return
    busyAction.setValue('import')
    dataStatus.setValue('正在导入数据…')
    try {
      const result = await onImportData()
      dataStatus.setValue(`已新增 ${result.persons} 位人物、${result.events} 条时光纪念。`)
      await Dialog.alert({
        title: '导入完成',
        message: `已新增 ${result.persons} 位人物、${result.events} 条时光纪念、${result.assets} 张照片。\n${result.path}`
      })
    } catch (err) {
      const message = String((err as Error)?.message ?? err)
      if (!message.startsWith('未选择')) {
        await Dialog.alert({ title: '导入失败', message })
      }
      dataStatus.setValue('')
    } finally {
      busyAction.setValue(null)
    }
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="设置"
        navigationBarTitleDisplayMode="large"
        scrollIndicator="hidden"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="关闭" action={onClose}>
                <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
        alert={{
          title: '清除所有数据',
          message: <Text>这将删除所有人物、时光纪念与头像，且无法恢复。</Text>,
          isPresented: showAlert,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => showAlert.setValue(false)} />
              <Button title="清除" role="destructive" action={handleClear} />
            </>
          )
        }}
      >
        <Section title="通知">
          <DatePicker
            title="提醒时间"
            value={new Date(2000, 0, 1, settings.notificationHour ?? 9, settings.notificationMinute ?? 0).getTime()}
            onChanged={handleNotificationTimeChange}
            displayedComponents={['hourAndMinute']}
          />
        </Section>
        <Section title="列表">
          <Toggle
            title="已过的时光纪念归入「时光纪念」分组"
            value={settings.groupPastEvents}
            onChanged={handleToggleGroupPastEvents}
          />
        </Section>
        <Section title="数据">
          <Toggle
            title={busyAction.value === 'icloud' ? '正在切换 iCloud 同步' : 'iCloud 同步'}
            value={settings.iCloudSyncEnabled}
            onChanged={handleICloudSyncChange}
          />
          <Button
            title={busyAction.value === 'export' ? '导出中…' : '导出数据'}
            systemImage="square.and.arrow.up"
            action={handleExportData}
          />
          <Button
            title={busyAction.value === 'import' ? '导入中…' : '导入数据'}
            systemImage="square.and.arrow.down"
            action={handleImportData}
          />
          {dataStatus.value ? <Text foregroundStyle="secondaryLabel" font={13}>{dataStatus.value}</Text> : null}
          <Button title="清除所有数据" systemImage="trash" foregroundStyle="red" action={() => showAlert.setValue(true)} />
        </Section>
      </List>
    </NavigationStack>
  )
}
