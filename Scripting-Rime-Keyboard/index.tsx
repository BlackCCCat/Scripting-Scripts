import {
  Button,
  ColorPicker,
  HStack,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Script,
  Section,
  Slider,
  Text,
  TextField,
  Toggle,
  useState,
  VStack,
} from "scripting";
import {
  type ActionSendMode,
  CANDIDATE_BAR_HEIGHT_MAX,
  CANDIDATE_BAR_HEIGHT_MIN,
  type CandidateRightButtonMode,
  COMPOSING_FUNCTION_KEYS,
  DEFAULT_RIME_KEYBOARD_SETTINGS,
  FUNCTION_KEYS,
  KEYBOARD_HEIGHT_MAX,
  KEYBOARD_HEIGHT_MIN,
  type KeyColorPair,
  type KeyColorScheme,
  LETTER_KEYS,
  LETTER_LONG_PRESS_DURATION_MAX,
  LETTER_LONG_PRESS_DURATION_MIN,
  loadRimeKeyboardSettings,
  type RimeKeyboardSettings,
  type RimeKeyboardTheme,
  saveRimeKeyboardSettings,
} from "./settings";

const THEME_OPTIONS: Array<{ value: RimeKeyboardTheme; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const CANDIDATE_RIGHT_BUTTON_OPTIONS: Array<
  { value: CandidateRightButtonMode; label: string }
> = [
  { value: "dismiss", label: "收起键盘" },
  { value: "expand", label: "展开候选" },
  { value: "hidden", label: "不显示" },
];

const ACTION_MODE_OPTIONS: Array<{ value: ActionSendMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "rime", label: "发送给 Rime" },
  { value: "direct", label: "直接上屏" },
];

const FUNCTION_KEY_LABELS: Record<string, string> = {
  left: "左移",
  head: "行首",
  select: "方案",
  cut: "剪切",
  copy: "复制",
  paste: "粘贴",
  tail: "行尾",
  right: "右移",
  page: "翻页",
  tone1: "一声",
  tone2: "二声",
  tone3: "三声",
  tone4: "四声",
  filter: "筛选",
};

const KEY_COLOR_GROUPS: Array<{
  title: string;
  keys: Array<{ id: string; label: string }>;
}> = [
  {
    title: "字母键",
    keys: LETTER_KEYS.map((key) => ({ id: key, label: key.toUpperCase() })),
  },
  {
    title: "控制键",
    keys: [
      { id: "shift", label: "Shift" },
      { id: "backspace", label: "Delete" },
      { id: "numbers", label: "数字切换" },
      { id: "comma", label: "逗号" },
      { id: "space", label: "空格" },
      { id: "mode", label: "中英切换" },
      { id: "enter", label: "回车" },
    ],
  },
  {
    title: "功能行",
    keys: [
      { id: "idle-left", label: "左移" },
      { id: "idle-head", label: "行首" },
      { id: "idle-schema", label: "方案" },
      { id: "idle-cut", label: "剪切" },
      { id: "idle-copy", label: "复制" },
      { id: "idle-paste", label: "粘贴" },
      { id: "idle-tail", label: "行尾" },
      { id: "idle-right", label: "右移" },
    ],
  },
  {
    title: "预编辑功能行",
    keys: [
      { id: "func-left", label: "左括号" },
      { id: "func-page-down", label: "翻页" },
      { id: "tone-1", label: "一声" },
      { id: "tone-2", label: "二声" },
      { id: "tone-3", label: "三声" },
      { id: "tone-4", label: "四声" },
      { id: "func-backslash", label: "筛选" },
      { id: "func-right", label: "右括号" },
    ],
  },
  {
    title: "数字键盘",
    keys: [
      ..."123456789".split("").map((key) => ({
        id: `numeric-${key}`,
        label: key,
      })),
      { id: "numeric-abc", label: "ABC" },
      { id: "numeric-0", label: "0" },
      { id: "numeric-space", label: "空格" },
      { id: "numeric-backspace", label: "Delete" },
      { id: "numeric-dot", label: "小数点" },
      { id: "numeric-equal", label: "等号" },
      { id: "numeric-enter", label: "换行" },
    ],
  },
];

function SettingHint({ children }: { children: any }) {
  return <Text font="caption" foregroundStyle="secondaryLabel">{children}
  </Text>;
}

function LabeledTextField(props: {
  title: string;
  value: string;
  prompt?: string;
  titleWidth?: number;
  onChanged: (value: string) => void;
}) {
  return (
    <HStack
      spacing={10}
      frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
    >
      <Text
        font="body"
        frame={{ width: props.titleWidth ?? 76, alignment: "leading" as any }}
      >
        {props.title}
      </Text>
      <TextField
        title=""
        value={props.value}
        prompt={props.prompt ?? ""}
        onChanged={props.onChanged}
        frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
      />
    </HStack>
  );
}

function ColorPairConfigRow(props: {
  title: string;
  value: KeyColorPair;
  overridden?: boolean;
  onLightChanged: (value: string) => void;
  onDarkChanged: (value: string) => void;
  onReset?: () => void;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
    >
      <HStack spacing={8}>
        <Text font="headline">{props.title}</Text>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ maxWidth: "infinity" as any, alignment: "trailing" as any }}
        >
          {props.overridden ? "单独设置" : "跟随默认"}
        </Text>
      </HStack>
      <HStack spacing={12}>
        <ColorPicker
          title="浅色主题"
          value={props.value.light as any}
          supportsOpacity={false}
          onChanged={(value) => props.onLightChanged(String(value))}
        />
        <ColorPicker
          title="深色主题"
          value={props.value.dark as any}
          supportsOpacity={false}
          onChanged={(value) => props.onDarkChanged(String(value))}
        />
      </HStack>
      {props.overridden && props.onReset
        ? (
          <Button
            title="恢复默认颜色"
            systemImage="arrow.counterclockwise"
            action={props.onReset}
          />
        )
        : null}
    </VStack>
  );
}

function SwipeConfigRow(props: {
  title: string;
  action: string;
  symbol: string;
  mode: ActionSendMode;
  onActionChanged: (value: string) => void;
  onSymbolChanged: (value: string) => void;
  onModeChanged: (value: ActionSendMode) => void;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={6}
      frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
    >
      <Text font="headline">{props.title}</Text>
      <HStack spacing={10}>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ width: 38, alignment: "leading" as any }}
        >
          动作
        </Text>
        <TextField
          title=""
          value={props.action}
          prompt="发送内容"
          onChanged={props.onActionChanged}
        />
      </HStack>
      <Picker
        title="发送方式"
        value={props.mode}
        onChanged={(value: string) =>
          props.onModeChanged(value as ActionSendMode)}
        pickerStyle="segmented"
      >
        {ACTION_MODE_OPTIONS.map((option) => (
          <Text key={option.value} tag={option.value}>{option.label}</Text>
        ))}
      </Picker>
      <HStack spacing={10}>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ width: 38, alignment: "leading" as any }}
        >
          图标
        </Text>
        <TextField
          title=""
          value={props.symbol}
          prompt="SF Symbol，可留空"
          onChanged={props.onSymbolChanged}
        />
      </HStack>
    </VStack>
  );
}

function ActionConfigRow(props: {
  title: string;
  action: string;
  mode: ActionSendMode;
  onActionChanged: (value: string) => void;
  onModeChanged: (value: ActionSendMode) => void;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={6}
      frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
    >
      <LabeledTextField
        title={props.title}
        value={props.action}
        titleWidth={126}
        onChanged={props.onActionChanged}
      />
      <Picker
        title="发送方式"
        value={props.mode}
        onChanged={(value: string) =>
          props.onModeChanged(value as ActionSendMode)}
        pickerStyle="segmented"
      >
        {ACTION_MODE_OPTIONS.map((option) => (
          <Text key={option.value} tag={option.value}>{option.label}</Text>
        ))}
      </Picker>
    </VStack>
  );
}

function FunctionSwipeConfigRow(props: {
  title: string;
  upAction: string;
  upMode: ActionSendMode;
  downAction: string;
  downMode: ActionSendMode;
  onUpActionChanged: (value: string) => void;
  onUpModeChanged: (value: ActionSendMode) => void;
  onDownActionChanged: (value: string) => void;
  onDownModeChanged: (value: ActionSendMode) => void;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
    >
      <Text font="headline">{props.title}</Text>
      <LabeledTextField
        title="上划动作"
        value={props.upAction}
        titleWidth={78}
        onChanged={props.onUpActionChanged}
      />
      <Picker
        title="上划发送"
        value={props.upMode}
        onChanged={(value: string) =>
          props.onUpModeChanged(value as ActionSendMode)}
        pickerStyle="segmented"
      >
        {ACTION_MODE_OPTIONS.map((option) => (
          <Text key={option.value} tag={option.value}>{option.label}</Text>
        ))}
      </Picker>
      <LabeledTextField
        title="下划动作"
        value={props.downAction}
        titleWidth={78}
        onChanged={props.onDownActionChanged}
      />
      <Picker
        title="下划发送"
        value={props.downMode}
        onChanged={(value: string) =>
          props.onDownModeChanged(value as ActionSendMode)}
        pickerStyle="segmented"
      >
        {ACTION_MODE_OPTIONS.map((option) => (
          <Text key={option.value} tag={option.value}>{option.label}</Text>
        ))}
      </Picker>
    </VStack>
  );
}

function SettingsView() {
  const [settings, setSettings] = useState<RimeKeyboardSettings>(() =>
    loadRimeKeyboardSettings()
  );

  function updateSettings(next: RimeKeyboardSettings) {
    const saved = saveRimeKeyboardSettings(next);
    setSettings(saved);
  }

  function patchSettings(patch: Partial<RimeKeyboardSettings>) {
    updateSettings({ ...settings, ...patch });
  }

  function patchKeyBaseColor(
    kind: "normal" | "enter",
    scheme: KeyColorScheme,
    value: string,
  ) {
    updateSettings({
      ...settings,
      keyColors: {
        ...settings.keyColors,
        [kind]: {
          ...settings.keyColors[kind],
          [scheme]: value,
        },
      },
      [scheme === "light" ? "customKeyColorLight" : "customKeyColorDark"]: true,
    });
  }

  function patchKeyOverrideColor(
    key: string,
    scheme: KeyColorScheme,
    fallback: KeyColorPair,
    value: string,
  ) {
    updateSettings({
      ...settings,
      keyColors: {
        ...settings.keyColors,
        overrides: {
          ...settings.keyColors.overrides,
          [key]: {
            ...(settings.keyColors.overrides[key] ?? fallback),
            [scheme]: value,
          },
        },
      },
      [scheme === "light" ? "customKeyColorLight" : "customKeyColorDark"]: true,
    });
  }

  function resetKeyOverrideColor(key: string) {
    const { [key]: _, ...overrides } = settings.keyColors.overrides;
    updateSettings({
      ...settings,
      keyColors: {
        ...settings.keyColors,
        overrides,
      },
    });
  }

  function patchSwipeMap(
    key: keyof Pick<
      RimeKeyboardSettings,
      | "letterSwipeUp"
      | "letterSwipeDown"
      | "letterSwipeUpSymbols"
      | "letterSwipeDownSymbols"
      | "letterSwipeUpModes"
      | "letterSwipeDownModes"
      | "idleFunctionSwipeUp"
      | "idleFunctionSwipeDown"
      | "composingFunctionSwipeUp"
      | "composingFunctionSwipeDown"
      | "idleFunctionSwipeUpModes"
      | "idleFunctionSwipeDownModes"
      | "composingFunctionSwipeUpModes"
      | "composingFunctionSwipeDownModes"
    >,
    actionKey: string,
    value: string | ActionSendMode,
  ) {
    updateSettings({
      ...settings,
      [key]: {
        ...settings[key],
        [actionKey]: value,
      },
    });
  }

  function resetSettings() {
    updateSettings(DEFAULT_RIME_KEYBOARD_SETTINGS);
  }

  function renderAppearancePage() {
    return (
      <List navigationTitle="键盘外观" navigationBarTitleDisplayMode="inline">
        <Section header={<Text>基础外观</Text>}>
          <Picker
            title="主题"
            value={settings.theme}
            onChanged={(value: string) =>
              patchSettings({ theme: value as RimeKeyboardTheme })}
            pickerStyle="segmented"
          >
            {THEME_OPTIONS.map((option) => (
              <Text key={option.value} tag={option.value}>{option.label}</Text>
            ))}
          </Picker>
          <Toggle
            title="自定义键盘高度"
            systemImage="arrow.up.and.down"
            value={settings.useCustomKeyboardHeight}
            onChanged={(value) =>
              patchSettings({ useCustomKeyboardHeight: value })}
          />
          {settings.useCustomKeyboardHeight
            ? (
              <VStack alignment="leading" spacing={8}>
                <HStack>
                  <Text>键盘高度</Text>
                  <Text
                    font="subheadline"
                    foregroundStyle="secondaryLabel"
                    frame={{
                      maxWidth: "infinity" as any,
                      alignment: "trailing" as any,
                    }}
                  >
                    {settings.keyboardHeight} pt
                  </Text>
                </HStack>
                <Slider
                  min={KEYBOARD_HEIGHT_MIN}
                  max={KEYBOARD_HEIGHT_MAX}
                  step={1}
                  value={settings.keyboardHeight}
                  onChanged={(value) =>
                    patchSettings({ keyboardHeight: Math.round(value) })}
                  label={<Text>键盘高度</Text>}
                  minValueLabel={<Text>{KEYBOARD_HEIGHT_MIN}</Text>}
                  maxValueLabel={<Text>{KEYBOARD_HEIGHT_MAX}</Text>}
                />
                <SettingHint>
                  Scripting
                  当前只提供系统键盘点击音，滑块用于控制连续删除时的按键音反馈密度。
                </SettingHint>
              </VStack>
            )
            : null}
          <Toggle
            title="显示字母角标"
            systemImage="textformat.123"
            value={settings.showHintSymbols}
            onChanged={(value) =>
              patchSettings({ showHintSymbols: value })}
          />
          <Toggle
            title="空格显示自定义内容"
            systemImage="space"
            value={settings.showWanxiangLabel}
            onChanged={(value) =>
              patchSettings({ showWanxiangLabel: value })}
          />
          {settings.showWanxiangLabel
            ? (
              <LabeledTextField
                title="空格文字"
                value={settings.spaceLabel}
                prompt="万象"
                onChanged={(value) => patchSettings({ spaceLabel: value })}
              />
            )
            : null}
        </Section>

        <Section
          header={<Text>按键颜色</Text>}
          footer={
            <SettingHint>
              关闭时使用键盘原始配色，并跟随上方主题；开启后才使用下面的浅色/深色颜色选择。
            </SettingHint>
          }
        >
          <Toggle
            title="启用自定义按键颜色"
            systemImage="paintpalette"
            value={settings.customKeyColors}
            onChanged={(value) => patchSettings({ customKeyColors: value })}
          />
        </Section>

        {settings.customKeyColors
          ? (
            <Section
              header={<Text>按键颜色 · 生效主题</Text>}
              footer={
                <SettingHint>
                  只开启需要自定义的主题。未开启的主题继续使用键盘原始配色。
                </SettingHint>
              }
            >
              <Toggle
                title="浅色主题使用自定义颜色"
                systemImage="sun.max"
                value={settings.customKeyColorLight}
                onChanged={(value) =>
                  patchSettings({ customKeyColorLight: value })}
              />
              <Toggle
                title="深色主题使用自定义颜色"
                systemImage="moon"
                value={settings.customKeyColorDark}
                onChanged={(value) =>
                  patchSettings({ customKeyColorDark: value })}
              />
            </Section>
          )
          : null}

        {settings.customKeyColors
          ? (
            <Section
              header={<Text>按键颜色 · 统一默认</Text>}
              footer={
                <SettingHint>
                  普通按键用于未单独配置的按键；回车按键用于底部回车和数字键盘提交键。
                </SettingHint>
              }
            >
              <ColorPairConfigRow
                title="普通按键"
                value={settings.keyColors.normal}
                onLightChanged={(value) =>
                  patchKeyBaseColor("normal", "light", value)}
                onDarkChanged={(value) =>
                  patchKeyBaseColor("normal", "dark", value)}
              />
              <ColorPairConfigRow
                title="回车按键"
                value={settings.keyColors.enter}
                onLightChanged={(value) =>
                  patchKeyBaseColor("enter", "light", value)}
                onDarkChanged={(value) =>
                  patchKeyBaseColor("enter", "dark", value)}
              />
            </Section>
          )
          : null}

        {settings.customKeyColors
          ? (
            <Section header={<Text>按键颜色 · 单键覆盖</Text>}>
              {KEY_COLOR_GROUPS.map((group) => (
                <NavigationLink
                  key={"color-link-" + group.title}
                  title={group.title}
                  destination={renderKeyColorPage(group)}
                />
              ))}
            </Section>
          )
          : null}
      </List>
    );
  }

  function renderKeyColorPage(group: typeof KEY_COLOR_GROUPS[number]) {
    return (
      <List
        navigationTitle={"按键颜色 · " + group.title}
        navigationBarTitleDisplayMode="inline"
      >
        <Section>
          {group.keys.map((item) => {
            const fallback = item.id === "enter" || item.id === "numeric-enter"
              ? settings.keyColors.enter
              : settings.keyColors.normal;
            const override = settings.keyColors.overrides[item.id];
            return (
              <ColorPairConfigRow
                key={"color-" + item.id}
                title={item.label}
                value={override ?? fallback}
                overridden={override != null}
                onLightChanged={(value) =>
                  patchKeyOverrideColor(item.id, "light", fallback, value)}
                onDarkChanged={(value) =>
                  patchKeyOverrideColor(item.id, "dark", fallback, value)}
                onReset={() => resetKeyOverrideColor(item.id)}
              />
            );
          })}
        </Section>
      </List>
    );
  }

  function renderCandidatePage() {
    return (
      <List
        navigationTitle="候选与预编辑"
        navigationBarTitleDisplayMode="inline"
      >
        <Section header={<Text>候选栏</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack>
              <Text>候选栏高度</Text>
              <Text
                font="subheadline"
                foregroundStyle="secondaryLabel"
                frame={{
                  maxWidth: "infinity" as any,
                  alignment: "trailing" as any,
                }}
              >
                {settings.candidateBarHeight} pt
              </Text>
            </HStack>
            <Slider
              min={CANDIDATE_BAR_HEIGHT_MIN}
              max={CANDIDATE_BAR_HEIGHT_MAX}
              step={1}
              value={settings.candidateBarHeight}
              onChanged={(value) =>
                patchSettings({ candidateBarHeight: Math.round(value) })}
              label={<Text>候选栏高度</Text>}
              minValueLabel={<Text>{CANDIDATE_BAR_HEIGHT_MIN}</Text>}
              maxValueLabel={<Text>{CANDIDATE_BAR_HEIGHT_MAX}</Text>}
            />
          </VStack>
          <Picker
            title="候选栏右侧按钮"
            value={settings.candidateRightButtonMode}
            onChanged={(value: string) =>
              patchSettings({
                candidateRightButtonMode: value as CandidateRightButtonMode,
              })}
            pickerStyle="menu"
          >
            {CANDIDATE_RIGHT_BUTTON_OPTIONS.map((option) => (
              <Text key={option.value} tag={option.value}>{option.label}</Text>
            ))}
          </Picker>
          <Toggle
            title="显示候选注释"
            systemImage="text.bubble"
            value={settings.showCandidateComment}
            onChanged={(value) =>
              patchSettings({ showCandidateComment: value })}
          />
          <Toggle
            title="显示预编辑脱字符"
            systemImage="text.cursor"
            value={settings.showPreeditCaret}
            onChanged={(value) => patchSettings({ showPreeditCaret: value })}
          />
        </Section>
        <Section
          header={<Text>预编辑</Text>}
          footer={
            <SettingHint>
              开启后拼音显示在光标位置；关闭后拼音显示在键盘候选栏上方。
            </SettingHint>
          }
        >
          <Toggle
            title="内嵌模式"
            systemImage="text.cursor"
            value={settings.inlinePreedit}
            onChanged={(value) => patchSettings({ inlinePreedit: value })}
          />
        </Section>
      </List>
    );
  }

  function renderInputBehaviorPage() {
    return (
      <List navigationTitle="输入行为" navigationBarTitleDisplayMode="inline">
        <Section>
          <Toggle
            title="显示功能行"
            systemImage="rectangle.split.3x1"
            value={settings.showFunctionRow}
            onChanged={(value) =>
              patchSettings({ showFunctionRow: value })}
          />
          <VStack alignment="leading" spacing={8}>
            <HStack>
              <Text>字母长按时长</Text>
              <Text
                font="subheadline"
                foregroundStyle="secondaryLabel"
                frame={{
                  maxWidth: "infinity" as any,
                  alignment: "trailing" as any,
                }}
              >
                {settings.letterLongPressDuration} ms
              </Text>
            </HStack>
            <Slider
              min={LETTER_LONG_PRESS_DURATION_MIN}
              max={LETTER_LONG_PRESS_DURATION_MAX}
              step={10}
              value={settings.letterLongPressDuration}
              onChanged={(value) =>
                patchSettings({
                  letterLongPressDuration: Math.round(value / 10) * 10,
                })}
              label={<Text>字母长按时长</Text>}
              minValueLabel={<Text>短</Text>}
              maxValueLabel={<Text>长</Text>}
            />
          </VStack>
          <Toggle
            title="按键音"
            systemImage="speaker.wave.2"
            value={settings.inputClicks}
            onChanged={(value) =>
              patchSettings({ inputClicks: value })}
          />
          {settings.inputClicks
            ? (
              <VStack alignment="leading" spacing={8}>
                <HStack>
                  <Text>按键音反馈强度</Text>
                  <Text
                    font="subheadline"
                    foregroundStyle="secondaryLabel"
                    frame={{
                      maxWidth: "infinity" as any,
                      alignment: "trailing" as any,
                    }}
                  >
                    {settings.inputClickLevel}
                  </Text>
                </HStack>
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={settings.inputClickLevel}
                  onChanged={(value) =>
                    patchSettings({ inputClickLevel: Math.round(value) })}
                  label={<Text>按键音反馈强度</Text>}
                  minValueLabel={<Text>弱</Text>}
                  maxValueLabel={<Text>强</Text>}
                />
              </VStack>
            )
            : null}
          <Toggle
            title="触感反馈"
            systemImage="iphone.radiowaves.left.and.right"
            value={settings.haptics}
            onChanged={(value) => patchSettings({ haptics: value })}
          />
          {settings.haptics
            ? (
              <VStack alignment="leading" spacing={8}>
                <HStack>
                  <Text>震动反馈强度</Text>
                  <Text
                    font="subheadline"
                    foregroundStyle="secondaryLabel"
                    frame={{
                      maxWidth: "infinity" as any,
                      alignment: "trailing" as any,
                    }}
                  >
                    {settings.hapticLevel}
                  </Text>
                </HStack>
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={settings.hapticLevel}
                  onChanged={(value) =>
                    patchSettings({ hapticLevel: Math.round(value) })}
                  label={<Text>震动反馈强度</Text>}
                  minValueLabel={<Text>弱</Text>}
                  maxValueLabel={<Text>强</Text>}
                />
              </VStack>
            )
            : null}
          <Toggle
            title="键盘启动时轻量部署"
            systemImage="checkmark.seal"
            value={settings.autoDeployOnLaunch}
            onChanged={(value) => patchSettings({ autoDeployOnLaunch: value })}
          />
        </Section>
      </List>
    );
  }

  function renderShiftPage() {
    return (
      <List navigationTitle="Shift 行为" navigationBarTitleDisplayMode="inline">
        <Section>
          <Toggle
            title="预编辑时使用筛选键"
            systemImage="shift"
            value={settings.shiftComposingEnabled}
            onChanged={(value) =>
              patchSettings({ shiftComposingEnabled: value })}
          />
          <ActionConfigRow
            title="预编辑点击动作"
            action={settings.shiftComposingKey}
            mode={settings.shiftComposingKeyMode}
            onActionChanged={(value) =>
              patchSettings({ shiftComposingKey: value })}
            onModeChanged={(value) =>
              patchSettings({ shiftComposingKeyMode: value })}
          />
          <ActionConfigRow
            title="预编辑上划动作"
            action={settings.shiftComposingSwipeUp}
            mode={settings.shiftComposingSwipeUpMode}
            onActionChanged={(value) =>
              patchSettings({ shiftComposingSwipeUp: value })}
            onModeChanged={(value) =>
              patchSettings({ shiftComposingSwipeUpMode: value })}
          />
          <LabeledTextField
            title="预编辑图标"
            value={settings.shiftComposingIcon}
            prompt="SF Symbol"
            onChanged={(value) =>
              patchSettings({ shiftComposingIcon: value })}
          />
        </Section>
      </List>
    );
  }

  function renderModeKeyPage() {
    return (
      <List
        navigationTitle="中英键预编辑行为"
        navigationBarTitleDisplayMode="inline"
      >
        <Section>
          <Toggle
            title="预编辑时使用提示键"
            systemImage="lightbulb"
            value={settings.modeComposingEnabled}
            onChanged={(value) =>
              patchSettings({ modeComposingEnabled: value })}
          />
          <ActionConfigRow
            title="点击动作"
            action={settings.modeComposingAction}
            mode={settings.modeComposingActionMode}
            onActionChanged={(value) =>
              patchSettings({ modeComposingAction: value })}
            onModeChanged={(value) =>
              patchSettings({ modeComposingActionMode: value })}
          />
          <ActionConfigRow
            title="上划动作"
            action={settings.modeComposingSwipeUp}
            mode={settings.modeComposingSwipeUpMode}
            onActionChanged={(value) =>
              patchSettings({ modeComposingSwipeUp: value })}
            onModeChanged={(value) =>
              patchSettings({ modeComposingSwipeUpMode: value })}
          />
          <ActionConfigRow
            title="下划动作"
            action={settings.modeComposingSwipeDown}
            mode={settings.modeComposingSwipeDownMode}
            onActionChanged={(value) =>
              patchSettings({ modeComposingSwipeDown: value })}
            onModeChanged={(value) =>
              patchSettings({ modeComposingSwipeDownMode: value })}
          />
          <LabeledTextField
            title="显示图标"
            value={settings.modeComposingIcon}
            prompt="lightbulb"
            onChanged={(value) => patchSettings({ modeComposingIcon: value })}
          />
        </Section>
      </List>
    );
  }

  function renderNumericPage() {
    return (
      <List navigationTitle="数字键盘" navigationBarTitleDisplayMode="inline">
        <Section
          footer={
            <SettingHint>
              “=” 键上划固定发送给 Rime，用于触发万象方案计算器等功能。
            </SettingHint>
          }
        >
          <LabeledTextField
            title="= 上划"
            value={settings.numericEqualsSwipeUp}
            prompt="V"
            onChanged={(value) =>
              patchSettings({ numericEqualsSwipeUp: value })}
          />
        </Section>
      </List>
    );
  }

  function renderLetterSwipePage(direction: "up" | "down") {
    const isUp = direction === "up";
    return (
      <List
        navigationTitle={isUp ? "字母上划" : "字母下划"}
        navigationBarTitleDisplayMode="inline"
      >
        <Section
          footer={isUp
            ? (
              <SettingHint>
                “自动”会先识别脚本特殊值，再按 Rime 按键/文本发送；“发送给
                Rime”会强制走 Rime.processKey；“直接上屏”会绕过 Rime。
              </SettingHint>
            )
            : undefined}
        >
          {LETTER_KEYS.map((key) => (
            <SwipeConfigRow
              key={(isUp ? "up-" : "down-") + key}
              title={key.toUpperCase() + (isUp ? " 键上划" : " 键下划")}
              action={isUp
                ? settings.letterSwipeUp[key]
                : settings.letterSwipeDown[key]}
              symbol={isUp
                ? settings.letterSwipeUpSymbols[key]
                : settings.letterSwipeDownSymbols[key]}
              mode={isUp
                ? settings.letterSwipeUpModes[key]
                : settings.letterSwipeDownModes[key]}
              onActionChanged={(value) =>
                patchSwipeMap(
                  isUp ? "letterSwipeUp" : "letterSwipeDown",
                  key,
                  value,
                )}
              onSymbolChanged={(value) =>
                patchSwipeMap(
                  isUp ? "letterSwipeUpSymbols" : "letterSwipeDownSymbols",
                  key,
                  value,
                )}
              onModeChanged={(value) =>
                patchSwipeMap(
                  isUp ? "letterSwipeUpModes" : "letterSwipeDownModes",
                  key,
                  value,
                )}
            />
          ))}
        </Section>
      </List>
    );
  }

  function renderFunctionSwipePage(composing: boolean) {
    const keys = composing ? COMPOSING_FUNCTION_KEYS : FUNCTION_KEYS;
    return (
      <List
        navigationTitle={composing ? "功能键 · 预编辑" : "功能键 · 无预编辑"}
        navigationBarTitleDisplayMode="inline"
      >
        <Section
          footer={!composing
            ? (
              <SettingHint>
                可用特殊值：{"{left}"}、{"{right}"}、{"{home}"}、{"{end}"}、{"{selectAll}"}、{"{cut}"}、{"{copy}"}、{"{paste}"}、{"{rimeUp}"}、{"{rimeDown}"}、{"{rimePageUp}"}、{"{rimePageDown}"}、{"{deleteAll}"}、{"{restoreDeleted}"}。
                也可直接填写 Rime 按键名，例如
                Break、backslash、Page_Down、Control+grave。
              </SettingHint>
            )
            : undefined}
        >
          {keys.map((key) => (
            <FunctionSwipeConfigRow
              key={(composing ? "comp-func-" : "idle-func-") + key}
              title={FUNCTION_KEY_LABELS[key]}
              upAction={composing
                ? settings.composingFunctionSwipeUp[key]
                : settings.idleFunctionSwipeUp[key]}
              upMode={composing
                ? settings.composingFunctionSwipeUpModes[key]
                : settings.idleFunctionSwipeUpModes[key]}
              downAction={composing
                ? settings.composingFunctionSwipeDown[key]
                : settings.idleFunctionSwipeDown[key]}
              downMode={composing
                ? settings.composingFunctionSwipeDownModes[key]
                : settings.idleFunctionSwipeDownModes[key]}
              onUpActionChanged={(value) =>
                patchSwipeMap(
                  composing
                    ? "composingFunctionSwipeUp"
                    : "idleFunctionSwipeUp",
                  key,
                  value,
                )}
              onUpModeChanged={(value) =>
                patchSwipeMap(
                  composing
                    ? "composingFunctionSwipeUpModes"
                    : "idleFunctionSwipeUpModes",
                  key,
                  value,
                )}
              onDownActionChanged={(value) =>
                patchSwipeMap(
                  composing
                    ? "composingFunctionSwipeDown"
                    : "idleFunctionSwipeDown",
                  key,
                  value,
                )}
              onDownModeChanged={(value) =>
                patchSwipeMap(
                  composing
                    ? "composingFunctionSwipeDownModes"
                    : "idleFunctionSwipeDownModes",
                  key,
                  value,
                )}
            />
          ))}
        </Section>
      </List>
    );
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Scripting Rime Keyboard"
        navigationBarTitleDisplayMode="inline"
      >
        <Section header={<Text>键盘</Text>}>
          <NavigationLink
            title="键盘外观与颜色"
            destination={renderAppearancePage()}
          />
          <NavigationLink
            title="候选与预编辑"
            destination={renderCandidatePage()}
          />
          <NavigationLink
            title="输入行为"
            destination={renderInputBehaviorPage()}
          />
        </Section>
        <Section header={<Text>按键行为</Text>}>
          <NavigationLink title="Shift 行为" destination={renderShiftPage()} />
          <NavigationLink
            title="中英键预编辑行为"
            destination={renderModeKeyPage()}
          />
          <NavigationLink title="数字键盘" destination={renderNumericPage()} />
        </Section>
        <Section header={<Text>字母上下划</Text>}>
          <NavigationLink
            title="字母上划"
            destination={renderLetterSwipePage("up")}
          />
          <NavigationLink
            title="字母下划"
            destination={renderLetterSwipePage("down")}
          />
        </Section>
        {settings.showFunctionRow
          ? (
            <Section header={<Text>功能行</Text>}>
              <NavigationLink
                title="无预编辑"
                destination={renderFunctionSwipePage(false)}
              />
              <NavigationLink
                title="预编辑"
                destination={renderFunctionSwipePage(true)}
              />
            </Section>
          )
          : null}
        <Section
          footer={
            <VStack alignment="leading" spacing={4}>
              <SettingHint>
                设置保存在 shared Storage，键盘扩展会在下次打开时读取。
              </SettingHint>
              <SettingHint>
                请在系统键盘列表中启用
                Scripting，并为需要剪贴板/网络能力的功能打开完全访问。
              </SettingHint>
            </VStack>
          }
        >
          <Button
            title="恢复默认设置"
            systemImage="arrow.counterclockwise"
            action={resetSettings}
          />
        </Section>
      </List>
    </NavigationStack>
  );
}

async function run() {
  await Navigation.present(<SettingsView />);
  Script.exit();
}

void run();
