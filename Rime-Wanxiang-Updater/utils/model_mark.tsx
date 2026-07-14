export type ModelMarkSource = {
  remoteIdOrSha?: string
  updatedAt?: string
}

function clean(value?: string): string {
  return String(value ?? "").trim()
}

function normalize(value?: string): string {
  return clean(value).toLowerCase()
}

function isSha256(value?: string): boolean {
  return /^[0-9a-f]{64}$/i.test(clean(value))
}

function parseTime(value?: string): number | undefined {
  const raw = clean(value)
  if (!raw) return undefined
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : undefined
}

function formatChinaTime(value?: string): string {
  const raw = clean(value)
  if (!raw) return ""
  const time = parseTime(raw)
  if (time === undefined) return raw

  const date = new Date(time + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-") + " " + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join(":")
}

export function modelDisplayMark(item?: ModelMarkSource, peer?: ModelMarkSource): string {
  const primary = clean(item?.remoteIdOrSha)
  if (isSha256(primary)) return primary

  const peerPrimary = clean(peer?.remoteIdOrSha)
  if (primary && peerPrimary && normalize(primary) !== normalize(peerPrimary)) {
    return primary
  }
  return formatChinaTime(item?.updatedAt) || primary
}

export function isModelUpdateAvailable(local?: ModelMarkSource, remote?: ModelMarkSource): boolean {
  const remotePrimary = normalize(remote?.remoteIdOrSha)
  if (!remotePrimary) return false

  const localPrimary = normalize(local?.remoteIdOrSha)
  if (localPrimary !== remotePrimary) return true
  if (isSha256(remotePrimary)) return false

  const remoteTime = normalize(remote?.updatedAt)
  if (!remoteTime) return false

  const localTimeValue = parseTime(local?.updatedAt)
  const remoteTimeValue = parseTime(remote?.updatedAt)
  if (localTimeValue !== undefined && remoteTimeValue !== undefined) {
    return localTimeValue !== remoteTimeValue
  }

  return normalize(local?.updatedAt) !== remoteTime
}
