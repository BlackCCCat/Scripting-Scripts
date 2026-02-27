function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function createId(prefix = "id"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildOutputFileName(prefix: string): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `${prefix}-${stamp}.pdf`
}
