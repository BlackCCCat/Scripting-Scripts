type Rule = [RegExp, string | ((substring: string, ...groups: string[]) => string)];

const RULES: Rule[] = [
  [/[A-Za-z0-9+/]{32,}={0,2}/g, "…"],
  [/\b([0-9A-Fa-f]{8})-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g, "$1-…"],
  [/-?\d{1,3}\.\d{4,}/g, (m: string) => `${Number(m).toFixed(1)}…`],
  [/\b(?=[0-9a-f:]*[a-f])([0-9a-f]{1,4})(?::[0-9a-f]{0,4}){2,}\b/gi, "$1:…"],
  [/\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.x.x"],
  [/\bhttps?:\/\/[^\s"'<>,)\]}]+/gi, "https://…"],
];

export function redactLog(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = typeof replacement === "string"
      ? out.replace(pattern, replacement)
      : out.replace(pattern, replacement as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}
