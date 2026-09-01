export type AppStoreReference = {
  appId: string
  region: string
}

type IntentInputValues = {
  texts?: string[]
  urls?: string[]
  shortcutText?: string
}

function normalizedValues(values?: string[]) {
  return (values ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
}

function urlsInText(text: string) {
  return text.match(/https?:\/\/[^\s<>"']+/gi) ?? []
}

export function parseAppStoreReference(value: string): AppStoreReference | null {
  const normalized = String(value ?? "").trim().replace(/[),.;!?]+$/, "")
  const hostMatch = normalized.match(/^https?:\/\/(?:apps|itunes)\.apple\.com\/([^?#]*)/i)
  if (!hostMatch) return null

  const appId = hostMatch[1].match(/(?:^|\/)id(\d+)(?:\/|$)/i)?.[1]
  if (!appId) return null

  const firstPathComponent = hostMatch[1].split("/").filter(Boolean)[0] ?? ""
  const region = /^[a-z]{2}$/i.test(firstPathComponent)
    ? firstPathComponent.toLowerCase()
    : "cn"

  return { appId, region }
}

export function resolveIntentInput(values: IntentInputValues) {
  const texts = normalizedValues(values.texts)
  const urls = normalizedValues(values.urls)
  const shortcutText = String(values.shortcutText ?? "").trim()
  const appStoreReference = [
    ...urls,
    ...texts.flatMap(urlsInText),
    ...urlsInText(shortcutText),
  ].map(parseAppStoreReference).find(Boolean) ?? null

  const sourceText = texts.length > 0
    ? texts.join("\n\n")
    : shortcutText || urls.join("\n")

  return { appStoreReference, sourceText }
}

export function appStoreTranslationText(app: Record<string, unknown>) {
  const releaseNotes = String(app.releaseNotes ?? "").trim()
  const description = String(app.description ?? "").trim()
  const sections = [
    releaseNotes ? `Release Notes\n${releaseNotes}` : "",
    description ? `Description\n${description}` : "",
  ].filter(Boolean)

  return sections.join("\n\n")
}
