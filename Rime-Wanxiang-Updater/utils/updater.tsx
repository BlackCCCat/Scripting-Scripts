// File: utils/updater.tsx
import { Path } from "scripting"
import type { AppConfig } from "./config"
import { getExcludePatterns } from "./config"
import { assertInstallPathAccess, detectRimeDir } from "./hamster"
import { fetchLatestSchemeAsset } from "./releases"
import { downloadWithProgress } from "./downloader"
import { ensureDir, removeDirSafe, unzipToDirWithOverwrite } from "./fs"
import { deployHamster } from "./deploy"
import { removeExtractedFiles, setExtractedFiles } from "./extracted_cache"

function FM(): any {
  return (globalThis as any).FileManager
}

/**
 * 按文档删除：FileManager.remove / removeSync
 * https://www.scripting.fun/doc_v2/zh/guide/doc_v2/Utilities/FileManager#remove--removesync
 */
async function fmRemove(path: string) {
  const fm = FM()
  if (!fm) throw new Error("FileManager 不可用")

  // 优先同步删除（最贴近文档 & 行为最确定）
  if (typeof fm.removeSync === "function") {
    fm.removeSync(path)
    return
  }
  if (typeof fm.remove === "function") {
    await fm.remove(path)
    return
  }
  throw new Error("FileManager 缺少 remove/removeSync")
}

function tempDownloadPath(fileName: string): string {
  const fm = FM()
  const base = String(fm?.temporaryDirectory ?? "/tmp")
  const safeName = String(fileName ?? "asset.zip").replace(/[\\/]/g, "_")
  return Path.join(base, `wanxiang_tmp_${Date.now()}_${safeName}`)
}

export type CheckResult = {
  latest?: {
    name: string
    tag?: string
    body?: string
    updatedAt?: string
    url: string
    idOrSha?: string
  }
}

export async function checkUpdate(cfg: AppConfig): Promise<CheckResult> {
  const latest = await fetchLatestSchemeAsset(cfg)
  if (!latest) return {}
  return { latest }
}

export async function doUpdate(
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
  if (!latest?.url) throw new Error("未找到可用的远端方案资产（asset）")

  await ensureDir(installDir)
  await removeDirSafe(Path.join(installDir, "UpdateCache"))
  const zipPath = tempDownloadPath(latest.name)
  try {
    await fmRemove(zipPath)
  } catch {}

  try {
    params.onStage?.("下载中...")
    await downloadWithProgress(latest.url, zipPath, params.onProgress, (e) => {
      if (e.type === "retrying") {
        params.onStage?.(`下载中（重试 ${e.attempt}/${e.maxAttempts}）...`)
      }
    })

    const exclude = getExcludePatterns(cfg)
    params.onStage?.("清理旧文件中…")
    const removed = await removeExtractedFiles({
      installRoot: installDir,
      kind: "scheme",
      compareRoot: installDir,
      excludePatterns: exclude,
    })
    if (removed > 0) {
      params.onStage?.(`已清理旧文件：${removed} 个`)
    }
    params.onStage?.("解压中...")
    const copied = new Set<string>()
    await unzipToDirWithOverwrite(zipPath, installDir, {
      excludePatterns: exclude,
      onCopiedFile: (dstPath) => copied.add(String(dstPath)),
    })
    setExtractedFiles(installDir, "scheme", Array.from(copied))
  } finally {
    try {
      await fmRemove(zipPath)
    } catch {}
  }

  if (params.autoDeploy) {
    // 这里保留你原本的逻辑：部署前删 build
    params.onStage?.("部署前清理 build...")
    await removeDirSafe(Path.join(installDir, "build"))

    params.onStage?.("触发部署中...")
    await deployHamster(cfg.inputMethod)
  }

  params.onStage?.("完成")
  return {
    engine,
    installRoot: installDir,
    assetName: latest.name,
    tag: latest.tag,
    updatedAt: latest.updatedAt,
    remoteIdOrSha: latest.idOrSha,
  }
}
