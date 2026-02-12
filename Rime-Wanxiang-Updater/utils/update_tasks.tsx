// File: utils/update_tasks.ts
import { Path } from "scripting"
import type { AppConfig } from "./config"
import { getExcludePatterns } from "./config"
import { downloadWithProgress } from "./downloader"
import { ensureDir, removeDirSafe, unzipToDirWithOverwrite, mergeSubdirsByName } from "./fs"
import { deployHamster } from "./deploy"
import { detectRimeDir } from "./hamster"
import { checkUpdate as checkSchemeUpdate, doUpdate as doSchemeUpdate } from "./updater"
import { loadMetaAsync, setDictMeta, setModelMeta, setSchemeMeta } from "./meta"

declare const fetch: any

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

const OWNER = "amzxyz"
const GH_REPO = "rime_wanxiang"
const CNB_REPO = "rime-wanxiang"

const DICT_TAG = "dict-nightly"
const MODEL_REPO = "RIME-LMDG"
const MODEL_TAG = "LTS"
const MODEL_FILE = "wanxiang-lts-zh-hans.gram"
const CNB_DICT_TITLE = "词库"

export type RemoteAsset = {
  name: string
  url: string
  tag?: string
  body?: string
  updatedAt?: string
  remoteIdOrSha?: string // GitHub=sha256(digest) / CNB=id
}

export type AllUpdateResult = {
  scheme?: RemoteAsset
  dict?: RemoteAsset
  model?: RemoteAsset
}

function FM(): any {
  return (globalThis as any).FileManager
}

function pickGithubSha256FromDigest(digest?: string): string | undefined {
  if (!digest) return undefined
  const m = String(digest).match(/sha256\s*:\s*([0-9a-fA-F]{32,})/i)
  return m?.[1]
}

async function httpJson(url: string, init?: any) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`)
  const json = await res.json()
  return { json, headers: res.headers }
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp("^" + esc + "$", "i")
}

async function fetchLatestAssetFromGithub(args: {
  owner: string
  repo: string
  tag?: string
  assetNameExact?: string
  assetNameGlob?: string
  token?: string
}): Promise<RemoteAsset | undefined> {
  const headers: Record<string, string> = {
    "User-Agent": "scripting",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (args.token) headers["Authorization"] = `Bearer ${args.token}`

  const url = args.tag
    ? `https://api.github.com/repos/${args.owner}/${args.repo}/releases/tags/${args.tag}`
    : `https://api.github.com/repos/${args.owner}/${args.repo}/releases`

  const { json } = await httpJson(url, { headers })
  const releases = Array.isArray(json) ? json : [json]
  const re = args.assetNameGlob ? globToRegExp(args.assetNameGlob) : undefined

  for (const rel of releases) {
    const assets = rel?.assets ?? []
    for (const a of assets) {
      const name = a?.name
      if (!name) continue
      if (args.assetNameExact && name !== args.assetNameExact) continue
      if (re && !re.test(name)) continue
      return {
        name,
        url: a.browser_download_url,
        updatedAt: a.updated_at,
        tag: rel.tag_name,
        body: rel.body,
        remoteIdOrSha: pickGithubSha256FromDigest(a?.digest),
      }
    }
  }
  return undefined
}

async function fetchLatestAssetFromCnb(args: {
  owner: string
  repo: string
  assetNameExact?: string
  assetNameGlob?: string
  needLastPage?: boolean
  releaseTitleIncludes?: string[]
}): Promise<RemoteAsset | undefined> {
  const headers: Record<string, string> = {
    "User-Agent": "scripting",
    "Accept": "application/vnd.cnb.web+json",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  }
  const baseUrl = `https://cnb.cool/${args.owner}/${args.repo}/-/releases`

  const first = await httpJson(baseUrl, { headers })

  let list: any[] = []
  if (Array.isArray(first.json)) list = first.json
  else if (Array.isArray(first.json?.releases)) list = first.json.releases
  else if (Array.isArray(first.json?.data?.releases)) list = first.json.data.releases

  // ✅ 模型需要最后一页（按你 python 逻辑）
  if (args.needLastPage) {
    const total = first.headers.get("X-Cnb-Total")
    const pageSize = first.headers.get("X-Cnb-Page-Size")
    if (total && pageSize) {
      const t = Math.max(0, parseInt(total, 10))
      const ps = Math.max(1, parseInt(pageSize, 10))
      const lastPage = Math.max(1, Math.ceil(t / ps))
      if (lastPage > 1) {
        const last = await httpJson(`${baseUrl}?page=${lastPage}`, { headers })
        let lastList: any[] = []
        if (Array.isArray(last.json)) lastList = last.json
        else if (Array.isArray(last.json?.releases)) lastList = last.json.releases
        else if (Array.isArray(last.json?.data?.releases)) lastList = last.json.data.releases
        const lastRelease = lastList.length ? lastList[lastList.length - 1] : undefined
        if (lastRelease) list = list.concat([lastRelease])
      }
    }
  }

  const re = args.assetNameGlob ? globToRegExp(args.assetNameGlob) : undefined
  const titleKeywords = (args.releaseTitleIncludes ?? []).map((s) => s.toLowerCase()).filter(Boolean)
  const matchTitle = (rel: any) => {
    if (!titleKeywords.length) return true
    const title = String(rel?.title ?? rel?.name ?? "").toLowerCase()
    return titleKeywords.some((k) => title.includes(k))
  }
  const preferred = titleKeywords.length ? list.filter(matchTitle) : []
  const searchList = preferred.length ? preferred : list

  for (const rel of searchList) {
    const assets = rel?.assets ?? []
    for (const a of assets) {
      const name = a?.name
      if (!name) continue
      if (args.assetNameExact && name !== args.assetNameExact) continue
      if (re && !re.test(name)) continue

      const url2 = a.browser_download_url
        ? a.browser_download_url
        : a.path
          ? `https://cnb.cool${a.path}`
          : undefined
      if (!url2) continue

      return {
        name,
        url: url2,
        updatedAt: a.updated_at ?? a.updatedAt,
        tag: rel.tag_name ?? rel.tagName,
        body: rel.body,
        remoteIdOrSha: a?.id != null ? String(a.id) : undefined,
      }
    }
  }

  return undefined
}

function dictPattern(cfg: AppConfig): string {
  if (cfg.schemeEdition === "base") return "*base*dicts*.zip"
  return `*${cfg.proSchemeKey}*dicts.zip`
}

async function requireInstallRoot(cfg: AppConfig): Promise<string> {
  try {
    const { rimeDir } = await detectRimeDir(cfg)
    if (rimeDir) return rimeDir
  } catch {}
  if (cfg.hamsterBookmarkName) {
    throw new Error("书签路径不可用，请在设置页重新选择书签文件夹")
  }
  if (cfg.hamsterRootPath) return cfg.hamsterRootPath
  throw new Error("未选择安装目录（请到设置选择文件夹）")
}

async function resolveRimeDir(cfg: AppConfig): Promise<string> {
  const root = await requireInstallRoot(cfg)
  try {
    const { rimeDir } = await detectRimeDir(cfg)
    return rimeDir || root
  } catch {
    return root
  }
}

function updateCacheDir(installRoot: string): string {
  return Path.join(installRoot, "UpdateCache")
}

// ===== 统一检查：方案/词库/模型 =====
export async function checkAllUpdates(cfg: AppConfig): Promise<AllUpdateResult> {
  const schemeCheck = await checkSchemeUpdate(cfg).catch(() => ({} as any))
  const scheme = schemeCheck?.latest
    ? {
        name: schemeCheck.latest.name,
        url: schemeCheck.latest.url,
        tag: schemeCheck.latest.tag,
        body: schemeCheck.latest.body,
        updatedAt: schemeCheck.latest.updatedAt,
        remoteIdOrSha: schemeCheck.latest.idOrSha ?? schemeCheck.latest.tag ?? schemeCheck.latest.name,
      }
    : undefined

  const dict =
    cfg.releaseSource === "github"
      ? await fetchLatestAssetFromGithub({
          owner: OWNER,
          repo: GH_REPO,
          tag: DICT_TAG,
          assetNameGlob: dictPattern(cfg),
          token: cfg.githubToken,
        })
      : await fetchLatestAssetFromCnb({
          owner: OWNER,
          repo: CNB_REPO,
          assetNameGlob: dictPattern(cfg),
          needLastPage: false,
          releaseTitleIncludes: [CNB_DICT_TITLE],
        })

  const model =
    cfg.releaseSource === "github"
      ? await fetchLatestAssetFromGithub({
          owner: OWNER,
          repo: MODEL_REPO,
          tag: MODEL_TAG,
          assetNameExact: MODEL_FILE,
          token: cfg.githubToken,
        })
      : await fetchLatestAssetFromCnb({
          owner: OWNER,
          repo: CNB_REPO,
          assetNameExact: MODEL_FILE,
          needLastPage: true,
        })

  if (dict && !dict.remoteIdOrSha && dict.updatedAt) {
    dict.remoteIdOrSha = dict.updatedAt
  }
  if (model && !model.remoteIdOrSha && model.updatedAt) {
    model.remoteIdOrSha = model.updatedAt
  }

  return { scheme, dict, model }
}

// ===== 部署（删 build 再 URL scheme）=====
async function deployIfEnabled(cfg: AppConfig, onStage?: (s: string) => void) {
  if (cfg.autoDeployAfterDownload === false) return
  const installRoot = await resolveRimeDir(cfg)
  onStage?.("部署前清理 build…")
  await removeDirSafe(Path.join(installRoot, "build"))
  for (let i = 3; i >= 1; i--) {
    onStage?.(`部署倒计时：${i}s`)
    await sleep(1000)
  }
  onStage?.("触发部署中…")
  await deployHamster(cfg.inputMethod)
}

export async function deployInputMethod(cfg: AppConfig, onStage?: (s: string) => void) {
  for (let i = 3; i >= 1; i--) {
    onStage?.(`部署倒计时：${i}s`)
    await sleep(1000)
  }
  onStage?.("触发部署中…")
  await deployHamster(cfg.inputMethod)
  onStage?.("部署完成")
}

// ===== 三个按钮入口 =====

export async function updateScheme(
  cfg: AppConfig,
  params: {
    onStage?: (s: string) => void
    onProgress?: (p: { percent?: number; received: number; total?: number; speedBps?: number }) => void
    autoDeploy?: boolean
  }
) {
  const r: any = await doSchemeUpdate(cfg, {
    onStage: params.onStage,
    onProgress: params.onProgress,
    autoDeploy: false, // 这里不在 updater 内部部署，统一在外部处理
  })

  // ✅ 记录方案版本（成功后记录）
  const remoteIdOrSha = r?.remoteIdOrSha ?? r?.tag ?? r?.assetName
  await setSchemeMeta({
    installRoot: r?.installRoot ?? "",
    fileName: r?.assetName ?? "",
    tag: r?.tag,
    updatedAt: r?.updatedAt ?? new Date().toISOString(),
    remoteIdOrSha,
    source: cfg.releaseSource,
  })

  if (params.autoDeploy) await deployIfEnabled(cfg, params.onStage)
  return r
}

export async function updateDict(
  cfg: AppConfig,
  params: {
    onStage?: (s: string) => void
    onProgress?: (p: { percent?: number; received: number; total?: number; speedBps?: number }) => void
    autoDeploy?: boolean
  }
) {
  const installRoot = await resolveRimeDir(cfg)
  await ensureDir(installRoot)

  const dict =
    cfg.releaseSource === "github"
      ? await fetchLatestAssetFromGithub({
          owner: OWNER,
          repo: GH_REPO,
          tag: DICT_TAG,
          assetNameGlob: dictPattern(cfg),
          token: cfg.githubToken,
        })
      : await fetchLatestAssetFromCnb({
          owner: OWNER,
          repo: CNB_REPO,
          assetNameGlob: dictPattern(cfg),
          needLastPage: false,
          releaseTitleIncludes: [CNB_DICT_TITLE],
        })

  if (!dict?.url) throw new Error("未找到可用的词库资产")

  const cacheDir = updateCacheDir(installRoot)
  await ensureDir(cacheDir)
  const zipPath = Path.join(cacheDir, dict.name.replace(/[\\/]/g, "_"))
  const fm = FM()
  try {
    if (typeof fm?.removeSync === "function") fm.removeSync(zipPath)
    else if (typeof fm?.remove === "function") await fm.remove(zipPath)
  } catch {}

  params.onStage?.("下载中…")
  await downloadWithProgress(dict.url, zipPath, params.onProgress, (e) => {
    if (e.type === "retrying") {
      params.onStage?.(`下载中（重试 ${e.attempt}/${e.maxAttempts}）…`)
    }
  })

  params.onStage?.("解压到 dicts 目录中…")
  const exclude = getExcludePatterns(cfg)
  const dictDir = Path.join(installRoot, "dicts")
  await ensureDir(dictDir)
  await unzipToDirWithOverwrite(zipPath, dictDir, { excludePatterns: exclude, flattenSingleDir: true })
  await mergeSubdirsByName(dictDir, {
    excludePatterns: exclude,
    namePattern: /dict/i,
  })

  await setDictMeta({
    installRoot,
    fileName: dict.name,
    tag: dict.tag,
    updatedAt: dict.updatedAt ?? new Date().toISOString(),
    remoteIdOrSha: dict.remoteIdOrSha,
    source: cfg.releaseSource,
  })

  if (params.autoDeploy) await deployIfEnabled(cfg, params.onStage)
  return dict
}

export async function updateModel(
  cfg: AppConfig,
  params: {
    onStage?: (s: string) => void
    onProgress?: (p: { percent?: number; received: number; total?: number; speedBps?: number }) => void
    autoDeploy?: boolean
  }
) {
  const installRoot = await resolveRimeDir(cfg)
  await ensureDir(installRoot)

  const model =
    cfg.releaseSource === "github"
      ? await fetchLatestAssetFromGithub({
          owner: OWNER,
          repo: MODEL_REPO,
          tag: MODEL_TAG,
          assetNameExact: MODEL_FILE,
          token: cfg.githubToken,
        })
      : await fetchLatestAssetFromCnb({
          owner: OWNER,
          repo: CNB_REPO,
          assetNameExact: MODEL_FILE,
          needLastPage: true,
        })

  if (!model?.url) throw new Error("未找到可用的模型资产")

  // 模型不解压，下载后直接落盘到 installRoot 根目录
  const dstPath = Path.join(installRoot, MODEL_FILE)

  params.onStage?.("下载中…")
  const fm = FM()
  try {
    if (typeof fm?.removeSync === "function") fm.removeSync(dstPath)
    else if (typeof fm?.remove === "function") await fm.remove(dstPath)
  } catch {}
  await downloadWithProgress(model.url, dstPath, params.onProgress, (e) => {
    if (e.type === "retrying") {
      params.onStage?.(`下载中（重试 ${e.attempt}/${e.maxAttempts}）…`)
    }
  })

  await setModelMeta({
    installRoot,
    fileName: MODEL_FILE,
    tag: model.tag,
    updatedAt: model.updatedAt ?? new Date().toISOString(),
    remoteIdOrSha: model.remoteIdOrSha ?? model.updatedAt ?? model.url,
    source: cfg.releaseSource,
  })

  if (params.autoDeploy) await deployIfEnabled(cfg, params.onStage)
  return model
}

// ===== 自动更新：支持传入预先检查结果（避免重复请求，也便于 UI 先展示远程信息）=====
export async function autoUpdateAll(
  cfg: AppConfig,
  params: {
    onStage?: (s: string) => void
    onProgress?: (p: { percent?: number; received: number; total?: number; speedBps?: number }) => void
  },
  prechecked?: AllUpdateResult
) {
  params.onStage?.("自动更新：检查更新中…")
  const r = prechecked ?? (await checkAllUpdates(cfg))
  const installRoot = await resolveRimeDir(cfg)
  const meta = await loadMetaAsync(installRoot)

  const schemeRemoteMark = r.scheme?.tag ?? r.scheme?.name
  const needScheme = !!(schemeRemoteMark && (meta.scheme?.remoteTagOrName ?? "") !== schemeRemoteMark)

  const needDict = !!(
    r.dict &&
    (!r.dict.remoteIdOrSha || (meta.dict?.remoteIdOrSha ?? "") !== r.dict.remoteIdOrSha)
  )
  const needModel = !!(
    r.model &&
    (!r.model.remoteIdOrSha || (meta.model?.remoteIdOrSha ?? "") !== r.model.remoteIdOrSha)
  )

  if (!needScheme && !needDict && !needModel) {
    params.onStage?.("自动更新：已是最新，无需更新")
    return r
  }

  // 自动更新：按需下载三项，最后统一部署一次
  if (needScheme) {
    await updateScheme(cfg, {
      onStage: (s) => params.onStage?.(`方案：${s}`),
      onProgress: params.onProgress,
      autoDeploy: false,
    })
  }
  if (needDict) {
    await updateDict(cfg, {
      onStage: (s) => params.onStage?.(`词库：${s}`),
      onProgress: params.onProgress,
      autoDeploy: false,
    })
  }
  if (needModel) {
    await updateModel(cfg, {
      onStage: (s) => params.onStage?.(`模型：${s}`),
      onProgress: params.onProgress,
      autoDeploy: false,
    })
  }

  // 自动更新后统一清理 dicts 下残留的词库子文件夹
  const exclude = getExcludePatterns(cfg)
  await mergeSubdirsByName(Path.join(installRoot, "dicts"), {
    excludePatterns: exclude,
    namePattern: /dict/i,
  })

  // 统一部署（你指定：安装目录/build）
  await deployIfEnabled(cfg, params.onStage)

  params.onStage?.("自动更新：完成")
  return r
}
