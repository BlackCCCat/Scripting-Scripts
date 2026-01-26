// File: utils/releases.ts
import type { AppConfig } from "./config"
import { Runtime } from "./runtime"

const OWNER = "amzxyz"
const GITHUB_REPO = "rime_wanxiang"
const CNB_REPO = "rime-wanxiang"
const CNB_SCHEME_TITLE = "万象拼音输入方案"

export type RemoteAsset = {
  name: string
  url: string
  tag?: string
  body?: string
  updatedAt?: string
  idOrSha?: string
}

function matchWildcard(name: string, pattern: string) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp("^" + pattern.split("*").map(esc).join(".*") + "$", "i")
  return re.test(name)
}

function pickGithubSha256FromDigest(digest?: string): string | undefined {
  if (!digest) return undefined
  const m = String(digest).match(/sha256\s*:\s*([0-9a-fA-F]{32,})/i)
  return m?.[1]
}

export async function fetchLatestSchemeAsset(cfg: AppConfig): Promise<RemoteAsset | null> {
  const fetchFn = Runtime.fetch
  if (!fetchFn) throw new Error("运行时没有 fetch（请确认 Scripting 网络 API）")

  const pattern =
    cfg.schemeEdition === "base" ? "*base.zip" : `*${cfg.proSchemeKey}*fuzhu.zip`

  if (cfg.releaseSource === "github") {
    const url = `https://api.github.com/repos/${OWNER}/${GITHUB_REPO}/releases`
    const headers: Record<string, string> = {
      "User-Agent": "Scripting-Wanxiang-Updater",
      Accept: "application/json",
    }
    if (cfg.githubToken?.trim()) headers.Authorization = `Bearer ${cfg.githubToken.trim()}`
    const res = await fetchFn(url, { headers })
    if (!res.ok) throw new Error(`GitHub releases 请求失败：${res.status}`)
    const releases = (await res.json()) as any[]
    for (const rel of releases) {
      const assets = rel?.assets ?? []
      for (const a of assets) {
        if (matchWildcard(String(a?.name ?? ""), pattern)) {
          return {
            name: a.name,
            url: a.browser_download_url,
            tag: rel.tag_name,
            body: rel.body ?? "",
            updatedAt: a.updated_at,
            idOrSha: pickGithubSha256FromDigest(a?.digest),
          }
        }
      }
    }
    return null
  }

  // CNB
  const url = `https://cnb.cool/${OWNER}/${CNB_REPO}/-/releases`
  const headers: Record<string, string> = {
    "User-Agent": "Scripting-Wanxiang-Updater",
    Accept: "application/vnd.cnb.web+json",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  }
  const res = await fetchFn(url, { headers })
  if (!res.ok) throw new Error(`CNB releases 请求失败：${res.status}`)
  const json = await res.json()
  const releases = (Array.isArray(json) ? json : json?.releases ?? json?.data?.releases ?? []) as any[]

  const matchesTitle = (rel: any) => {
    const title = String(rel?.title ?? rel?.name ?? "")
    return title.includes(CNB_SCHEME_TITLE)
  }
  const preferred = releases.filter(matchesTitle)
  const list = preferred.length ? preferred : releases

  for (const rel of list) {
    const assets = rel?.assets ?? []
    for (const a of assets) {
      if (!matchWildcard(String(a?.name ?? ""), pattern)) continue
      const raw = a?.browser_download_url ?? a?.url ?? a?.download_url ?? a?.path
      if (!raw) continue
      const url2 = String(raw).startsWith("http") ? String(raw) : `https://cnb.cool${raw}`
      return {
        name: a.name,
        url: url2,
        tag: String(rel?.tag_ref ?? rel?.tag_name ?? rel?.tagName ?? "").split("/").pop(),
        body: rel?.body ?? rel?.description ?? "",
        updatedAt: a.updated_at ?? a?.updatedAt,
        idOrSha: a?.id != null ? String(a.id) : undefined,
      }
    }
  }
  return null
}
