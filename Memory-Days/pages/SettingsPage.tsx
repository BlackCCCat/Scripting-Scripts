import { NavigationStack, List, Section, Button, Text, Toolbar, ToolbarItem, useObservable, Image, HStack, Toggle, DatePicker } from 'scripting'
import { AppSettings } from '../types'

interface SettingsPageProps {
  settings: AppSettings
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  onClearAllData: () => void
}

export function SettingsPage({ settings, onClose, onSettingsChange, onClearAllData }: SettingsPageProps) {
  const showAlert = useObservable(false)

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
          <HStack frame={{ maxWidth: Infinity }} alignment="center">
            <Button title="清除所有数据" systemImage="trash" foregroundStyle="red" action={() => showAlert.setValue(true)} />
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}
