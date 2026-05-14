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
  showCandidateComment: boolean;
  showPreeditCaret: boolean;
  showFunctionRow: boolean;
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
  idleFunctionSwipeUpModes: ActionModeSettings;
  idleFunctionSwipeDownModes: ActionModeSettings;
  composingFunctionSwipeUpModes: ActionModeSettings;
  composingFunctionSwipeDownModes: ActionModeSettings;
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
  numericEqualsSwipeUp: string;
  letterLongPressDuration: number;
  inputClicks: boolean;
  inputClickLevel: number;
  haptics: boolean;
  hapticLevel: number;
  autoDeployOnLaunch: boolean;
};

const SETTINGS_KEY = "rime_pinyin_keyboard_settings_v1";
const SHARED_OPTIONS = { shared: true };

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

export const DEFAULT_LETTER_ACTION_MODES: ActionModeSettings = Object
  .fromEntries(
    LETTER_KEYS.map((key) => [key, "auto" as ActionSendMode]),
  );

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

export const DEFAULT_IDLE_FUNCTION_SWIPE_UP: SwipeSettings = {
  left: "{home}",
  head: "{home}",
  select: "",
  cut: "{cut}",
  copy: "{copy}",
  paste: "{paste}",
  tail: "{end}",
  right: "{end}",
};

export const DEFAULT_IDLE_FUNCTION_SWIPE_DOWN: SwipeSettings = {
  left: "{left}",
  head: "{home}",
  select: "",
  cut: "{cut}",
  copy: "{copy}",
  paste: "{paste}",
  tail: "{end}",
  right: "{right}",
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
  filter: "{backslash}",
  right: "]",
};

export const DEFAULT_COMPOSING_FUNCTION_SWIPE_DOWN: SwipeSettings = {
  left: "{rimeUp}",
  page: "{rimePageDown}",
  tone1: "{control+1}",
  tone2: "{control+2}",
  tone3: "{control+3}",
  tone4: "{control+4}",
  filter: "{backslash}",
  right: "{rimeDown}",
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
  showCandidateComment: true,
  showPreeditCaret: true,
  showFunctionRow: true,
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
  idleFunctionSwipeUpModes: DEFAULT_FUNCTION_ACTION_MODES,
  idleFunctionSwipeDownModes: DEFAULT_FUNCTION_ACTION_MODES,
  composingFunctionSwipeUpModes: DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
  composingFunctionSwipeDownModes: DEFAULT_COMPOSING_FUNCTION_ACTION_MODES,
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
  numericEqualsSwipeUp: "V",
  letterLongPressDuration: 420,
  inputClicks: true,
  inputClickLevel: 3,
  haptics: true,
  hapticLevel: 3,
  autoDeployOnLaunch: true,
};

export const KEYBOARD_HEIGHT_MIN = 286;
export const KEYBOARD_HEIGHT_MAX = 390;
export const CANDIDATE_BAR_HEIGHT_MIN = 34;
export const CANDIDATE_BAR_HEIGHT_MAX = 56;
export const LETTER_LONG_PRESS_DURATION_MIN = 260;
export const LETTER_LONG_PRESS_DURATION_MAX = 760;

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
    ? raw as Record<string, unknown>
    : {};
  return {
    light: normalizeColor(source.light, defaults.light),
    dark: normalizeColor(source.dark, defaults.dark),
  };
}

function normalizeKeyColors(raw: unknown): KeyColorSettings {
  const source = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const overrideSource = source.overrides &&
      typeof source.overrides === "object"
    ? source.overrides as Record<string, unknown>
    : {};
  const overrides: Record<string, KeyColorPair> = {};
  for (const [key, value] of Object.entries(overrideSource)) {
    if (!key) continue;
    overrides[key] = normalizeColorPair(value, {
      light: DEFAULT_KEY_COLORS.normal.light,
      dark: DEFAULT_KEY_COLORS.normal.dark,
    });
  }
  return {
    normal: normalizeColorPair(source.normal, DEFAULT_KEY_COLORS.normal),
    enter: normalizeColorPair(source.enter, DEFAULT_KEY_COLORS.enter),
    overrides,
  };
}

function normalizeSwipeSettings(
  raw: unknown,
  defaults: SwipeSettings,
  keys: string[],
): SwipeSettings {
  const source = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const result: SwipeSettings = {};
  for (const key of keys) {
    const value = source[key];
    result[key] = typeof value === "string" ? value : defaults[key] ?? "";
  }
  return result;
}

function normalizeActionModeSettings(
  raw: unknown,
  defaults: ActionModeSettings,
  keys: string[],
): ActionModeSettings {
  const source = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
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
  if (normalized.filter === "\\") normalized.filter = "{backslash}";
  return normalized;
}

export function normalizeRimeKeyboardSettings(raw: any): RimeKeyboardSettings {
  return {
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
    keyColors: normalizeKeyColors(raw?.keyColors),
    showCandidateComment: typeof raw?.showCandidateComment === "boolean"
      ? raw.showCandidateComment
      : raw?.candidateCommentMode !== "hidden",
    showPreeditCaret: typeof raw?.showPreeditCaret === "boolean"
      ? raw.showPreeditCaret
      : true,
    showFunctionRow: typeof raw?.showFunctionRow === "boolean"
      ? raw.showFunctionRow
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
      ? (raw.modeComposingAction === "{commitComposition}"
        ? ","
        : raw.modeComposingAction)
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
    numericEqualsSwipeUp: typeof raw?.numericEqualsSwipeUp === "string"
      ? raw.numericEqualsSwipeUp
      : "V",
    letterLongPressDuration: clampNumber(
      raw?.letterLongPressDuration,
      DEFAULT_RIME_KEYBOARD_SETTINGS.letterLongPressDuration,
      LETTER_LONG_PRESS_DURATION_MIN,
      LETTER_LONG_PRESS_DURATION_MAX,
    ),
    inputClicks: typeof raw?.inputClicks === "boolean" ? raw.inputClicks : true,
    inputClickLevel: clampNumber(raw?.inputClickLevel, 3, 1, 5),
    haptics: typeof raw?.haptics === "boolean" ? raw.haptics : true,
    hapticLevel: clampNumber(raw?.hapticLevel, 3, 1, 5),
    autoDeployOnLaunch: typeof raw?.autoDeployOnLaunch === "boolean"
      ? raw.autoDeployOnLaunch
      : true,
  };
}

function getRawSettings(): unknown {
  const st = (globalThis as any).Storage;
  try {
    const shared = st?.get?.(SETTINGS_KEY, SHARED_OPTIONS) ??
      st?.getString?.(SETTINGS_KEY, SHARED_OPTIONS);
    if (shared != null) return shared;
  } catch {
  }
  try {
    return st?.get?.(SETTINGS_KEY) ?? st?.getString?.(SETTINGS_KEY) ?? null;
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
      st.set(SETTINGS_KEY, normalized, SHARED_OPTIONS);
    } else if (typeof st.setString === "function") {
      const raw = JSON.stringify(normalized);
      st.setString(SETTINGS_KEY, raw);
      st.setString(SETTINGS_KEY, raw, SHARED_OPTIONS);
    }
  } catch {
  }
  return normalized;
}
