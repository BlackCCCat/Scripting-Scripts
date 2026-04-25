function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function runtimeTemplateVariables() {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return {
    date,
    time,
    datetime: `${date} ${time}`,
  }
}

export function renderRuntimeTemplate(template: string, text = ""): string {
  const values = runtimeTemplateVariables()
  return template
    .replace(/\{\{text\}\}/g, text)
    .replace(/\{\{date\}\}/g, values.date)
    .replace(/\{\{time\}\}/g, values.time)
    .replace(/\{\{datetime\}\}/g, values.datetime)
}

