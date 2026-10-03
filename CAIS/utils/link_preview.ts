import type { LinkPreview } from "../types"

export function previewableWebUrl(value: string): URL | null {
  try {
    if (value.length >= 2000) return null
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/, "")
    if (url.protocol !== "https:" || url.username || url.password) return null
    if (!host.includes(".")) return null
    if (host === "localhost" || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host) || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return null
    if (Array.from(url.searchParams.keys()).some((key) => /token|access[_-]?key|api[_-]?key|secret|password|auth|^(key|code|signature|sig)$/i.test(key))) return null
    return url
  } catch {
    return null
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? " "
    const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " "
  })
}

function plainText(value: string, limit: number): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, limit)
}

export function parseLinkPreviewHtml(html: string, pageUrl?: string): Pick<LinkPreview, "title" | "summary" | "iconUrl"> {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html.slice(0, 50_000)
  const metadata = new Map<string, string>()
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>()
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "")
    }
    const name = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase()
    if (name && !metadata.has(name)) metadata.set(name, attributes.get("content") ?? "")
  }
  const title = plainText(metadata.get("og:title") || head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "", 120)
  const description = metadata.get("og:description") || metadata.get("description") ||
    html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""
  let iconUrl: string | undefined
  if (pageUrl) {
    for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(Boolean) ?? ""
      if (!/(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(rel)) continue
      const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(Boolean)
      if (!href) continue
      try {
        const candidate = new URL(decodeEntities(href), pageUrl).href
        if (previewableWebUrl(candidate)) { iconUrl = candidate; break }
      } catch {}
    }
    if (!iconUrl) {
      try { iconUrl = new URL("/favicon.ico", pageUrl).href } catch {}
    }
  }
  return { title, summary: plainText(description, 280), iconUrl }
}
