export const KEY_BACKSPACE = 0xff08;
export const KEY_TAB = 0xff09;
export const KEY_RETURN = 0xff0d;
export const KEY_ESCAPE = 0xff1b;
export const KEY_SPACE = 0x0020;
export const KEY_UP = 0xff52;
export const KEY_DOWN = 0xff54;
export const KEY_PAGE_UP = 0xff55;
export const KEY_PAGE_DOWN = 0xff56;
export const MOD_CONTROL = 1 << 2;
export const MOD_SHIFT = 1 << 0;

const MOD_ALT = 1 << 3;
const MOD_META = 1 << 4;
const MOD_SUPER = 1 << 6;

const RIME_KEY_NAMES: Record<string, number> = {
  backspace: KEY_BACKSPACE,
  back_space: KEY_BACKSPACE,
  delete: 0xffff,
  del: 0xffff,
  tab: KEY_TAB,
  iso_left_tab: 0xfe20,
  return: KEY_RETURN,
  enter: KEY_RETURN,
  kp_enter: 0xff8d,
  escape: KEY_ESCAPE,
  esc: KEY_ESCAPE,
  space: KEY_SPACE,
  break: 0xff6b,
  pause: 0xff13,
  sys_req: 0xff15,
  clear: 0xff0b,
  home: 0xff50,
  left: 0xff51,
  up: KEY_UP,
  right: 0xff53,
  down: KEY_DOWN,
  page_up: KEY_PAGE_UP,
  pageup: KEY_PAGE_UP,
  prior: KEY_PAGE_UP,
  page_down: KEY_PAGE_DOWN,
  pagedown: KEY_PAGE_DOWN,
  next: KEY_PAGE_DOWN,
  end: 0xff57,
  begin: 0xff58,
  insert: 0xff63,
  ins: 0xff63,
  menu: 0xff67,
  print: 0xff61,
  printscreen: 0xff61,
  scroll_lock: 0xff14,
  num_lock: 0xff7f,
  caps_lock: 0xffe5,
  shift_l: 0xffe1,
  shift_r: 0xffe2,
  control_l: 0xffe3,
  control_r: 0xffe4,
  alt_l: 0xffe9,
  alt_r: 0xffea,
  meta_l: 0xffe7,
  meta_r: 0xffe8,
  super_l: 0xffeb,
  super_r: 0xffec,
  hyper_l: 0xffed,
  hyper_r: 0xffee,
  backslash: "\\".charCodeAt(0),
  slash: "/".charCodeAt(0),
  grave: "`".charCodeAt(0),
  quoteleft: "`".charCodeAt(0),
  asciitilde: "~".charCodeAt(0),
  tilde: "~".charCodeAt(0),
  exclam: "!".charCodeAt(0),
  quotedbl: '"'.charCodeAt(0),
  numbersign: "#".charCodeAt(0),
  dollar: "$".charCodeAt(0),
  percent: "%".charCodeAt(0),
  ampersand: "&".charCodeAt(0),
  parenleft: "(".charCodeAt(0),
  parenright: ")".charCodeAt(0),
  asterisk: "*".charCodeAt(0),
  plus: "+".charCodeAt(0),
  minus: "-".charCodeAt(0),
  hyphen: "-".charCodeAt(0),
  equal: "=".charCodeAt(0),
  bracketleft: "[".charCodeAt(0),
  bracketright: "]".charCodeAt(0),
  braceleft: "{".charCodeAt(0),
  braceright: "}".charCodeAt(0),
  semicolon: ";".charCodeAt(0),
  colon: ":".charCodeAt(0),
  apostrophe: "'".charCodeAt(0),
  quoteright: "'".charCodeAt(0),
  less: "<".charCodeAt(0),
  greater: ">".charCodeAt(0),
  question: "?".charCodeAt(0),
  at: "@".charCodeAt(0),
  bar: "|".charCodeAt(0),
  verticalbar: "|".charCodeAt(0),
  underscore: "_".charCodeAt(0),
  comma: ",".charCodeAt(0),
  period: ".".charCodeAt(0),
  dot: ".".charCodeAt(0),
};

for (let i = 1; i <= 35; i += 1) {
  RIME_KEY_NAMES[`f${i}`] = 0xffbe + i - 1;
}

for (let i = 0; i <= 9; i += 1) {
  RIME_KEY_NAMES[`kp_${i}`] = 0xffb0 + i;
}

Object.assign(RIME_KEY_NAMES, {
  kp_space: 0xff80,
  kp_tab: 0xff89,
  kp_equal: 0xffbd,
  kp_multiply: 0xffaa,
  kp_add: 0xffab,
  kp_separator: 0xffac,
  kp_subtract: 0xffad,
  kp_decimal: 0xffae,
  kp_divide: 0xffaf,
});

const RIME_MODIFIER_NAMES: Record<string, number> = {
  shift: MOD_SHIFT,
  control: MOD_CONTROL,
  ctrl: MOD_CONTROL,
  alt: MOD_ALT,
  option: MOD_ALT,
  meta: MOD_META,
  command: MOD_META,
  cmd: MOD_META,
  super: MOD_SUPER,
};

function normalizeKeyName(value: string): string {
  return value.trim().replace(/[\s-]+/g, "_").toLowerCase();
}

function keyCodeFromName(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length === 1) return trimmed.charCodeAt(0);
  const normalized = normalizeKeyName(trimmed);
  return RIME_KEY_NAMES[normalized] ?? null;
}

export function parseRimeKeySpec(
  value: string,
): { keyCode: number; modifiers: number } | null {
  const raw = value.trim();
  if (!raw) return null;
  const inner = raw.startsWith("{") && raw.endsWith("}")
    ? raw.slice(1, -1)
    : raw;
  const normalizedInner = normalizeKeyName(inner);
  const explicitKeySpec = raw.startsWith("{") && raw.endsWith("}") ||
    inner.includes("+") || RIME_KEY_NAMES[normalizedInner] != null;
  if (!explicitKeySpec) return null;
  const parts = inner.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let modifiers = 0;
  for (const part of parts.slice(0, -1)) {
    const modifier = RIME_MODIFIER_NAMES[normalizeKeyName(part)];
    if (!modifier) return null;
    modifiers |= modifier;
  }

  const keyCode = keyCodeFromName(parts[parts.length - 1]);
  if (keyCode == null) return null;
  if (
    parts.length === 1 && inner.length > 1 && !RIME_KEY_NAMES[normalizedInner]
  ) {
    return null;
  }
  return { keyCode, modifiers };
}
