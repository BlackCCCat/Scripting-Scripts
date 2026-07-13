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

function formatChinaTime(value?: string): string {
  const raw = clean(value)
  if (!raw) return ""
  const time = Date.parse(raw)
  if (!Number.isFinite(time)) return raw

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
  const peerPrimary = clean(peer?.remoteIdOrSha)
  if (primary && peerPrimary && normalize(primary) === normalize(peerPrimary)) {
    return formatChinaTime(item?.updatedAt) || primary
  }
  return primary || formatChinaTime(item?.updatedAt)
}

export function isModelUpdateAvailable(local?: ModelMarkSource, remote?: ModelMarkSource): boolean {
  const remotePrimary = normalize(remote?.remoteIdOrSha)
  if (!remotePrimary) return false

  const localPrimary = normalize(local?.remoteIdOrSha)
  if (localPrimary !== remotePrimary) return true

  const remoteTime = normalize(remote?.updatedAt)
  if (!remoteTime) return false

  return normalize(local?.updatedAt) !== remoteTime
}
