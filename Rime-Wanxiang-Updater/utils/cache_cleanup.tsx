import { FM, normalizePath, removePathLoose } from "./common"

const TEMP_FILE_PREFIX = "wanxiang_tmp_"

async function listDirectoryEntries(dir: string): Promise<string[]> {
  const fm = FM()
  if (!fm) return []
  const base = dir.endsWith("/") ? dir : dir + "/"
  const normalizeEntries = (raw: any): string[] => {
    if (!Array.isArray(raw)) return []
    return raw
      .map(String)
      .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
      .filter((p) => p && p !== "." && p !== "..")
  }
  try {
    if (typeof fm.readDirectory === "function") {
      return normalizeEntries(await fm.readDirectory(dir))
    }
    if (typeof fm.readDirectorySync === "function") {
      return normalizeEntries(fm.readDirectorySync(dir))
    }
    if (typeof fm.contentsOfDirectory === "function") {
      return normalizeEntries(await fm.contentsOfDirectory(dir))
    }
  } catch { }
  return []
}

async function pathExists(path: string): Promise<boolean> {
  const fm = FM()
  if (!fm) return false
  try {
    if (typeof fm.exists === "function") return !!(await fm.exists(path))
    if (typeof fm.fileExists === "function") return !!(await fm.fileExists(path))
  } catch { }
  return false
}

export async function clearWanxiangTempFiles(): Promise<number> {
  const fm = FM()
  const dirs = Array.from(
    new Set(
      [
        normalizePath(String(fm?.temporaryDirectory ?? "")),
        "/tmp",
      ].filter(Boolean)
    )
  )
  let removed = 0
  for (const dir of dirs) {
    const names = await listDirectoryEntries(dir)
    for (const name of names) {
      if (!String(name).startsWith(TEMP_FILE_PREFIX)) continue
      const fullPath = `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${name}`
      try {
        await removePathLoose(fullPath)
        if (!(await pathExists(fullPath))) removed += 1
      } catch { }
    }
  }
  return removed
}
