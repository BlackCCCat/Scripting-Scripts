// File: utils/storage.ts
const Keychain: any = (globalThis as any).Keychain

/**
 * 用 Keychain 做持久化 JSON 存储：
 * - 解决 FileManager 没有 write/writeFile 的问题
 * - 适合存储：版本号 / 远端 id / sha256 等小数据
 */
const KC_PREFIX = "wanxiang_updater::"

function kcKey(key: string) {
  return KC_PREFIX + key
}

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    // Keychain.get(key: string): Promise<string | null> (按文档语义)
    // 这里用 any 兼容不同版本的 TS 声明
    const raw = await (Keychain as any).get(kcKey(key))
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function saveJSON<T>(key: string, value: T): Promise<void> {
  const raw = JSON.stringify(value ?? null)
  // Keychain.set(key: string, value: string): Promise<void>
  await (Keychain as any).set(kcKey(key), raw)
}

export async function removeKey(key: string): Promise<void> {
  try {
    await (Keychain as any).remove(kcKey(key))
  } catch {
    // ignore
  }
}

/** 统一存的“本地记录”结构（用于下次启动显示/对比） */
export type LocalRecord = {
  scheme?: {
    // 你要求“方案版本号也和词库/模型一样：下载成功后记录远端标识”
    // GitHub: sha256；CNB: id；如果只有 tag/name 也可存
    remoteIdOrSha?: string
    remoteVersion?: string
    updatedAt?: string
  }
  dict?: {
    remoteIdOrSha?: string
    updatedAt?: string
  }
  model?: {
    remoteIdOrSha?: string
    updatedAt?: string
  }
}

const RECORD_KEY = "local_record"

export async function loadLocalRecord(): Promise<LocalRecord> {
  return loadJSON<LocalRecord>(RECORD_KEY, {})
}

export async function saveLocalRecord(patch: Partial<LocalRecord>): Promise<LocalRecord> {
  const cur = await loadLocalRecord()
  const next: LocalRecord = {
    ...cur,
    ...patch,
    scheme: { ...(cur.scheme ?? {}), ...(patch.scheme ?? {}) },
    dict: { ...(cur.dict ?? {}), ...(patch.dict ?? {}) },
    model: { ...(cur.model ?? {}), ...(patch.model ?? {}) },
  }
  await saveJSON(RECORD_KEY, next)
  return next
}
