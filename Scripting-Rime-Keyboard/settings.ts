export type RimeKeyboardTheme = "system" | "light" | "dark";
export type CandidateRightButtonMode = "dismiss" | "expand" | "hidden";
export type ActionSendMode = "auto" | "rime" | "direct";
export type KeyColorScheme = "light" | "dark";
export type KeyColorPair = Record<KeyColorScheme, string>;
export type KeyColorSettings = {
  normal: KeyColorPair;
  enter: KeyColorPair;
  overrides: Record<string, KeyColorPair>;
};
export type CandidateMenuAction = {
  name: string;
  action: string;
};
export type ToolbarButtonConfig = {
  id: string;
  symbol: string;
  action: string;
};

export type SwipeSettings = Record<string, string>;
export type ActionModeSettings = Record<string, ActionSendMode>;

export type RimeKeyboardSettings = {
  theme: RimeKeyboardTheme;
  useCustomKeyboardHeight: boolean;
  keyboardHeight: number;
  candidateBarHeight: number;
  candidateRightButtonMode: CandidateRightButtonMode;
  customKeyColors: boolean;
  customKeyColorLight: boolean;
  customKeyColorDark: boolean;

  keyColors: KeyColorSettings;
  customKeyFontColors: boolean;
  customKeyFontColorLight: boolean;
  customKeyFontColorDark: boolean;
  keyFontColors: KeyColorSettings;
  customKeyHintColors: boolean;
  customKeyHintColorLight: boolean;
  customKeyHintColorDark: boolean;
  keyHintColors: KeyColorSettings;
  showCandidateComment: boolean;
  candidateMenuCustomEnabled: boolean;
  candidateMenuActions: CandidateMenuAction[];
  showPreeditCaret: boolean;
  showFunctionRow: boolean;
  composingFunctionRowEnabled: boolean;
  composingFunctionWrapDisplayEnabled: boolean;
  showHintSymbols: boolean;
  showWanxiangLabel: boolean;
  spaceLabel: string;
  inlinePreedit: boolean;
  letterSwipeUp: SwipeSettings;
  letterSwipeDown: SwipeSettings;
  letterSwipeUpSymbols: SwipeSettings;
  letterSwipeDownSymbols: SwipeSettings;
  letterSwipeUpModes: ActionModeSettings;
  letterSwipeDownModes: ActionModeSettings;
  idleFunctionSwipeUp: SwipeSettings;
  idleFunctionSwipeDown: SwipeSettings;
  composingFunctionSwipeUp: SwipeSettings;
  composingFunctionSwipeDown: SwipeSettings;
  idleFunctionPress: SwipeSettings;
  idleFunctionSymbols: SwipeSettings;
  composingFunctionPress: SwipeSettings;
  composingFunctionSymbols: SwipeSettings;
  idleFunctionPressModes: ActionModeSettings;
  idleFunctionSwipeUpModes: ActionModeSettings;
  idleFunctionSwipeDownModes: ActionModeSettings;
  composingFunctionPressModes: ActionModeSettings;
  composingFunctionSwipeUpModes: ActionModeSettings;
  composingFunctionSwipeDownModes: ActionModeSettings;
  idleFunctionOrder: string[];
  composingFunctionOrder: string[];
  toolbarLeftButtons: ToolbarButtonConfig[];
  toolbarDismissSymbol: string;
  toolbarExpandSymbol: string;
  shiftComposingEnabled: boolean;
  shiftComposingKey: string;
  shiftComposingKeyMode: ActionSendMode;
  shiftComposingSwipeUp: string;
  shiftComposingSwipeUpMode: ActionSendMode;
  shiftComposingIcon: string;
  modeComposingEnabled: boolean;
  modeComposingAction: string;
  modeComposingActionMode: ActionSendMode;
  modeComposingSwipeUp: string;
  modeComposingSwipeUpMode: ActionSendMode;
  modeComposingSwipeDown: string;
  modeComposingSwipeDownMode: ActionSendMode;
  modeComposingIcon: string;
  backspaceSwipeLeft: string;
  backspaceSwipeLeftMode: ActionSendMode;
  backspaceSwipeUp: string;
  backspaceSwipeUpMode: ActionSendMode;
  backspaceComposingSwipeUp: string;
  backspaceComposingSwipeUpMode: ActionSendMode;
  backspaceSwipeDown: string;
  backspaceSwipeDownMode: ActionSendMode;
  numericEqualsSwipeUp: string;
  letterLongPressDuration: number;
  swipeTriggerDistance: number;
  inputClicks: boolean;
  inputClickLevel: number;
  haptics: boolean;
  hapticLevel: number;
  autoDeployOnLaunch: boolean;
};

const SETTINGS_KEY = "rime_pinyin_keyboard_settings_v1";
const LEGACY_SHARED_OPTIONS = { shared: true };

export const LETTER_KEYS = "qwertyuiopasdfghjklzxcvbnm".split("");

export const DEFAULT_LETTER_SWIPE_UP: SwipeSettings = {
  q: "1",
  w: "2",
  e: "3",
  r: "4",
  t: "5",
  y: "6",
  u: "7",
  i: "8",
  o: "9",
  p: "0",
  a: "、",
  s: "-",
  d: "=",
  f: "[",
  g: "]",
  h: "\\",
  j: "/",
  k: ":",
  l: '"',
  z: "\t",
  x: "[",
  c: "]",
  v: "<",
  b: ">",
  n: "!",
  m: "?",
};

export const DEFAULT_LETTER_SWIPE_DOWN: SwipeSettings = {
  q: "~",
  w: "@",
  e: "#",
  r: "$",
  t: "%",
  y: "^",
  u: "&",
  i: "*",
  o: "(",
  p: ")",
  a: "`",
  s: "_",
  d: "+",
  f: "{",
  g: "}",
  h: "|",
  j: ".",
  k: ";",
  l: "'",
  z: "V",
  x: "onl",
  c: "orc",
  v: "osj",
  b: "R",
  n: "N",
  m: "`",
};

export const DEFAULT_LETTER_SWIPE_SYMBOLS: SwipeSettings = {
  q: "",
  w: "",
  e: "",
  r: "",
  t: "",
  y: "",
  u: "",
  i: "",
  o: "",
  p: "",
  a: "",
  s: "",
  d: "",
  f: "",
  g: "",
  h: "",
  j: "",
  k: "",
  l: "",
  z: "arrow.right.to.line",
  x: "",
  c: "",
  v: "",
  b: "",
  n: "",
  m: "",
};

export const DEFAULT_LETTER_SWIPE_DOWN_SYMBOLS: SwipeSettings = {
  ...DEFAULT_LETTER_SWIPE_SYMBOLS,
  z: "av.remote.fill",
  x: "clock.arrow.circlepath",
  c: "calendar",
  v: "clock.circle",
  b: "yensign.circle",
  n: "calendar.badge.exclamationmark",
  m: "rectangle.3.group.fill",
};

export const FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN: SwipeSettings = {
  a: "{toggleSelectAll}",
  x: "{cut}",
  c: "{copy}",
  v: "{paste}",
  b: "{home}",
  n: "{end}",
};

export const FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN_SYMBOLS: SwipeSettings = {
  a: "selection.pin.in.out",
  x: "scissors",
  c: "doc.on.doc",
  v: "doc.on.clipboard",
  b: "text.line.first.and.arrowtriangle.forward",
  n: "text.line.last.and.arrowtriangle.forward",
};

export const DEFAULT_LETTER_ACTION_MODES: ActionModeSettings = Object
  .fromEntries(LETTER_KEYS.map((key) => [key, "auto" as ActionSendMode]));

export const FUNCTION_KEYS = [
  "left",
  "head",
  "select",
  "cut",
  "copy",
  "paste",
  "tail",
  "right",
];
export const COMPOSING_FUNCTION_KEYS = [
  "left",
  "page",
  "tone1",
  "tone2",
  "tone3",
  "tone4",
  "filter",
  "right",
];
export const DEFAULT_TOOLBAR_LEFT_BUTTONS: ToolbarButtonConfig[] = [
  { id: "home", symbol: "house", action: "{keyboardHome}" },
  { id: "settings", symbol: "gearshape", action: "{keyboardSettings}" },
  { id: "schema", symbol: "list.bullet.rectangle", action: "{schemaMenu}" },
];
export const TOOLBAR_LEFT_BUTTON_MAX = 6;

export const DEFAULT_IDLE_FUNCTION_SWIPE_UP: SwipeSettings = {
  left: "{home}",
  head: "{home}",
  select: "{toggleSelectAll}",
  cut: "{cut}",
  copy: "{copy}",
  paste: "{paste}",
  tail: "{end}",
  right: "{end}",
};

export const DEFAULT_IDLE_FUNCTION_SWIPE_DOWN: SwipeSettings = {
  left: "{left}",
  head: "{home}",
  select: "{toggleSelectAll}",
  cut: "{cut}",
  copy: "{copy}",
  paste: "{paste}",
  tail: "{end}",
  right: "{right}",
};

export const DEFAULT_IDLE_FUNCTION_PRESS: SwipeSettings = {
  left: "{left}",
  head: "{home}",
  select: "{toggleSelectAll}",
  cut: "{cut}",
  copy: "{copy}",
  paste: "{paste}",
  tail: "{end}",
  right: "{right}",
};

export const DEFAULT_IDLE_FUNCTION_SYMBOLS: SwipeSettings = {
  left: "arrow.left",
  head: "text.line.first.and.arrowtriangle.forward",
  select: "selection.pin.in.out",
  cut: "scissors",
  copy: "doc.on.doc",
  paste: "doc.on.clipboard",
  tail: "text.line.last.and.arrowtriangle.forward",
  right: "arrow.right",
};

export const DEFAULT_FUNCTION_ACTION_MODES: ActionModeSettings = Object
  .fromEntries(
    FUNCTION_KEYS.map((key) => [key, "auto" as ActionSendMode]),
  );

export const DEFAULT_COMPOSING_FUNCTION_SWIPE_UP: SwipeSettings = {
  left: "[",
  page: "{rimePageUp}",
  tone1: "{control+1}",
  tone2: "{control+2}",
  tone3: "{control+3}",
  tone4: "{control+4}",
  filter: "\\",
  right: "]",
};

export const DEFAULT_COMPOSING_FUNCTION_SWIPE_DOWN: SwipeSettings = {
  left: "{rimeUp}",
  page: "{rimePageDown}",
  tone1: "{control+1}",
  tone2: "{control+2}",
  tone3: "{control+3}",
  tone4: "{control+4}",
  filter: "\\",
  right: "{rimeDown}",
};

export const DEFAULT_COMPOSING_FUNCTION_PRESS: SwipeSettings = {
  left: "{rimeUp}",
  page: "{rimePageDown}",
  tone1: "7",
  tone2: "8",
  tone3: "9",
  tone4: "0",
  filter: "backslash",
  right: "{rimeDown}",
};

export const DEFAULT_COMPOSING_FUNCTION_SYMBOLS: SwipeSettings = {
  left: "arrow.left",
  page: "arrow.up.arrow.down",
  tone1: "1.circle",
  tone2: "2.circle",
  tone3: "3.circle",
  tone4: "4.circle",
  filter: "viewfinder",
  right: "arrow.right",
};

export const DEFAULT_COMPOSING_FUNCTION_ACTION_MODES: ActionModeSettings =
  Object.fromEntries(
    COMPOSING_FUNCTION_KEYS.map((key) => [key, "auto" as ActionSendMode]),
  );

export const DEFAULT_KEY_COLORS: KeyColorSettings = {
  normal: {
    light: "#ffffff",
    dark: "#5f6064",
  },
  enter: {
    light: "#ffffff",
    dark: "#5f6064",
  },
  overrides: {},
};

export const DEFAULT_KEY_FONT_COLORS: KeyColorSettings = {
  normal: {
    light: "#000000",
    dark: "#f5f5f7",
  },
  enter: {
    light: "#000000",
    dark: "#f5f5f7",
  },
  overrides: {},
};

export const DEFAULT_KEY_HINT_COLORS: KeyColorSettings = {
  normal: {
    light: "#8a8a8e",
    dark: "#b2b2b7",
  },
  enter: {
    light: "#8a8a8e",
    dark: "#b2b2b7",
  },
  overrides: {},
};

export const DEFAULT_CANDIDATE_MENU_ACTIONS: CandidateMenuAction[] = [
  { name: "左移", action: "Control+j" },
  { name: "右移", action: "Control+k" },
  { name: "重置", action: "Control+l" },
  { name: "置顶", action: "Control+p" },
  { name: "移除", action: "Control+Delete" },
];

export const DEFAULT_RIME_KEYBOARD_SETTINGS: RimeKeyboardSettings = {
  theme: "system",
  useCustomKeyboardHeight: false,
  keyboardHeight: 326,
  candidateBarHeight: 45,
  candidateRightButtonMode: "dismiss",
  customKeyColors: false,
  customKeyColorLight: false,
  customKeyColorDark: false,
  keyColors: DEFAULT_KEY_COLORS,
  customKeyFontColors: false,
  customKeyFontColorLight: false,
  customKeyFontColorDark: false,
  keyFontColors: DEFAULT_KEY_FONT_COLORS,
  customKeyHintColors: false,
  customKeyHintColorLight: false,
  customKeyHintColorDark: false,
  keyHintColors: DEFAULT_KEY_HINT_COLORS,
  showCandidateComment: true,
  candidateMenuCustomEnabled: false,
  candidateMenuActions: [],
  showPreeditCaret: true,
  showFunctionRow: true,
  composingFunctionRowEnabled: true,
  composingFunctionWrapDisplayEnabled: true,
  showHintSymbols: true,
  showWanxiangLabel: true,
  spaceLabel: "万象",
  inlinePreedit: true,
  letterSwipeUp: DEFAULT_LETTER_SWIPE_UP,
  letterSwipeDown: DEFAULT_LETTER_SWIPE_DOWN,
  letterSwipeUpSymbols: DEFAULT_LETTER_SWIPE_SYMBOLS,
  letterSwipeDownSymbols: DEFAULT_LETTER_SWIPE_DOWN_SYMBOLS,
  letterSwipeUpModes: DEFAULT_LETTER_ACTION_MODES,
  letterSwipeDownModes: DEFAULT_LETTER_ACTION_MODES,
  idleFunctionSwipeUp: DEFAULT_IDLE_FUNCTION_SWIPE_UP,
  idleFunctionSwipeDown: DEFAULT_IDLE_FUNCTION_SWIPE_DOWN,
  composingFunctionSwipeUp: DEFAULT_COMPOSING_FUNCTION_SWIPE_UP,
  composingFunctionSwipeDown: DEFAULT_COMPOSING_FUNCTION_SWIPE_DOWN,
  idleFunctionPress: DEFAULT_IDLE_FUNCTION_PRESS,
  idleFunctionSymbols: DEFAULT_IDLE_FUNCTION_SYMBOLS,
  composingFunctionPress: DEFAULT_COMPOSING_FUNCTION_PRESS,
  composingFunctionSymbols: DEFAULT_COMPOSING_FUNCTION_SYMBOLS,
  idleFunctionPressModes: DEFAULT_FUNCTION_ACTION_MODES,
  idleFunctionSwipeUpModes: DEFAULT_FUNCTION_ACTION_MODES,
  idleFunctionSwipeDownModes: DEFAULT_FUNCTION_ACTION_MODES,
  composingFunctionPressModes: DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
  composingFunctionSwipeUpModes: DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
  composingFunctionSwipeDownModes: DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
  idleFunctionOrder: FUNCTION_KEYS,
  composingFunctionOrder: COMPOSING_FUNCTION_KEYS,
  toolbarLeftButtons: DEFAULT_TOOLBAR_LEFT_BUTTONS,
  toolbarDismissSymbol: "keyboard.chevron.compact.down",
  toolbarExpandSymbol: "chevron.down.circle",
  shiftComposingEnabled: true,
  shiftComposingKey: "/",
  shiftComposingKeyMode: "auto",
  shiftComposingSwipeUp: "`",
  shiftComposingSwipeUpMode: "auto",
  shiftComposingIcon: "inset.filled.lefthalf.arrow.left.rectangle",
  modeComposingEnabled: true,
  modeComposingAction: ",",
  modeComposingActionMode: "auto",
  modeComposingSwipeUp: "",
  modeComposingSwipeUpMode: "auto",
  modeComposingSwipeDown: "",
  modeComposingSwipeDownMode: "auto",
  modeComposingIcon: "lightbulb",
  backspaceSwipeLeft: "{clearComposition}",
  backspaceSwipeLeftMode: "auto",
  backspaceSwipeUp: "{deleteAll}",
  backspaceSwipeUpMode: "auto",
  backspaceComposingSwipeUp: "{clearComposition}",
  backspaceComposingSwipeUpMode: "auto",
  backspaceSwipeDown: "{restoreDeleted}",
  backspaceSwipeDownMode: "auto",
  numericEqualsSwipeUp: "V",
  letterLongPressDuration: 520,
  swipeTriggerDistance: 80,
  inputClicks: true,
  inputClickLevel: 3,
  haptics: true,
  hapticLevel: 1,
  autoDeployOnLaunch: false,
};

export const KEYBOARD_HEIGHT_MIN = 286;
export const KEYBOARD_HEIGHT_MAX = 390;
export const CANDIDATE_BAR_HEIGHT_MIN = 34;
export const CANDIDATE_BAR_HEIGHT_MAX = 56;
export const LETTER_LONG_PRESS_DURATION_MIN = 360;
export const LETTER_LONG_PRESS_DURATION_MAX = 900;
export const SWIPE_TRIGGER_DISTANCE_MIN = 40;
export const SWIPE_TRIGGER_DISTANCE_MAX = 120;

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.min(max, Math.max(min, rounded));
}

function normalizeTheme(value: unknown): RimeKeyboardTheme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function normalizeCandidateRightButtonMode(
  value: unknown,
): CandidateRightButtonMode {
  return value === "expand" || value === "hidden" || value === "dismiss"
    ? value
    : "dismiss";
}

function normalizeActionSendMode(value: unknown): ActionSendMode {
  return value === "rime" || value === "direct" || value === "auto"
    ? value
    : "auto";
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeColorPair(
  raw: unknown,
  defaults: KeyColorPair,
): KeyColorPair {
  const source = raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
  return {
    light: normalizeColor(source.light, defaults.light),
    dark: normalizeColor(source.dark, defaults.dark),
  };
}

function normalizeKeyColors(
  raw: unknown,
  defaults: KeyColorSettings,
): KeyColorSettings {
  const source = raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
  const overrideSource =
    source.overrides && typeof source.overrides === "object"
      ? (source.overrides as Record<string, unknown>)
      : {};
  const overrides: Record<string, KeyColorPair> = {};
  for (const [key, value] of Object.entries(overrideSource)) {
    if (!key) continue;
    const fallback = key === "enter" || key === "numeric-enter"
      ? defaults.enter
      : defaults.normal;
    overrides[key] = normalizeColorPair(value, {
      light: fallback.light,
      dark: fallback.dark,
    });
  }
  return {
    normal: normalizeColorPair(source.normal, defaults.normal),
    enter: normalizeColorPair(source.enter, defaults.enter),
    overrides,
  };
}

function normalizeCandidateMenuActions(raw: unknown): CandidateMenuAction[] {
  if (!Array.isArray(raw)) return [];
  const result: CandidateMenuAction[] = [];
  for (const item of raw.slice(0, 8)) {
    const source = item && typeof item === "object"
      ? (item as Record<string, unknown>)
      : {};
    const name = typeof source.name === "string" ? source.name : "";
    const action = typeof source.action === "string" ? source.action : "";
    if (!name && !action) continue;
    result.push({ name, action });
  }
  return result;
}

function fallbackToolbarButtonId(
  index: number,
  symbol: string,
  action: string,
) {
  const seed = `${index}-${symbol}-${action}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `toolbar-${index}-${Math.abs(hash)}`;
}

function normalizeToolbarButtons(raw: unknown): ToolbarButtonConfig[] {
  const source = Array.isArray(raw) ? raw : DEFAULT_TOOLBAR_LEFT_BUTTONS;
  const result: ToolbarButtonConfig[] = [];
  for (
    const [index, item] of source.slice(0, TOOLBAR_LEFT_BUTTON_MAX)
      .entries()
  ) {
    const data = item && typeof item === "object"
      ? (item as Record<string, unknown>)
      : {};
    const id = typeof data.id === "string" && data.id.trim()
      ? data.id.trim()
      : "";
    const symbol = typeof data.symbol === "string" ? data.symbol.trim() : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    if (!symbol && !action) continue;
    result.push({
      id: id || fallbackToolbarButtonId(index, symbol, action),
      symbol,
      action,
    });
  }
  return result;
}

function normalizeOrder(raw: unknown, defaults: string[]) {
  const result: string[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (
        typeof value === "string" && defaults.includes(value) &&
        !result.includes(value)
      ) {
        result.push(value);
      }
    }
  }
  for (const key of defaults) {
    if (!result.includes(key)) result.push(key);
  }
  return result;
}

function normalizeSwipeSettings(
  raw: unknown,
  defaults: SwipeSettings,
  keys: string[],
): SwipeSettings {
  const source = raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
  const result: SwipeSettings = {};
  for (const key of keys) {
    const value = source[key];
    result[key] = typeof value === "string" ? value : (defaults[key] ?? "");
  }
  return result;
}

function normalizeActionModeSettings(
  raw: unknown,
  defaults: ActionModeSettings,
  keys: string[],
): ActionModeSettings {
  const source = raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
  const result: ActionModeSettings = {};
  for (const key of keys) {
    result[key] = normalizeActionSendMode(source[key] ?? defaults[key]);
  }
  return result;
}

function normalizeLetterSwipeUpSymbols(raw: unknown): SwipeSettings {
  const result = normalizeSwipeSettings(
    raw,
    DEFAULT_LETTER_SWIPE_SYMBOLS,
    LETTER_KEYS,
  );
  if (!result.z) result.z = DEFAULT_LETTER_SWIPE_SYMBOLS.z;
  return result;
}

function migrateComposingSwipeSettings(
  raw: unknown,
  defaults: SwipeSettings,
  direction: "up" | "down",
): SwipeSettings {
  const normalized = normalizeSwipeSettings(
    raw,
    defaults,
    COMPOSING_FUNCTION_KEYS,
  );
  const legacyToneValues = direction === "up"
    ? { tone1: "1", tone2: "2", tone3: "3", tone4: "4" }
    : { tone1: "7", tone2: "8", tone3: "9", tone4: "0" };
  for (const key of ["tone1", "tone2", "tone3", "tone4"]) {
    if (
      normalized[key] === legacyToneValues[key as keyof typeof legacyToneValues]
    ) {
      normalized[key] = defaults[key];
    }
  }
  if (normalized.filter === "{backslash}") normalized.filter = defaults.filter;
  return normalized;
}

export function normalizeRimeKeyboardSettings(raw: any): RimeKeyboardSettings {
  const normalized: RimeKeyboardSettings = {
    theme: normalizeTheme(raw?.theme),
    useCustomKeyboardHeight: typeof raw?.useCustomKeyboardHeight === "boolean"
      ? raw.useCustomKeyboardHeight
      : false,
    keyboardHeight: clampNumber(
      raw?.keyboardHeight,
      DEFAULT_RIME_KEYBOARD_SETTINGS.keyboardHeight,
      KEYBOARD_HEIGHT_MIN,
      KEYBOARD_HEIGHT_MAX,
    ),
    candidateBarHeight: clampNumber(
      raw?.candidateBarHeight,
      DEFAULT_RIME_KEYBOARD_SETTINGS.candidateBarHeight,
      CANDIDATE_BAR_HEIGHT_MIN,
      CANDIDATE_BAR_HEIGHT_MAX,
    ),
    candidateRightButtonMode: normalizeCandidateRightButtonMode(
      raw?.candidateRightButtonMode,
    ),
    customKeyColors: typeof raw?.customKeyColors === "boolean"
      ? raw.customKeyColors
      : false,
    customKeyColorLight: typeof raw?.customKeyColorLight === "boolean"
      ? raw.customKeyColorLight
      : false,
    customKeyColorDark: typeof raw?.customKeyColorDark === "boolean"
      ? raw.customKeyColorDark
      : Boolean(raw?.customKeyColors),
    keyColors: normalizeKeyColors(raw?.keyColors, DEFAULT_KEY_COLORS),
    customKeyFontColors: typeof raw?.customKeyFontColors === "boolean"
      ? raw.customKeyFontColors
      : false,
    customKeyFontColorLight: typeof raw?.customKeyFontColorLight === "boolean"
      ? raw.customKeyFontColorLight
      : false,
    customKeyFontColorDark: typeof raw?.customKeyFontColorDark === "boolean"
      ? raw.customKeyFontColorDark
      : Boolean(raw?.customKeyFontColors),
    keyFontColors: normalizeKeyColors(
      raw?.keyFontColors,
      DEFAULT_KEY_FONT_COLORS,
    ),
    customKeyHintColors: typeof raw?.customKeyHintColors === "boolean"
      ? raw.customKeyHintColors
      : false,
    customKeyHintColorLight: typeof raw?.customKeyHintColorLight === "boolean"
      ? raw.customKeyHintColorLight
      : false,
    customKeyHintColorDark: typeof raw?.customKeyHintColorDark === "boolean"
      ? raw.customKeyHintColorDark
      : Boolean(raw?.customKeyHintColors),
    keyHintColors: normalizeKeyColors(
      raw?.keyHintColors,
      DEFAULT_KEY_HINT_COLORS,
    ),
    showCandidateComment: typeof raw?.showCandidateComment === "boolean"
      ? raw.showCandidateComment
      : raw?.candidateCommentMode !== "hidden",
    candidateMenuCustomEnabled:
      typeof raw?.candidateMenuCustomEnabled === "boolean"
        ? raw.candidateMenuCustomEnabled
        : false,
    candidateMenuActions: normalizeCandidateMenuActions(
      raw?.candidateMenuActions,
    ),
    showPreeditCaret: typeof raw?.showPreeditCaret === "boolean"
      ? raw.showPreeditCaret
      : true,
    showFunctionRow: typeof raw?.showFunctionRow === "boolean"
      ? raw.showFunctionRow
      : true,
    composingFunctionRowEnabled:
      typeof raw?.composingFunctionRowEnabled === "boolean"
        ? raw.composingFunctionRowEnabled
        : true,
    composingFunctionWrapDisplayEnabled:
      typeof raw?.composingFunctionWrapDisplayEnabled === "boolean"
        ? raw.composingFunctionWrapDisplayEnabled
        : true,
    showHintSymbols: typeof raw?.showHintSymbols === "boolean"
      ? raw.showHintSymbols
      : true,
    showWanxiangLabel: typeof raw?.showWanxiangLabel === "boolean"
      ? raw.showWanxiangLabel
      : true,
    spaceLabel: typeof raw?.spaceLabel === "string" ? raw.spaceLabel : "万象",
    inlinePreedit: typeof raw?.inlinePreedit === "boolean"
      ? raw.inlinePreedit
      : true,
    letterSwipeUp: normalizeSwipeSettings(
      raw?.letterSwipeUp,
      DEFAULT_LETTER_SWIPE_UP,
      LETTER_KEYS,
    ),
    letterSwipeDown: normalizeSwipeSettings(
      raw?.letterSwipeDown,
      DEFAULT_LETTER_SWIPE_DOWN,
      LETTER_KEYS,
    ),
    letterSwipeUpSymbols: normalizeLetterSwipeUpSymbols(
      raw?.letterSwipeUpSymbols,
    ),
    letterSwipeDownSymbols: normalizeSwipeSettings(
      raw?.letterSwipeDownSymbols,
      DEFAULT_LETTER_SWIPE_DOWN_SYMBOLS,
      LETTER_KEYS,
    ),
    letterSwipeUpModes: normalizeActionModeSettings(
      raw?.letterSwipeUpModes,
      DEFAULT_LETTER_ACTION_MODES,
      LETTER_KEYS,
    ),
    letterSwipeDownModes: normalizeActionModeSettings(
      raw?.letterSwipeDownModes,
      DEFAULT_LETTER_ACTION_MODES,
      LETTER_KEYS,
    ),
    idleFunctionSwipeUp: normalizeSwipeSettings(
      raw?.idleFunctionSwipeUp,
      DEFAULT_IDLE_FUNCTION_SWIPE_UP,
      FUNCTION_KEYS,
    ),
    idleFunctionSwipeDown: normalizeSwipeSettings(
      raw?.idleFunctionSwipeDown,
      DEFAULT_IDLE_FUNCTION_SWIPE_DOWN,
      FUNCTION_KEYS,
    ),
    composingFunctionSwipeUp: migrateComposingSwipeSettings(
      raw?.composingFunctionSwipeUp,
      DEFAULT_COMPOSING_FUNCTION_SWIPE_UP,
      "up",
    ),
    composingFunctionSwipeDown: migrateComposingSwipeSettings(
      raw?.composingFunctionSwipeDown,
      DEFAULT_COMPOSING_FUNCTION_SWIPE_DOWN,
      "down",
    ),
    idleFunctionPress: normalizeSwipeSettings(
      raw?.idleFunctionPress,
      DEFAULT_IDLE_FUNCTION_PRESS,
      FUNCTION_KEYS,
    ),
    idleFunctionSymbols: normalizeSwipeSettings(
      raw?.idleFunctionSymbols,
      DEFAULT_IDLE_FUNCTION_SYMBOLS,
      FUNCTION_KEYS,
    ),
    composingFunctionPress: normalizeSwipeSettings(
      raw?.composingFunctionPress,
      DEFAULT_COMPOSING_FUNCTION_PRESS,
      COMPOSING_FUNCTION_KEYS,
    ),
    composingFunctionSymbols: normalizeSwipeSettings(
      raw?.composingFunctionSymbols,
      DEFAULT_COMPOSING_FUNCTION_SYMBOLS,
      COMPOSING_FUNCTION_KEYS,
    ),
    idleFunctionPressModes: normalizeActionModeSettings(
      raw?.idleFunctionPressModes,
      DEFAULT_FUNCTION_ACTION_MODES,
      FUNCTION_KEYS,
    ),
    idleFunctionSwipeUpModes: normalizeActionModeSettings(
      raw?.idleFunctionSwipeUpModes,
      DEFAULT_FUNCTION_ACTION_MODES,
      FUNCTION_KEYS,
    ),
    idleFunctionSwipeDownModes: normalizeActionModeSettings(
      raw?.idleFunctionSwipeDownModes,
      DEFAULT_FUNCTION_ACTION_MODES,
      FUNCTION_KEYS,
    ),
    composingFunctionPressModes: normalizeActionModeSettings(
      raw?.composingFunctionPressModes,
      DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
      COMPOSING_FUNCTION_KEYS,
    ),
    composingFunctionSwipeUpModes: normalizeActionModeSettings(
      raw?.composingFunctionSwipeUpModes,
      DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
      COMPOSING_FUNCTION_KEYS,
    ),
    composingFunctionSwipeDownModes: normalizeActionModeSettings(
      raw?.composingFunctionSwipeDownModes,
      DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
      COMPOSING_FUNCTION_KEYS,
    ),
    idleFunctionOrder: normalizeOrder(raw?.idleFunctionOrder, FUNCTION_KEYS),
    composingFunctionOrder: normalizeOrder(
      raw?.composingFunctionOrder,
      COMPOSING_FUNCTION_KEYS,
    ),
    toolbarLeftButtons: normalizeToolbarButtons(raw?.toolbarLeftButtons),
    toolbarDismissSymbol: typeof raw?.toolbarDismissSymbol === "string"
      ? raw.toolbarDismissSymbol
      : DEFAULT_RIME_KEYBOARD_SETTINGS.toolbarDismissSymbol,
    toolbarExpandSymbol: typeof raw?.toolbarExpandSymbol === "string"
      ? raw.toolbarExpandSymbol
      : DEFAULT_RIME_KEYBOARD_SETTINGS.toolbarExpandSymbol,
    shiftComposingEnabled: typeof raw?.shiftComposingEnabled === "boolean"
      ? raw.shiftComposingEnabled
      : true,
    shiftComposingKey: typeof raw?.shiftComposingKey === "string"
      ? raw.shiftComposingKey
      : "/",
    shiftComposingKeyMode: normalizeActionSendMode(raw?.shiftComposingKeyMode),
    shiftComposingSwipeUp: typeof raw?.shiftComposingSwipeUp === "string"
      ? raw.shiftComposingSwipeUp
      : "`",
    shiftComposingSwipeUpMode: normalizeActionSendMode(
      raw?.shiftComposingSwipeUpMode,
    ),
    shiftComposingIcon: typeof raw?.shiftComposingIcon === "string"
      ? raw.shiftComposingIcon
      : "inset.filled.lefthalf.arrow.left.rectangle",
    modeComposingEnabled: typeof raw?.modeComposingEnabled === "boolean"
      ? raw.modeComposingEnabled
      : true,
    modeComposingAction: typeof raw?.modeComposingAction === "string"
      ? raw.modeComposingAction === "{commitComposition}"
        ? ","
        : raw.modeComposingAction
      : ",",
    modeComposingActionMode: normalizeActionSendMode(
      raw?.modeComposingActionMode,
    ),
    modeComposingSwipeUp: typeof raw?.modeComposingSwipeUp === "string"
      ? raw.modeComposingSwipeUp
      : "",
    modeComposingSwipeUpMode: normalizeActionSendMode(
      raw?.modeComposingSwipeUpMode,
    ),
    modeComposingSwipeDown: typeof raw?.modeComposingSwipeDown === "string"
      ? raw.modeComposingSwipeDown
      : "",
    modeComposingSwipeDownMode: normalizeActionSendMode(
      raw?.modeComposingSwipeDownMode,
    ),
    modeComposingIcon: typeof raw?.modeComposingIcon === "string"
      ? raw.modeComposingIcon
      : "lightbulb",
    backspaceSwipeLeft: typeof raw?.backspaceSwipeLeft === "string"
      ? raw.backspaceSwipeLeft
      : DEFAULT_RIME_KEYBOARD_SETTINGS.backspaceSwipeLeft,
    backspaceSwipeLeftMode: normalizeActionSendMode(
      raw?.backspaceSwipeLeftMode,
    ),
    backspaceSwipeUp: typeof raw?.backspaceSwipeUp === "string"
      ? raw.backspaceSwipeUp
      : DEFAULT_RIME_KEYBOARD_SETTINGS.backspaceSwipeUp,
    backspaceSwipeUpMode: normalizeActionSendMode(raw?.backspaceSwipeUpMode),
    backspaceComposingSwipeUp:
      typeof raw?.backspaceComposingSwipeUp === "string"
        ? raw.backspaceComposingSwipeUp
        : DEFAULT_RIME_KEYBOARD_SETTINGS.backspaceComposingSwipeUp,
    backspaceComposingSwipeUpMode: normalizeActionSendMode(
      raw?.backspaceComposingSwipeUpMode,
    ),
    backspaceSwipeDown: typeof raw?.backspaceSwipeDown === "string"
      ? raw.backspaceSwipeDown
      : DEFAULT_RIME_KEYBOARD_SETTINGS.backspaceSwipeDown,
    backspaceSwipeDownMode: normalizeActionSendMode(
      raw?.backspaceSwipeDownMode,
    ),
    numericEqualsSwipeUp: typeof raw?.numericEqualsSwipeUp === "string"
      ? raw.numericEqualsSwipeUp
      : "V",
    letterLongPressDuration: clampNumber(
      raw?.letterLongPressDuration,
      DEFAULT_RIME_KEYBOARD_SETTINGS.letterLongPressDuration,
      LETTER_LONG_PRESS_DURATION_MIN,
      LETTER_LONG_PRESS_DURATION_MAX,
    ),
    swipeTriggerDistance: clampNumber(
      raw?.swipeTriggerDistance,
      DEFAULT_RIME_KEYBOARD_SETTINGS.swipeTriggerDistance,
      SWIPE_TRIGGER_DISTANCE_MIN,
      SWIPE_TRIGGER_DISTANCE_MAX,
    ),
    inputClicks: typeof raw?.inputClicks === "boolean" ? raw.inputClicks : true,
    inputClickLevel: clampNumber(raw?.inputClickLevel, 3, 1, 5),
    haptics: typeof raw?.haptics === "boolean" ? raw.haptics : true,
    hapticLevel: clampNumber(raw?.hapticLevel, 1, 1, 5),
    autoDeployOnLaunch: typeof raw?.autoDeployOnLaunch === "boolean"
      ? raw.autoDeployOnLaunch
      : false,
  };
  if (normalized.composingFunctionPress.filter === "{backslashWrap}") {
    normalized.composingFunctionPress.filter =
      DEFAULT_COMPOSING_FUNCTION_PRESS.filter;
  }
  if (normalized.idleFunctionSwipeUp.select === "") {
    normalized.idleFunctionSwipeUp.select =
      DEFAULT_IDLE_FUNCTION_SWIPE_UP.select;
    normalized.idleFunctionSwipeUpModes.select = "auto";
  }
  if (normalized.idleFunctionSwipeDown.select === "") {
    normalized.idleFunctionSwipeDown.select =
      DEFAULT_IDLE_FUNCTION_SWIPE_DOWN.select;
    normalized.idleFunctionSwipeDownModes.select = "auto";
  }
  if (!normalized.showFunctionRow) {
    for (
      const key of Object.keys(FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN)
    ) {
      const rawAction = raw?.letterSwipeDown?.[key];
      if (
        typeof rawAction !== "string" ||
        rawAction === DEFAULT_LETTER_SWIPE_DOWN[key] ||
        (key === "a" && rawAction === "{selectAll}")
      ) {
        normalized.letterSwipeDown[key] =
          FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN[key];
        normalized.letterSwipeDownModes[key] = "auto";
      }

      const rawSymbol = raw?.letterSwipeDownSymbols?.[key];
      if (
        typeof rawSymbol !== "string" ||
        rawSymbol === DEFAULT_LETTER_SWIPE_DOWN_SYMBOLS[key]
      ) {
        normalized.letterSwipeDownSymbols[key] =
          FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN_SYMBOLS[key];
      }
    }
  } else {
    for (
      const key of Object.keys(FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN)
    ) {
      if (
        normalized.letterSwipeDown[key] ===
          FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN[key]
      ) {
        normalized.letterSwipeDown[key] = DEFAULT_LETTER_SWIPE_DOWN[key];
        normalized.letterSwipeDownModes[key] = "auto";
      }
      if (
        normalized.letterSwipeDownSymbols[key] ===
          FUNCTION_ROW_OFF_LETTER_SWIPE_DOWN_SYMBOLS[key]
      ) {
        normalized.letterSwipeDownSymbols[key] =
          DEFAULT_LETTER_SWIPE_DOWN_SYMBOLS[key];
      }
    }
  }
  return normalized;
}

function getRawSettings(): unknown {
  const st = (globalThis as any).Storage;
  try {
    const local = st?.get?.(SETTINGS_KEY) ??
      st?.getString?.(SETTINGS_KEY);
    if (local != null) return local;
  } catch {}
  try {
    const legacyShared = st?.get?.(SETTINGS_KEY, LEGACY_SHARED_OPTIONS) ??
      st?.getString?.(SETTINGS_KEY, LEGACY_SHARED_OPTIONS);
    if (legacyShared == null) return null;
    try {
      if (
        typeof legacyShared === "string" && typeof st?.setString === "function"
      ) {
        st.setString(SETTINGS_KEY, legacyShared);
      } else st?.set?.(SETTINGS_KEY, legacyShared);
      st?.remove?.(SETTINGS_KEY, LEGACY_SHARED_OPTIONS);
    } catch {}
    return legacyShared;
  } catch {
    return null;
  }
}

export function loadRimeKeyboardSettings(): RimeKeyboardSettings {
  const raw = getRawSettings();
  if (raw == null) return DEFAULT_RIME_KEYBOARD_SETTINGS;
  if (typeof raw === "string") {
    try {
      return normalizeRimeKeyboardSettings(JSON.parse(raw));
    } catch {
      return DEFAULT_RIME_KEYBOARD_SETTINGS;
    }
  }
  return normalizeRimeKeyboardSettings(raw);
}

export function saveRimeKeyboardSettings(
  settings: RimeKeyboardSettings,
): RimeKeyboardSettings {
  const normalized = normalizeRimeKeyboardSettings(settings);
  const st = (globalThis as any).Storage;
  if (!st) return normalized;
  try {
    if (typeof st.set === "function") {
      st.set(SETTINGS_KEY, normalized);
    } else if (typeof st.setString === "function") {
      const raw = JSON.stringify(normalized);
      st.setString(SETTINGS_KEY, raw);
    }
    st.remove?.(SETTINGS_KEY, LEGACY_SHARED_OPTIONS);
  } catch {}
  return normalized;
}
