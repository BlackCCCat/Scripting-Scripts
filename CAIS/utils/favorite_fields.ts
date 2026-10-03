import { clipTitle } from "./common"

export type FavoriteField = {
  id: string
  name: string
  value: string
  line: number
}

export type FavoriteFieldParseResult = {
  fields: FavoriteField[]
  errors: string[]
}

export type PrivateFieldRule =
  | { kind: "keyword"; value: string }
  | { kind: "regex"; value: RegExp }

export function normalizeFavoriteDelimiter(value: unknown, fallback = ":"): string {
  const delimiter = String(value ?? "").replace(/[\r\n]/g, "").slice(0, 8)
  return delimiter || fallback
}

export function favoriteDelimiterForItem(
  item: { fieldDelimiter?: string; fieldDelimiterOverride?: boolean },
  globalDelimiter: string,
): string {
  return item.fieldDelimiterOverride && item.fieldDelimiter
    ? normalizeFavoriteDelimiter(item.fieldDelimiter)
    : normalizeFavoriteDelimiter(globalDelimiter)
}

export function parseFavoriteFields(content: string, delimiter: string): FavoriteFieldParseResult {
  const separator = normalizeFavoriteDelimiter(delimiter)
  const fields: FavoriteField[] = []
  const errors: string[] = []
  let activeField: { name: string; line: number; valueCount: number } | null = null

  function finishActiveField() {
    if (activeField && activeField.valueCount === 0) {
      errors.push(`第 ${activeField.line} 行的子字段值为空`)
    }
  }

  function appendValue(value: string, line: number) {
    if (!activeField) return
    fields.push({
      id: `${activeField.line}-${line}-${activeField.valueCount}`,
      name: activeField.name,
      value,
      line,
    })
    activeField.valueCount += 1
  }

  String(content ?? "").replace(/\r\n?/g, "\n").split("\n").forEach((source, index) => {
    if (!source.trim()) return
    const line = index + 1
    const separatorIndex = source.indexOf(separator)
    if (separatorIndex >= 0) {
      finishActiveField()
      const name = source.slice(0, separatorIndex).trim()
      if (!name) {
        errors.push(`第 ${line} 行的子字段名称为空`)
        activeField = null
        return
      }
      activeField = { name, line, valueCount: 0 }
      const inlineValue = source.slice(separatorIndex + separator.length).trim()
      if (inlineValue) appendValue(inlineValue, line)
      return
    }

    if (!activeField) {
      errors.push(`第 ${line} 行缺少分隔符“${separator}”`)
      return
    }
    appendValue(source.trim(), line)
  })
  finishActiveField()

  if (!fields.length && !errors.length) errors.push("请至少输入一个子字段")
  return { fields, errors }
}

export function isFieldFavorite(item: { favorite?: boolean; favoriteFormat?: string }): boolean {
  return Boolean(item.favorite && item.favoriteFormat === "fields")
}

function ruleLines(value: string): string[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    return trimmed.startsWith("re:") || trimmed.startsWith("/")
      ? [trimmed]
      : line.split(/[,，]/).map((part) => part.trim())
  }).filter(Boolean)
}

export function validatePrivateFieldRules(value: string): string | null {
  if (value.length > 2000) return "隐私规则不能超过 2000 个字符"
  const lines = ruleLines(value)
  if (lines.length > 64) return "隐私规则不能超过 64 条"
  for (const line of lines) {
    if (line.length > 256) return "每条隐私规则不能超过 256 个字符"
    if (line.startsWith("re:")) {
      try { new RegExp(line.slice(3)) } catch { return `正则表达式无效：${line}` }
    } else if (line.startsWith("/")) {
      const match = line.match(/^\/(.*)\/([i]?)$/)
      if (!match) return `正则表达式格式无效：${line}`
      try { new RegExp(match[1], match[2]) } catch { return `正则表达式无效：${line}` }
    }
  }
  return null
}

export function privateFieldKeywords(value: string, enabled: boolean): PrivateFieldRule[] {
  if (!enabled) return []
  return ruleLines(value).flatMap((line): PrivateFieldRule[] => {
    if (line.startsWith("re:")) {
      try { return [{ kind: "regex", value: new RegExp(line.slice(3)) }] } catch { return [] }
    }
    if (line.startsWith("/")) {
      const match = line.match(/^\/(.*)\/([i]?)$/)
      if (!match) return []
      try { return [{ kind: "regex", value: new RegExp(match[1], match[2]) }] } catch { return [] }
    }
    return [{ kind: "keyword", value: line.toLocaleLowerCase() }]
  })
}

export function privateRulesForItem(
  item: { fieldPrivacyOverride?: boolean; fieldPrivateKeywords?: string },
  globalRules: PrivateFieldRule[],
): PrivateFieldRule[] {
  return item.fieldPrivacyOverride
    ? privateFieldKeywords(item.fieldPrivateKeywords ?? "", true)
    : globalRules
}

function isPrivateFieldName(name: string, rules: PrivateFieldRule[]): boolean {
  const normalized = name.toLocaleLowerCase()
  return rules.some((rule) => rule.kind === "keyword"
    ? normalized.includes(rule.value)
    : rule.value.test(name))
}

export function displayFavoriteFieldValue(field: FavoriteField, rules: PrivateFieldRule[]): string {
  return isPrivateFieldName(field.name, rules) ? "••••••" : field.value
}

export function displayFavoriteFieldsContent(content: string, delimiter: string, rules: PrivateFieldRule[]): string {
  if (!rules.length) return content
  if (parseFavoriteFields(content, delimiter).errors.length) return "字段内容已隐藏"
  let privateValue = false
  return content.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (!line.trim()) return line
    const separatorIndex = line.indexOf(delimiter)
    if (separatorIndex >= 0) {
      privateValue = isPrivateFieldName(line.slice(0, separatorIndex).trim(), rules)
      return privateValue ? `${line.slice(0, separatorIndex + delimiter.length)}••••••` : line
    }
    return privateValue ? "••••••" : line
  }).join("\n")
}

export function displayFavoriteItemTitle(item: { title: string; content: string; favorite?: boolean; favoriteFormat?: string }, delimiter: string, rules: PrivateFieldRule[]): string {
  if (!rules.length || !isFieldFavorite(item) || item.title !== clipTitle("text", item.content)) return item.title
  return clipTitle("text", displayFavoriteFieldsContent(item.content, delimiter, rules))
}
