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
