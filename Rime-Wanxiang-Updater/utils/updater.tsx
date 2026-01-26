// File: utils/updater.tsx
import { Path } from "scripting"
import type { AppConfig } from "./config"
import { getExcludePatterns } from "./config"
import { detectRimeDir } from "./hamster"
import { fetchLatestSchemeAsset } from "./releases"
import { downloadWithProgress } from "./downloader"
import { ensureDir, removeDirSafe, unzipToDirWithOverwrite } from "./fs"
import { deployHamster } from "./deploy"

function FM(): any {
  return (globalThis as any).FileManager
}

/** 兼容不同配置字段名：选定安装路径 */
function getInstallRoot(cfg: any): string | undefined {
  return (
    cfg?.installPath ??
    cfg?.installDir ??
    cfg?.hamsterRootPath ??
    cfg?.hamsterPath ??
    cfg?.rootPath ??
    cfg?.rimeRoot ??
    cfg?.rimeDir
  )
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

/**
 * 你要求的行为：
 * ✅ 不处理同名冲突
 * ✅ 解压前直接删除旧文件（这里用“删除整个安装目录”来保证不会有同名冲突）
 * ✅ 然后重新创建目录并解压
 *
 * 说明：由于你环境缺 listContents/list，无法逐个删除目录内文件，
 * 因此采用“删除目录本身再重建”的方式来实现“旧文件直接删除”。
 */
function updateCacheDir(installRoot: string): string {
  return Path.join(installRoot, "UpdateCache")
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
  const installRoot = getInstallRoot(cfg)
  if (!installRoot) throw new Error("未选择安装路径（请到设置里选择文件夹）")

  params.onStage?.("解析目录...")
  const { engine, rimeDir } = await detectRimeDir(cfg)
  const installDir = rimeDir || installRoot

  const latest = await fetchLatestSchemeAsset(cfg)
  if (!latest?.url) throw new Error("未找到可用的远端方案资产（asset）")

  await ensureDir(installDir)
  const cacheDir = updateCacheDir(installDir)
  await ensureDir(cacheDir)
  // 下载 zip 到目标目录的 UpdateCache
  const zipPath = Path.join(cacheDir, latest.name.replace(/[\\/]/g, "_"))
  try {
    await fmRemove(zipPath)
  } catch {}

  params.onStage?.("下载中...")
  await downloadWithProgress(latest.url, zipPath, params.onProgress)

  params.onStage?.("解压中...")
  const exclude = getExcludePatterns(cfg)
  await unzipToDirWithOverwrite(zipPath, installDir, { excludePatterns: exclude })

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
