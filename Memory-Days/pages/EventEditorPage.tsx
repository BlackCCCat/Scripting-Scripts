import { Navigation, NavigationStack, List, Section, Picker, Toggle, Stepper, Button, Text, HStack, VStack, Spacer, DatePicker, GeometryReader, Toolbar, ToolbarItem, Image, Divider } from 'scripting'
import { useState } from 'scripting'
import { AnniversaryEvent, Person, EventType, AppSettings, AnniversaryWidgetSize, AnniversaryAvatarShape, AnniversaryAvatarPosition } from '../types'
import { Avatar, FormRow, RelationshipTag } from '../components'
import { formatDateKey, formatDateCN, parseDateKey, getLunarParts, findGregorianDateForLunar, LUNAR_MONTH_NAMES, LUNAR_DAY_NAMES, getLunarYearGanZhi } from '../dateUtils'
import { deleteAvatar } from '../storage'
import { replaceDraftPhoto } from '../photoUtils'
import { pickAndCropPhoto } from './PhotoCropPage'

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  birthday: '生日',
  meet: '相识',
  love: '恋爱',
  wedding: '结婚',
  enrollment: '入学',
  graduation: '毕业',
  join: '入职',
  custom: '其他'
}

// 各人物关系对应的可选时光纪念内置类型
const RELATIONSHIP_EVENT_TYPES: Record<string, EventType[]> = {
  '自己': ['birthday', 'enrollment', 'graduation', 'join'],
  '伴侣': ['birthday', 'meet', 'love', 'wedding'],
  '子女': ['birthday', 'enrollment', 'graduation'],
  '家人': ['birthday'],
  '朋友': ['birthday', 'meet'],
  '同学': ['birthday', 'meet', 'graduation'],
  '同事': ['birthday', 'meet', 'join'],
  '其他': ['birthday', 'meet']
}

// 根据人物关系生成类型选项，始终保留“其他”和当前编辑的类型
function getEventTypeOptions(person: Person, currentType?: EventType): { value: EventType; label: string }[] {
  // 自定义关系（不在映射中的值）使用“其他”的过滤规则
  const allowed = RELATIONSHIP_EVENT_TYPES[person.relationship ?? ''] ??
    RELATIONSHIP_EVENT_TYPES['其他'] ??
    ['birthday']
  const merged = new Set<EventType>([...allowed, 'custom'])
  if (currentType && !merged.has(currentType)) {
    merged.add(currentType)
  }
  return Array.from(merged).map(value => ({ value, label: EVENT_TYPE_LABELS[value] }))
}

interface EventEditorPageProps {
  event?: AnniversaryEvent
  pairedEvent?: AnniversaryEvent
  person: Person
  secondPerson?: Person
  settings: AppSettings
  initialWidgetSize?: AnniversaryWidgetSize
  onSave: (event: AnniversaryEvent | AnniversaryEvent[]) => void | Promise<void>
  onDelete?: (event: AnniversaryEvent | AnniversaryEvent[]) => void | Promise<void>
  embedded?: boolean
  onCancel?: () => void
}

export function EventEditorPage({ event, pairedEvent, person, secondPerson, settings, initialWidgetSize, onSave, onDelete, embedded = false, onCancel }: EventEditorPageProps) {
  const dismiss = Navigation.useDismiss()
  const isNew = !event
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)

  const handleDelete = async () => {
    setShowDeleteAlert(false)
    if (event && onDelete) {
      if (photoPath && photoPath !== event.photoPath) {
        await deleteAvatar(photoPath)
      }
      if (secondPhotoPath && secondPhotoPath !== pairedEvent?.photoPath) {
        await deleteAvatar(secondPhotoPath)
      }
      await onDelete(pairedEvent ? [event, pairedEvent] : event)
      if (!embedded) dismiss()
    }
  }
  const today = new Date()
  const currentYear = today.getFullYear()

  // 初始化编辑状态
  const initialRef = event ? new Date(event.gregorianDate) : today
  const initialLunarParts = getLunarParts(initialRef)
  const initialLunar = event?.isLunar && event.lunarMonth && event.lunarDay
    ? {
      year: event.lunarYear ?? initialLunarParts.year,
      month: event.lunarMonth,
      day: event.lunarDay,
      isLeap: event.isLeapMonth
    }
    : {
      year: initialLunarParts.year,
      month: initialLunarParts.month,
      day: initialLunarParts.day,
      isLeap: initialLunarParts.isLeapMonth
    }

  const [title, setTitle] = useState(event?.title ?? '')
  const defaultTypes = RELATIONSHIP_EVENT_TYPES[person.relationship ?? ''] ?? ['birthday']
  const [type, setType] = useState<EventType>(event?.type ?? defaultTypes[0] ?? 'birthday')
  const isCustomType = type === 'custom'
  const eventTypeOptions = getEventTypeOptions(person, event?.type)
  const [isLunar, setIsLunar] = useState(event?.isLunar ?? false)
  const [gregorianDate, setGregorianDate] = useState<number>(initialRef.getTime())
  const [lunarYear, setLunarYear] = useState<number>(initialLunar.year)
  const [lunarMonth, setLunarMonth] = useState<number>(initialLunar.month)
  const [lunarDay, setLunarDay] = useState<number>(initialLunar.day)
  const [isLeapMonth, setIsLeapMonth] = useState<boolean>(initialLunar.isLeap)
  // 重复类型：none=不重复, yearly=每年, monthly=每月
  const getInitialRepeatType = (): 'none' | 'yearly' | 'monthly' => {
    if (event?.repeatMonthly) return 'monthly'
    if (event?.repeatYearly) return 'yearly'
    if (!event) return 'yearly' // 新建默认每年重复
    return 'none'
  }
  const [repeatType, setRepeatType] = useState<'none' | 'yearly' | 'monthly'>(getInitialRepeatType())
  const [remindOnDay, setRemindOnDay] = useState(event?.remindOnDay ?? settings.defaultRemindOnDay)
  const widgetSize: AnniversaryWidgetSize = event?.widgetSize ?? initialWidgetSize ?? 'systemMedium'
  const [cardName, setCardName] = useState(event?.cardName ?? pairedEvent?.cardName ?? '')
  const [denseWatermarkEnabled, setDenseWatermarkEnabled] = useState(event?.denseWatermarkEnabled ?? pairedEvent?.denseWatermarkEnabled ?? true)
  const [widgetGradientEnabled, setWidgetGradientEnabled] = useState(event?.widgetGradientEnabled ?? pairedEvent?.widgetGradientEnabled ?? false)
  const [avatarShape, setAvatarShape] = useState<AnniversaryAvatarShape>(event?.avatarShape ?? 'circle')
  const [avatarPosition, setAvatarPosition] = useState<AnniversaryAvatarPosition>(event?.avatarPosition ?? 'left')
  const [photoPath, setPhotoPath] = useState<string | null>(event?.photoPath ?? null)
  const initialSecondRef = pairedEvent ? new Date(pairedEvent.gregorianDate) : today
  const initialSecondLunarParts = getLunarParts(initialSecondRef)
  const initialSecondLunar = pairedEvent?.isLunar && pairedEvent.lunarMonth && pairedEvent.lunarDay
    ? {
      year: pairedEvent.lunarYear ?? initialSecondLunarParts.year,
      month: pairedEvent.lunarMonth,
      day: pairedEvent.lunarDay,
      isLeap: pairedEvent.isLeapMonth
    }
    : {
      year: initialSecondLunarParts.year,
      month: initialSecondLunarParts.month,
      day: initialSecondLunarParts.day,
      isLeap: initialSecondLunarParts.isLeapMonth
    }
  const secondDefaultTypes = RELATIONSHIP_EVENT_TYPES[(secondPerson ?? person).relationship ?? ''] ?? defaultTypes
  const secondEventTypeOptions = getEventTypeOptions(secondPerson ?? person, pairedEvent?.type)
  const [secondType, setSecondType] = useState<EventType>(pairedEvent?.type ?? secondDefaultTypes[1] ?? secondDefaultTypes[0] ?? 'birthday')
  const [secondTitle, setSecondTitle] = useState(pairedEvent?.title ?? '')
  const [secondGregorianDate, setSecondGregorianDate] = useState<number>(initialSecondRef.getTime())
  const [secondIsLunar, setSecondIsLunar] = useState(pairedEvent?.isLunar ?? false)
  const [secondLunarYear, setSecondLunarYear] = useState<number>(initialSecondLunar.year)
  const [secondLunarMonth, setSecondLunarMonth] = useState<number>(initialSecondLunar.month)
  const [secondLunarDay, setSecondLunarDay] = useState<number>(initialSecondLunar.day)
  const [secondIsLeapMonth, setSecondIsLeapMonth] = useState<boolean>(initialSecondLunar.isLeap)
  const [secondPhotoPath, setSecondPhotoPath] = useState<string | null>(pairedEvent?.photoPath ?? null)
  const [secondAvatarPosition, setSecondAvatarPosition] = useState<AnniversaryAvatarPosition>(pairedEvent?.avatarPosition ?? 'right')
  const getInitialSecondRepeatType = (): 'none' | 'yearly' | 'monthly' => {
    if (pairedEvent?.repeatMonthly) return 'monthly'
    if (pairedEvent?.repeatYearly) return 'yearly'
    if (!pairedEvent) return 'yearly'
    return 'none'
  }
  const [secondRepeatType, setSecondRepeatType] = useState<'none' | 'yearly' | 'monthly'>(getInitialSecondRepeatType())

  // 提前提醒：用一个开关控制是否启用，再用步进器设置提前天数
  const initialReminderDays = event?.reminderDays ?? settings.defaultReminderDays
  const initialAdvanceDays = initialReminderDays[0] ?? 1
  const [advanceEnabled, setAdvanceEnabled] = useState(initialReminderDays.length > 0 && initialAdvanceDays > 0)
  const [advanceDays, setAdvanceDays] = useState(initialAdvanceDays > 0 ? initialAdvanceDays : 1)
  const [reminderDays, setReminderDays] = useState<number[]>(initialReminderDays.length > 0 && initialAdvanceDays > 0 ? [initialAdvanceDays] : [])

  // 农历年份可选项范围
  const yearOptions = Array.from({ length: currentYear - 1900 + 2 }, (_, i) => currentYear + 1 - i)

  const MIN_ADVANCE_DAYS = 1
  const MAX_ADVANCE_DAYS = 30
  const finalWidgetSize: AnniversaryWidgetSize = widgetSize
  const effectiveAvatarShape: AnniversaryAvatarShape = finalWidgetSize === 'systemSmall' ? avatarShape : 'rounded'
  const displayPerson: Person = {
    ...person,
    avatarPath: photoPath ?? person.avatarPath
  }
  const secondDisplayPerson: Person = {
    ...(secondPerson ?? person),
    avatarPath: secondPhotoPath ?? (secondPerson ?? person).avatarPath
  }

  const createLargeGroupId = () => `large_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

  const pickEventPhoto = async () => {
    try {
      const path = await pickAndCropPhoto()
      if (!path) return
      setPhotoPath(await replaceDraftPhoto(path, photoPath, event?.photoPath ?? null))
    } catch (err) {
      console.log('选择时光纪念照片失败:', err)
    }
  }

  const pickSecondEventPhoto = async () => {
    try {
      const path = await pickAndCropPhoto()
      if (!path) return
      setSecondPhotoPath(await replaceDraftPhoto(path, secondPhotoPath, pairedEvent?.photoPath ?? null))
    } catch (err) {
      console.log('选择第二条时光纪念照片失败:', err)
    }
  }

  const usePersonPhoto = async () => {
    if (photoPath && photoPath !== event?.photoPath) {
      await deleteAvatar(photoPath)
    }
    setPhotoPath(null)
  }

  const usePersonPhotoForSecond = async () => {
    if (secondPhotoPath && secondPhotoPath !== pairedEvent?.photoPath) {
      await deleteAvatar(secondPhotoPath)
    }
    setSecondPhotoPath(null)
  }

  const handleAdvanceEnabledChanged = (enabled: boolean) => {
    setAdvanceEnabled(enabled)
    setReminderDays(enabled ? [advanceDays] : [])
  }

  const adjustAdvanceDays = (delta: number) => {
    const next = Math.max(MIN_ADVANCE_DAYS, Math.min(MAX_ADVANCE_DAYS, advanceDays + delta))
    setAdvanceDays(next)
    if (advanceEnabled) {
      setReminderDays([next])
    }
  }

  // 切换公历/农历开关时，根据当前值实时互转日期
  const handleIsLunarChanged = (value: boolean) => {
    if (value) {
      // 公历转农历
      const parts = getLunarParts(new Date(gregorianDate))
      setLunarYear(parts.year)
      setLunarMonth(parts.month)
      setLunarDay(parts.day)
      setIsLeapMonth(parts.isLeapMonth)
    } else {
      // 农历转公历
      const date = findGregorianDateForLunar(lunarMonth, lunarDay, isLeapMonth, lunarYear)
      if (date) {
        setGregorianDate(date.getTime())
      }
    }
    setIsLunar(value)
  }

  const handleSecondIsLunarChanged = (value: boolean) => {
    if (value) {
      const parts = getLunarParts(new Date(secondGregorianDate))
      setSecondLunarYear(parts.year)
      setSecondLunarMonth(parts.month)
      setSecondLunarDay(parts.day)
      setSecondIsLeapMonth(parts.isLeapMonth)
    } else {
      const date = findGregorianDateForLunar(secondLunarMonth, secondLunarDay, secondIsLeapMonth, secondLunarYear)
      if (date) {
        setSecondGregorianDate(date.getTime())
      }
    }
    setSecondIsLunar(value)
  }

  // 根据 lunar 字段计算当前应存储的公历基准日期（取所选农历年份对应的公历日期）
  const computeGregorianDate = (): string => {
    if (isLunar) {
      const date = findGregorianDateForLunar(lunarMonth, lunarDay, isLeapMonth, lunarYear)
      if (date) return formatDateKey(date)
      // 兜底：使用当前年
      const fallback = findGregorianDateForLunar(lunarMonth, lunarDay, false, currentYear)
      if (fallback) return formatDateKey(fallback)
    }
    return formatDateKey(new Date(gregorianDate))
  }

  const computeSecondGregorianDate = (): string => {
    if (secondIsLunar) {
      const date = findGregorianDateForLunar(secondLunarMonth, secondLunarDay, secondIsLeapMonth, secondLunarYear)
      if (date) return formatDateKey(date)
      const fallback = findGregorianDateForLunar(secondLunarMonth, secondLunarDay, false, currentYear)
      if (fallback) return formatDateKey(fallback)
    }
    return formatDateKey(new Date(secondGregorianDate))
  }

  const buildSavedEvent = (params: {
    source?: AnniversaryEvent
    selectedType: EventType
    customTitle: string
    gregorian: string
    lunar: boolean
    targetPerson: Person
    photoPath: string | null
    avatarPosition: AnniversaryAvatarPosition
    itemRepeatType: 'none' | 'yearly' | 'monthly'
    largePartIndex?: number | null
    largeGroupId?: string | null
    lunarInfo?: {
      year: number
      month: number
      day: number
      isLeap: boolean
    }
  }): AnniversaryEvent => {
    const trimmed = params.selectedType === 'custom'
      ? params.customTitle.trim() || '其他'
      : EVENT_TYPE_LABELS[params.selectedType] || '时光纪念'

    return {
      id: params.source?.id ?? '',
      personId: params.targetPerson.id,
      title: trimmed,
      type: params.selectedType,
      isLunar: params.lunar,
      gregorianDate: params.gregorian,
      lunarYear: params.lunar ? params.lunarInfo?.year ?? null : null,
      lunarMonth: params.lunar ? params.lunarInfo?.month ?? null : null,
      lunarDay: params.lunar ? params.lunarInfo?.day ?? null : null,
      isLeapMonth: params.lunar ? params.lunarInfo?.isLeap ?? false : false,
      reminderDays,
      remindOnDay,
      repeatYearly: params.itemRepeatType === 'yearly',
      repeatMonthly: params.itemRepeatType === 'monthly',
      isPinned: params.source?.isPinned ?? false,
      cardName: cardName.trim(),
      denseWatermarkEnabled,
      widgetGradientEnabled,
      widgetSize: finalWidgetSize,
      avatarShape: effectiveAvatarShape,
      avatarPosition: params.avatarPosition,
      photoPath: params.photoPath,
      largeGroupId: finalWidgetSize === 'systemLarge'
        ? params.source?.largeGroupId ?? params.largeGroupId ?? null
        : null,
      largePartIndex: finalWidgetSize === 'systemLarge'
        ? params.largePartIndex ?? params.source?.largePartIndex ?? null
        : null,
      createdAt: params.source?.createdAt ?? Date.now()
    }
  }

  const handleSave = async () => {
    const saved = buildSavedEvent({
      source: event,
      selectedType: type,
      customTitle: title,
      gregorian: computeGregorianDate(),
      lunar: isLunar,
      targetPerson: person,
      photoPath,
      avatarPosition,
      itemRepeatType: repeatType,
      largePartIndex: 0,
      lunarInfo: { year: lunarYear, month: lunarMonth, day: lunarDay, isLeap: isLeapMonth }
    })

    if (finalWidgetSize === 'systemLarge') {
      const largeGroupId = saved.largeGroupId ?? pairedEvent?.largeGroupId ?? createLargeGroupId()
      saved.largeGroupId = largeGroupId
      const secondSaved = buildSavedEvent({
        source: pairedEvent,
        selectedType: secondType,
        customTitle: secondTitle,
        gregorian: computeSecondGregorianDate(),
        lunar: secondIsLunar,
        targetPerson: secondPerson ?? person,
        photoPath: secondPhotoPath,
        avatarPosition: secondAvatarPosition,
        itemRepeatType: secondRepeatType,
        largePartIndex: 1,
        lunarInfo: { year: secondLunarYear, month: secondLunarMonth, day: secondLunarDay, isLeap: secondIsLeapMonth },
        largeGroupId
      })
      await onSave([saved, secondSaved])
      if (!embedded) dismiss()
      return
    }

    await onSave(saved)
    if (!embedded) dismiss()
  }

  const renderReminderSection = (titleText: string) => (
    <Section title={titleText}>
      {finalWidgetSize === 'systemLarge' ? (
        <Text foregroundStyle="secondaryLabel" font={13}>提醒设置会同时应用到这张大卡片里的两条时光纪念。</Text>
      ) : null}
      <Toggle
        title="当天提醒"
        value={remindOnDay}
        onChanged={setRemindOnDay}
      />
      <Toggle
        title="提前提醒"
        value={advanceEnabled}
        onChanged={handleAdvanceEnabledChanged}
      />
      {advanceEnabled && (
        <Stepper
          title={`提前 ${advanceDays} 天`}
          onIncrement={() => adjustAdvanceDays(1)}
          onDecrement={() => adjustAdvanceDays(-1)}
        />
      )}
    </Section>
  )

  const renderHomeCardSection = (titleText: string) => (
    <Section title={titleText}>
      {finalWidgetSize === 'systemLarge' ? (
        <>
          <FormRow label="卡片名称" value={cardName} prompt="用于小组件参数" onChanged={setCardName} />
          <Toggle
            title="密集图标水印"
            value={denseWatermarkEnabled}
            onChanged={setDenseWatermarkEnabled}
          />
          <Toggle
            title="小组件照片渐变"
            value={widgetGradientEnabled}
            onChanged={setWidgetGradientEnabled}
          />
        </>
      ) : (
        <>
          <FormRow label="卡片名称" value={cardName} prompt="用于小组件参数" onChanged={setCardName} />
          <Toggle
            title="密集图标水印"
            value={denseWatermarkEnabled}
            onChanged={setDenseWatermarkEnabled}
          />
          <Toggle
            title="小组件照片渐变"
            value={widgetGradientEnabled}
            onChanged={setWidgetGradientEnabled}
          />
          {finalWidgetSize === 'systemSmall' ? (
            <Picker
              title="照片形状"
              value={avatarShape}
              onChanged={(v: string) => setAvatarShape(v as AnniversaryAvatarShape)}
              pickerStyle="segmented"
            >
              <Text tag="circle">圆形</Text>
              <Text tag="rounded">圆角</Text>
            </Picker>
          ) : (
            <Text foregroundStyle="secondaryLabel" font={13}>中号卡片使用圆角照片。</Text>
          )}
          {finalWidgetSize !== 'systemSmall' ? (
            <Picker
              title="照片位置"
              value={avatarPosition}
              onChanged={(v: string) => setAvatarPosition(v as AnniversaryAvatarPosition)}
              pickerStyle="segmented"
            >
              <Text tag="left">左侧</Text>
              <Text tag="right">右侧</Text>
            </Picker>
          ) : null}
        </>
      )}
    </Section>
  )

  const content = (
    <List
        listStyle="insetGroup"
        navigationTitle={isNew ? '添加时光纪念' : '编辑时光纪念'}
        navigationBarTitleDisplayMode="inline"
        scrollIndicator="hidden"
        toolbar={
          <Toolbar>
            {!embedded ? (
              <ToolbarItem placement="topBarLeading">
                <Button key="返回" action={dismiss}>
                  <Image systemName="chevron.down" fontWeight="semibold" />
                </Button>
              </ToolbarItem>
            ) : null}
            <ToolbarItem placement="topBarTrailing">
              {embedded && onCancel ? (
                <HStack spacing={8}>
                  <Button title="" systemImage="xmark" role="cancel" foregroundStyle="red" action={onCancel} />
                  <Button title="保存" systemImage="square.and.arrow.down" fontWeight="semibold" action={handleSave} />
                </HStack>
              ) : (
                <Button title="保存" systemImage="square.and.arrow.down" fontWeight="semibold" action={handleSave} />
              )}
            </ToolbarItem>
          </Toolbar>
        }
        alert={{
          title: '删除时光纪念',
          message: <Text>{pairedEvent ? '确定要删除这张大卡片里的两条时光纪念吗？' : '确定要删除这条时光纪念吗？'}</Text>,
          isPresented: showDeleteAlert,
          onChanged: setShowDeleteAlert,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => setShowDeleteAlert(false)} />
              <Button title="删除" role="destructive" action={handleDelete} />
            </>
          )
        }}
      >
        {renderHomeCardSection(finalWidgetSize === 'systemLarge' ? '共用首页卡片' : '首页卡片')}

        <Section title={finalWidgetSize === 'systemLarge' ? '第一条时光纪念' : undefined}>
          <VStack spacing={0} listRowSeparator={{ visibility: 'hidden', edges: 'bottom' }}>
            <HStack spacing={8} frame={{ maxWidth: Infinity }} onTapGesture={pickEventPhoto}>
              <Avatar person={displayPerson} size={68} shape={effectiveAvatarShape} />
              <VStack alignment="leading" spacing={5}>
                <Text fontWeight="semibold" font={24}>{person.name}</Text>
                <RelationshipTag relationship={person.relationship} />
              </VStack>
              <Spacer />
              <Button
                buttonStyle="bordered"
                action={() => { usePersonPhoto() }}
                disabled={!photoPath}
              >
                <Image systemName="person.crop.square" />
              </Button>
            </HStack>
            <Divider />
          </VStack>
          <Picker
            title="时光纪念类型"
            value={type}
            onChanged={(v: string) => {
              const nextType = v as EventType
              setType(nextType)
              if (nextType !== 'custom') {
                setTitle('')
              }
            }}
            pickerStyle="menu"
          >
            {eventTypeOptions.map(opt => (
              <Text key={opt.value} tag={opt.value}>{opt.label}</Text>
            ))}
          </Picker>
          {isCustomType && (
            <FormRow label="自定义" value={title} prompt="请输入" onChanged={setTitle} />
          )}
          {finalWidgetSize === 'systemLarge' ? (
            <Picker
              title="照片位置"
              value={avatarPosition}
              onChanged={(v: string) => setAvatarPosition(v as AnniversaryAvatarPosition)}
              pickerStyle="segmented"
            >
              <Text tag="left">左侧</Text>
              <Text tag="right">右侧</Text>
            </Picker>
          ) : null}
        </Section>

        <Section title={finalWidgetSize === 'systemLarge' ? '第一条日期' : '日期'}>
          <Toggle
            title="农历"
            value={isLunar}
            onChanged={handleIsLunarChanged}
          />
          {!isLunar ? (
            <DatePicker
              title="公历日期"
              value={gregorianDate}
              onChanged={setGregorianDate}
              displayedComponents={['date']}
            />
          ) : (
            <>
              {/* 农历年月日三栏横向排列，自适应宽度 */}
              <GeometryReader>
                {({ size }) => {
                  const gap = 1
                  const total = size.width - gap * 2
                  const yearWidth = total * 0.47
                  const monthDayWidth = (total - yearWidth) / 2
                  return (
                    <HStack spacing={gap} frame={{ maxWidth: Infinity }}>
                      <Picker
                        title="年"
                        value={lunarYear}
                        onChanged={(v: number) => setLunarYear(v)}
                        pickerStyle="menu"
                        frame={{ width: yearWidth }}
                      >
                        {yearOptions.map(y => (
                          <Text key={String(y)} tag={y} lineLimit={1} minScaleFactor={0.7}>{y}（{getLunarYearGanZhi(y)}）</Text>
                        ))}
                      </Picker>
                      <Picker
                        title="月"
                        value={lunarMonth}
                        onChanged={(v: number) => setLunarMonth(v)}
                        pickerStyle="menu"
                        frame={{ width: monthDayWidth }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                          <Text key={String(m)} tag={m}>{LUNAR_MONTH_NAMES[m]}</Text>
                        ))}
                      </Picker>
                      <Picker
                        title="日"
                        value={lunarDay}
                        onChanged={(v: number) => setLunarDay(v)}
                        pickerStyle="menu"
                        frame={{ width: monthDayWidth }}
                      >
                        {Array.from({ length: 30 }, (_, i) => i + 1).map(d => (
                          <Text key={String(d)} tag={d}>{LUNAR_DAY_NAMES[d]}</Text>
                        ))}
                      </Picker>
                    </HStack>
                  )
                }}
              </GeometryReader>
              <Toggle
                title="闰月"
                value={isLeapMonth}
                onChanged={setIsLeapMonth}
              />
              <Text foregroundStyle="secondaryLabel" font={14}>
                {(() => {
                  const key = computeGregorianDate()
                  const date = parseDateKey(key)
                  return date ? `对应公历：${formatDateCN(date)}` : ''
                })()}
              </Text>
            </>
          )}
          <Picker
            title="重复事件"
            value={repeatType}
            onChanged={(v: string) => setRepeatType(v as 'none' | 'yearly' | 'monthly')}
            pickerStyle="menu"
          >
            <Text tag="yearly">每年</Text>
            <Text tag="monthly">每月</Text>
            <Text tag="none">不重复</Text>
          </Picker>
        </Section>

        {finalWidgetSize !== 'systemLarge' ? renderReminderSection('提醒') : null}

        {finalWidgetSize === 'systemLarge' ? (
          <Section title="第二条时光纪念">
            <VStack spacing={0} listRowSeparator={{ visibility: 'hidden', edges: 'bottom' }}>
              <HStack spacing={8} frame={{ maxWidth: Infinity }} onTapGesture={pickSecondEventPhoto}>
                <Avatar person={secondDisplayPerson} size={68} shape="rounded" />
                <VStack alignment="leading" spacing={5}>
                  <Text fontWeight="semibold" font={24}>{(secondPerson ?? person).name}</Text>
                  <RelationshipTag relationship={(secondPerson ?? person).relationship} />
                </VStack>
                <Spacer />
                <Button
                  buttonStyle="bordered"
                  action={() => { usePersonPhotoForSecond() }}
                  disabled={!secondPhotoPath}
                >
                  <Image systemName="person.crop.square" />
                </Button>
              </HStack>
              <Divider />
            </VStack>
            <Picker
              title="时光纪念类型"
              value={secondType}
              onChanged={(v: string) => {
                const nextType = v as EventType
                setSecondType(nextType)
                if (nextType !== 'custom') {
                  setSecondTitle('')
                }
              }}
              pickerStyle="menu"
            >
              {secondEventTypeOptions.map(opt => (
                <Text key={opt.value} tag={opt.value}>{opt.label}</Text>
              ))}
            </Picker>
            {secondType === 'custom' && (
              <FormRow label="自定义" value={secondTitle} prompt="请输入" onChanged={setSecondTitle} />
            )}
            <Picker
              title="照片位置"
              value={secondAvatarPosition}
              onChanged={(v: string) => setSecondAvatarPosition(v as AnniversaryAvatarPosition)}
              pickerStyle="segmented"
            >
              <Text tag="left">左侧</Text>
              <Text tag="right">右侧</Text>
            </Picker>
          </Section>
        ) : null}

        {finalWidgetSize === 'systemLarge' ? (
          <Section title="第二条日期">
            <Toggle
              title="农历"
              value={secondIsLunar}
              onChanged={handleSecondIsLunarChanged}
            />
            {!secondIsLunar ? (
              <DatePicker
                title="公历日期"
                value={secondGregorianDate}
                onChanged={setSecondGregorianDate}
                displayedComponents={['date']}
              />
            ) : (
              <>
                <GeometryReader>
                  {({ size }) => {
                    const gap = 1
                    const total = size.width - gap * 2
                    const yearWidth = total * 0.47
                    const monthDayWidth = (total - yearWidth) / 2
                    return (
                      <HStack spacing={gap} frame={{ maxWidth: Infinity }}>
                        <Picker
                          title="年"
                          value={secondLunarYear}
                          onChanged={(v: number) => setSecondLunarYear(v)}
                          pickerStyle="menu"
                          frame={{ width: yearWidth }}
                        >
                          {yearOptions.map(y => (
                            <Text key={String(y)} tag={y} lineLimit={1} minScaleFactor={0.7}>{y}（{getLunarYearGanZhi(y)}）</Text>
                          ))}
                        </Picker>
                        <Picker
                          title="月"
                          value={secondLunarMonth}
                          onChanged={(v: number) => setSecondLunarMonth(v)}
                          pickerStyle="menu"
                          frame={{ width: monthDayWidth }}
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <Text key={String(m)} tag={m}>{LUNAR_MONTH_NAMES[m]}</Text>
                          ))}
                        </Picker>
                        <Picker
                          title="日"
                          value={secondLunarDay}
                          onChanged={(v: number) => setSecondLunarDay(v)}
                          pickerStyle="menu"
                          frame={{ width: monthDayWidth }}
                        >
                          {Array.from({ length: 30 }, (_, i) => i + 1).map(d => (
                            <Text key={String(d)} tag={d}>{LUNAR_DAY_NAMES[d]}</Text>
                          ))}
                        </Picker>
                      </HStack>
                    )
                  }}
                </GeometryReader>
                <Toggle
                  title="闰月"
                  value={secondIsLeapMonth}
                  onChanged={setSecondIsLeapMonth}
                />
                <Text foregroundStyle="secondaryLabel" font={14}>
                  {(() => {
                    const key = computeSecondGregorianDate()
                    const date = parseDateKey(key)
                    return date ? `对应公历：${formatDateCN(date)}` : ''
                  })()}
                </Text>
              </>
            )}
            <Picker
              title="重复事件"
              value={secondRepeatType}
              onChanged={(v: string) => setSecondRepeatType(v as 'none' | 'yearly' | 'monthly')}
              pickerStyle="menu"
            >
              <Text tag="yearly">每年</Text>
              <Text tag="monthly">每月</Text>
              <Text tag="none">不重复</Text>
            </Picker>
          </Section>
        ) : null}

        {finalWidgetSize === 'systemLarge' ? renderReminderSection('共用提醒') : null}

        {event && onDelete && (
          <Section>
            <HStack frame={{ maxWidth: Infinity }} alignment="center">
              <Button
                title="删除时光纪念"
                role="destructive"
                action={() => setShowDeleteAlert(true)}
              />
            </HStack>
          </Section>
        )}
      </List>
  )

  return embedded ? content : (
    <NavigationStack>
      {content}
    </NavigationStack>
  )
}
