// File: utils/update_tasks.ts
import { Path } from "scripting"
import type { AppConfig } from "./config"
import { getExcludePatterns } from "./config"
import { Runtime } from "./runtime"
import { sleep, FM, removePathLoose, tempDownloadPath, pickGithubSha256FromDigest, globToRegExp, pickExpectedSize, getFileSize } from "./common"
import { downloadWithProgress } from "./downloader"
import { ensureDir, removeDirSafe, unzipToDirWithOverwrite, mergeSubdirsByName } from "./fs"
import { deployHamster } from "./deploy"
import { assertInstallPathAccess, detectRimeDir } from "./hamster"

import { loadMetaAsync, setDictMeta, setModelMeta, setSchemeMeta } from "./meta"
import { removeExtractedFiles, setExtractedFiles } from "./extracted_cache"

const OWNER = "amzxyz"
const GH_REPO = "rime_wanxiang"
const CNB_REPO = "rime-wanxiang"

const DICT_TAG = "dict-nightly"
const MODEL_REPO = "RIME-LMDG"
const MODEL_TAG = "LTS"
const MODEL_FILE = "wanxiang-lts-zh-hans.gram"
const CNB_DICT_TITLE = "\u8bcd\u5e93"
const CNB_SCHEME_TITLE = "\u4e07\u8c61\u62fc\u97f3\u8f93\u5165\u65b9\u6848"

export type RemoteAsset = {
  name: string
  url: string
  tag?: string
  body?: string
  updatedAt?: string
  remoteIdOrSha?: string
  size?: number
}

export type AllUpdateResult = {
  scheme?: RemoteAsset
  dict?: RemoteAsset
  model?: RemoteAsset
}

export type AutoUpdateRunResult = {
  remote: AllUpdateResult
  updated: {
    scheme: boolean
    dict: boolean
    model: boolean
  }
  didUpdate: boolean
  didDeploy: boolean
}

function normalizeMark(v?: string): string {
  return String(v ?? "").trim().toLowerCase()
}

function ensureRemoteMark(asset?: RemoteAsset, kind?: "dict" | "model"): string | undefined {
  if (!asset) return undefined
  const direct = String(asset.remoteIdOrSha ?? "").trim()
  if (direct) return direct

  const name = String(asset.name ?? "").trim()
  const size = typeof asset.size === "number" && Number.isFinite(asset.size) && asset.size > 0 ? asset.size : undefined
  if (kind && name && size) return `${kind}:${name}:${size}`

  const updatedAt = String(asset.updatedAt ?? "").trim()
  if (kind && name && updatedAt) return `${kind}:${name}:${updatedAt}`

  const tag = String(asset.tag ?? "").trim()
  if (kind && name && tag) return `${kind}:${name}:${tag}`

  const url = String(asset.url ?? "").trim()
  if (kind && name && url) return `${kind}:${name}:${url}`

  return undefined
}

async function httpJson(url: string, init?: any) {
  const fetchFn = Runtime.fetch
  if (!fetchFn) throw new Error("\u8fd0\u884c\u65f6\u6ca1\u6709 fetch")
  const res = await fetchFn(url, init)
  if (!res.ok) throw new Error(`\u8bf7\u6c42\u5931\u8d25\uff1a${res.status} ${res.statusText}`)
  const json = await res.json()
  return { json, headers: res.headers }
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
        size: typeof a?.size === "number" ? a.size : undefined, // ✅ GitHub 资产一般带 size
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
        tag: String(rel?.tag_ref ?? rel?.tag_name ?? rel?.tagName ?? "").split("/").pop() || undefined,
        body: rel.body,
        remoteIdOrSha: a?.id != null ? String(a.id) : undefined,
        size:
          typeof a?.size === "number"
            ? a.size
            : typeof a?.fileSize === "number"
              ? a.fileSize
              : undefined, // ✅ CNB 可能是 size 或 fileSize
      }
    }
  }

  return undefined
}

function dictPattern(cfg: AppConfig): string {
  if (cfg.schemeEdition === "base") return "*base*dicts*.zip"
  return `*${cfg.proSchemeKey}*dicts.zip`
}

function schemePattern(cfg: AppConfig): string {
  return cfg.schemeEdition === "base" ? "*base.zip" : `*${cfg.proSchemeKey}*fuzhu.zip`
}

async function fetchLatestSchemeAsset(cfg: AppConfig): Promise<RemoteAsset | undefined> {
  const glob = schemePattern(cfg)
  if (cfg.releaseSource === "github") {
    return fetchLatestAssetFromGithub({
      owner: OWNER,
      repo: GH_REPO,
      assetNameGlob: glob,
      token: cfg.githubToken,
    })
  }
  return fetchLatestAssetFromCnb({
    owner: OWNER,
    repo: CNB_REPO,
    assetNameGlob: glob,
    releaseTitleIncludes: [CNB_SCHEME_TITLE],
  })
}

async function resolveRimeDir(cfg: AppConfig): Promise<string> {
  return await assertInstallPathAccess(cfg)
}

// ===== 统一检查：方案/词库/模型 =====
export async function checkAllUpdates(cfg: AppConfig): Promise<AllUpdateResult> {
  const scheme = await fetchLatestSchemeAsset(cfg).catch(() => undefined)
  if (scheme && !scheme.remoteIdOrSha) {
    scheme.remoteIdOrSha = scheme.tag ?? scheme.name
  }

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

  if (dict && !dict.remoteIdOrSha) {
    dict.remoteIdOrSha = ensureRemoteMark(dict, "dict")
  }
  if (model && !model.remoteIdOrSha) {
    model.remoteIdOrSha = ensureRemoteMark(model, "model")
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
  params.onStage?.("解析目录...")
  const { engine } = await detectRimeDir(cfg)
  const installDir = await assertInstallPathAccess(cfg)

  const latest = await fetchLatestSchemeAsset(cfg)
  if (!latest?.url) throw new Error("\u672A\u627E\u5230\u53EF\u7528\u7684\u8FDC\u7AEF\u65B9\u6848\u8D44\u4EA7")

  await ensureDir(installDir)
  await removeDirSafe(Path.join(installDir, "UpdateCache"))
  const zipPath = tempDownloadPath(latest.name)
  await removePathLoose(zipPath)

  try {
    params.onStage?.("下载中...")
    await downloadWithProgress(latest.url, zipPath, params.onProgress, (e) => {
      if (e.type === "retrying") {
        params.onStage?.(`\u4E0B\u8F7D\u4E2D\uFF08\u91CD\u8BD5 ${e.attempt}/${e.maxAttempts}\uFF09...`)
      }
    })

    // \u6587\u4EF6\u5927\u5C0F\u6821\u9A8C
    const expectedSize = pickExpectedSize(latest)
    if (expectedSize) {
      const fm = FM()
      const actualSize = await getFileSize(fm, zipPath)
      if (actualSize > 0 && Math.abs(actualSize - expectedSize) > expectedSize * 0.05) {
        throw new Error(`\u65B9\u6848\u4E0B\u8F7D\u6587\u4EF6\u5927\u5C0F\u4E0D\u5339\u914D\uFF08\u671F\u671B ${expectedSize} \u5B57\u8282\uFF0C\u5B9E\u9645 ${actualSize} \u5B57\u8282\uFF09`)
      }
    }

    const exclude = getExcludePatterns(cfg)
    params.onStage?.("清理旧文件中…")
    const removed = await removeExtractedFiles({
      installRoot: installDir,
      kind: "scheme",
      compareRoot: installDir,
      excludePatterns: exclude,
    })
    if (removed > 0) {
      params.onStage?.(`\u5DF2\u6E05\u7406\u65E7\u6587\u4EF6\uFF1A${removed} \u4E2A`)
    }
    params.onStage?.("解压中...")
    const copied = new Set<string>()
    await unzipToDirWithOverwrite(zipPath, installDir, {
      excludePatterns: exclude,
      onCopiedFile: (dstPath) => copied.add(String(dstPath)),
    })
    setExtractedFiles(installDir, "scheme", Array.from(copied))
  } finally {
    await removePathLoose(zipPath)
  }

  // \u8BB0\u5F55\u65B9\u6848\u7248\u672C
  const remoteIdOrSha = latest.remoteIdOrSha ?? latest.tag ?? latest.name
  await setSchemeMeta({
    installRoot: installDir,
    bookmarkName: cfg.hamsterBookmarkName,
    fileName: latest.name,
    schemeEdition: cfg.schemeEdition,
    proSchemeKey: cfg.schemeEdition === "pro" ? cfg.proSchemeKey : undefined,
    inputMethod: cfg.inputMethod,
    tag: latest.tag,
    updatedAt: latest.updatedAt ?? new Date().toISOString(),
    remoteIdOrSha,
    source: cfg.releaseSource,
  })

  if (params.autoDeploy) await deployIfEnabled(cfg, params.onStage)
  return { engine, installRoot: installDir, assetName: latest.name, tag: latest.tag, updatedAt: latest.updatedAt, remoteIdOrSha }
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
  await removeDirSafe(Path.join(installRoot, "UpdateCache"))

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

  const zipPath = tempDownloadPath(dict.name)
  await removePathLoose(zipPath)

  try {
    params.onStage?.("下载中…")
    await downloadWithProgress(dict.url, zipPath, params.onProgress, (e) => {
      if (e.type === "retrying") {
        params.onStage?.(`下载中（重试 ${e.attempt}/${e.maxAttempts}）…`)
      }
    })

    // 文件大小校验
    const expectedSize = pickExpectedSize(dict)
    if (expectedSize) {
      const fm = FM()
      const actualSize = await getFileSize(fm, zipPath)
      if (actualSize > 0 && Math.abs(actualSize - expectedSize) > expectedSize * 0.05) {
        throw new Error(`词库下载文件大小不匹配（期望 ${expectedSize} 字节，实际 ${actualSize} 字节）`)
      }
    }

    const exclude = getExcludePatterns(cfg)
    const dictDir = Path.join(installRoot, "dicts")
    await ensureDir(dictDir)
    params.onStage?.("清理旧文件中…")
    const removed = await removeExtractedFiles({
      installRoot,
      kind: "dict",
      compareRoot: dictDir,
      excludePatterns: exclude,
    })
    if (removed > 0) {
      params.onStage?.(`已清理旧文件：${removed} 个`)
    }
    params.onStage?.("解压到 dicts 目录中…")
    const copied = new Set<string>()
    await unzipToDirWithOverwrite(zipPath, dictDir, {
      excludePatterns: exclude,
      flattenSingleDir: true,
      onCopiedFile: (dstPath) => copied.add(String(dstPath)),
    })
    await mergeSubdirsByName(dictDir, {
      excludePatterns: exclude,
      namePattern: /dict/i,
      onCopiedFile: (dstPath) => copied.add(String(dstPath)),
    })
    setExtractedFiles(installRoot, "dict", Array.from(copied))
  } finally {
    await removePathLoose(zipPath)
  }

  await setDictMeta({
    installRoot,
    bookmarkName: cfg.hamsterBookmarkName,
    fileName: dict.name,
    inputMethod: cfg.inputMethod,
    tag: dict.tag,
    updatedAt: dict.updatedAt ?? new Date().toISOString(),
    remoteIdOrSha: ensureRemoteMark(dict, "dict"),
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
  await removeDirSafe(Path.join(installRoot, "UpdateCache"))

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

  // ✅ 期望大小：优先使用远端资产元数据中的 size
  const expectedSize = pickExpectedSize(model)

  // 模型不解压，下载后直接落盘到 installRoot 根目录
  const dstPath = Path.join(installRoot, MODEL_FILE)
  const tempPath = tempDownloadPath(MODEL_FILE)

  params.onStage?.("下载中…")
  const fm = FM()
  await removePathLoose(tempPath)
  try {
    await downloadWithProgress(model.url, tempPath, params.onProgress, (e) => {
      if (e.type === "retrying") {
        params.onStage?.(`下载中（重试 ${e.attempt}/${e.maxAttempts}）…`)
      }
    })

    // ✅ 下载完成后先做完整性校验：大小不一致则认为失败，不覆盖 dstPath
    params.onStage?.("校验中…")
    {
      const actualSize = await getFileSize(fm, tempPath)
      if (expectedSize && expectedSize > 0) {
        if (actualSize !== expectedSize) {
          throw new Error(`下载不完整：实际 ${actualSize} bytes，期望 ${expectedSize} bytes`)
        }
      } else {
        if (actualSize <= 0) throw new Error("下载结果为空文件")
      }
    }

    // 校验通过后：原子替换到 dstPath
    params.onStage?.("写入中…")
    try {
      try {
        if (typeof fm?.removeSync === "function") fm.removeSync(dstPath)
        else if (typeof fm?.remove === "function") await fm.remove(dstPath)
      } catch { }

      if (typeof fm?.moveSync === "function") {
        fm.moveSync(tempPath, dstPath)
      } else if (typeof fm?.move === "function") {
        await fm.move(tempPath, dstPath)
      } else if (typeof fm?.renameSync === "function") {
        fm.renameSync(tempPath, dstPath)
      } else if (typeof fm?.rename === "function") {
        await fm.rename(tempPath, dstPath)
      } else if (typeof fm?.copySync === "function") {
        fm.copySync(tempPath, dstPath)
        if (typeof fm?.removeSync === "function") fm.removeSync(tempPath)
        else if (typeof fm?.remove === "function") await fm.remove(tempPath)
      } else if (typeof fm?.copy === "function") {
        await fm.copy(tempPath, dstPath)
        if (typeof fm?.removeSync === "function") fm.removeSync(tempPath)
        else if (typeof fm?.remove === "function") await fm.remove(tempPath)
      } else {
        throw new Error("FileManager 不支持 move/rename/copy 操作")
      }
    } catch (err) {
      params.onStage?.("写入失败")
      throw err
    }
  } finally {
    await removePathLoose(tempPath)
  }

  await setModelMeta({
    installRoot,
    bookmarkName: cfg.hamsterBookmarkName,
    fileName: MODEL_FILE,
    inputMethod: cfg.inputMethod,
    tag: model.tag,
    updatedAt: model.updatedAt ?? new Date().toISOString(),
    remoteIdOrSha: ensureRemoteMark(model, "model"),
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
): Promise<AutoUpdateRunResult> {
  params.onStage?.("自动更新：检查更新中…")
  const r = prechecked ?? (await checkAllUpdates(cfg))
  const installRoot = await resolveRimeDir(cfg)
  const meta = await loadMetaAsync(installRoot, cfg.hamsterBookmarkName)

  const schemeRemoteMark = r.scheme?.tag ?? r.scheme?.name
  const needScheme = !!(schemeRemoteMark && normalizeMark(meta.scheme?.remoteTagOrName) !== normalizeMark(schemeRemoteMark))

  const remoteDictMark = normalizeMark(ensureRemoteMark(r.dict, "dict"))
  const localDictMark = normalizeMark(meta.dict?.remoteIdOrSha)
  const needDict = !!(r.dict && remoteDictMark && localDictMark !== remoteDictMark)

  const remoteModelMark = normalizeMark(ensureRemoteMark(r.model, "model"))
  const localModelMark = normalizeMark(meta.model?.remoteIdOrSha)
  const needModel = !!(r.model && remoteModelMark && localModelMark !== remoteModelMark)

  if (!needScheme && !needDict && !needModel) {
    params.onStage?.("自动更新：已是最新，无需更新")
    return {
      remote: r,
      updated: { scheme: false, dict: false, model: false },
      didUpdate: false,
      didDeploy: false,
    }
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
  return {
    remote: r,
    updated: { scheme: needScheme, dict: needDict, model: needModel },
    didUpdate: true,
    didDeploy: cfg.autoDeployAfterDownload !== false,
  }
}
