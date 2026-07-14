// Scripting 组件与 API：
// - Form/Section/ColorPicker/Toggle 用于系统原生设置页
// - Navigation 用于关闭页面并把最新设置返回首页
import {
  Button,
  ColorPicker,
  DisclosureGroup,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"

// 全局设置持久化
import {
  DEFAULT_THEME_COLOR,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "../utils/settings"

export function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const [settings, setSettings] = useState<AppSettings>({
    selectedCalendarSourceIds: [],
    themeColor: DEFAULT_THEME_COLOR,
  })
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [sourcesExpanded, setSourcesExpanded] = useState(true)

  useEffect(() => {
    void loadInitialSettings()
  }, [])

  async function loadInitialSettings() {
    try {
      const data = await loadSettings()
      const list = Calendar.getSources?.() ?? []
      const availableIds = list.map((src) => src.identifier)
      const savedIds = data.selectedCalendarSourceIds ?? []
      const savedAvailableIds = savedIds.filter((id) => availableIds.includes(id))
      const selectedCalendarSourceIds =
        savedAvailableIds.length > 0
          ? savedAvailableIds
          : availableIds
      const next = {
        ...data,
        selectedCalendarSourceIds,
        themeColor: data.themeColor || DEFAULT_THEME_COLOR,
      }
      setSources(list)
      setSettings(next)
      await saveSettings(next)
    } catch {
      setSources([])
    }
  }

  async function persist(next: AppSettings) {
    setSettings(next)
    await saveSettings(next)
  }

  async function toggleSource(sourceId: string, enabled: boolean) {
    const selected = settings.selectedCalendarSourceIds
    if (!enabled && selected.length <= 1 && selected.includes(sourceId)) {
      await Dialog.alert({ message: "至少选择一个日历账户" })
      return
    }
    const selectedCalendarSourceIds = enabled
      ? selected.includes(sourceId)
        ? selected
        : [...selected, sourceId]
      : selected.filter((id) => id !== sourceId)
    HapticFeedback.heavyImpact()
    await persist({ ...settings, selectedCalendarSourceIds })
  }

  async function updateThemeColor(themeColor: string) {
    HapticFeedback.heavyImpact()
    await persist({ ...settings, themeColor })
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: (
            <Button title="完成" action={() => dismiss(settings)} />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>外观</Text>}>
            <ColorPicker
              title="主题色"
              value={settings.themeColor as any}
              supportsOpacity={false}
              onChanged={(value) => void updateThemeColor(String(value))}
            />
            <Button
              title="恢复默认主题色"
              action={() => void updateThemeColor(DEFAULT_THEME_COLOR)}
            />
          </Section>

          <Section header={<Text>日历账户</Text>}>
            <DisclosureGroup
              label={
                <HStack>
                  <Text>可用账户</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">
                    已选 {settings.selectedCalendarSourceIds.length}/{sources.length}
                  </Text>
                </HStack>
              }
              isExpanded={sourcesExpanded}
              onChanged={(value: boolean) => {
                HapticFeedback.heavyImpact()
                setSourcesExpanded(value)
              }}
            >
              {sources.length ? (
                sources.map((src) => (
                  <Toggle
                    key={src.identifier}
                    value={settings.selectedCalendarSourceIds.includes(src.identifier)}
                    onChanged={(value: boolean) => void toggleSource(src.identifier, value)}
                    toggleStyle="switch"
                  >
                    <Text>{src.title}</Text>
                  </Toggle>
                ))
              ) : (
                <Text foregroundStyle="secondaryLabel">暂无日历账户</Text>
              )}
            </DisclosureGroup>
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
