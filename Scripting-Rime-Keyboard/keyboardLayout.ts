export const LETTER_ROWS: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export type T9Key = {
  digit: string;
  letters: string;
};

export const T9_KEYS: T9Key[] = [
  { digit: "1", letters: "@./" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
];

export const NUMERIC_SYMBOLS = [
  { label: "+", value: "+" },
  { label: "-", value: "-" },
  { label: "×", value: "*" },
  { label: "/", value: "/" },
  { label: "(", value: "(" },
  { label: ")", value: ")" },
  { label: ".", value: "." },
  { label: "=", value: "=" },
  { label: ",", value: "," },
  { label: "#", value: "#" },
  { label: ":", value: ":" },
  { label: "_", value: "_" },
  { label: "?", value: "?" },
  { label: "￥", value: "￥" },
];

export const BACKSLASH_SYMBOLS: Record<string, string> = {
  a: "[a]",
  b: "【b】",
  c: "❲c❳",
  d: "〔d〕",
  e: "⟮e⟯",
  f: "⟦f⟧",
  g: "「g」",
  h: "#",
  i: "『i』",
  j: "<j>",
  k: "《k》",
  l: "〈l〉",
  m: "‹m›",
  n: "«n»",
  o: "⦅o⦆",
  p: "⦇p⦈",
  q: "(q)",
  r: "儿",
  s: "[s]",
  t: "⟨t⟩",
  u: "[u]",
  v: "❰v❱",
  w: "（w）",
  x: "｛x｝",
  y: "⟪y⟫",
  z: "{z}",
};
