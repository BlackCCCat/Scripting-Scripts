// File: utils/common.tsx
// 公共工具函数，消除跨文件重复代码
import { Runtime } from "./runtime"

// ===== 运行时访问 =====

export function FM(): any {
    return (globalThis as any).FileManager ?? Runtime.FileManager
}

export function storage(): any {
    return (globalThis as any).Storage ?? Runtime.Storage
}

// ===== 异步兼容 =====

export function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms))
}

export async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
    try {
        const r = fn.apply(thisArg, args)
        if (r && typeof r === "object" && typeof r.then === "function") return await r
        return r
    } catch {
        return undefined
    }
}

// ===== 路径工具 =====

export function normalizePath(p: string): string {
    return String(p ?? "").trim().replace(/\/+$/, "")
}

export function basename(p: string): string {
    const x = String(p ?? "")
    const i = x.lastIndexOf("/")
    return i >= 0 ? x.slice(i + 1) : x
}

export function dirname(p: string): string {
    const x = String(p ?? "")
    const i = x.lastIndexOf("/")
    if (i <= 0) return ""
    return x.slice(0, i)
}

// ===== 文件操作兼容 =====

export async function removePathLoose(path: string) {
    const fm = FM()
    try {
        if (typeof fm?.removeSync === "function") {
            fm.removeSync(path)
            return
        }
        if (typeof fm?.remove === "function") {
            await fm.remove(path)
            return
        }
        if (typeof fm?.delete === "function") {
            await fm.delete(path)
            return
        }
    } catch { }
}

export function tempDownloadPath(fileName: string): string {
    const fm = FM()
    const base = String(fm?.temporaryDirectory ?? "/tmp")
    const safeName = String(fileName ?? "asset.bin").replace(/[\\/]/g, "_")
    return `${base}/wanxiang_tmp_${Date.now()}_${safeName}`
}

export async function getFileSize(fm: any, path: string): Promise<number> {
    if (typeof fm?.fileSizeSync === "function") return Number(fm.fileSizeSync(path) ?? 0)
    if (typeof fm?.fileSize === "function") return Number((await fm.fileSize(path)) ?? 0)
    if (typeof fm?.statSync === "function") return Number(fm.statSync(path)?.size ?? 0)
    if (typeof fm?.stat === "function") return Number((await fm.stat(path))?.size ?? 0)
    if (typeof fm?.attributesSync === "function") {
        const a = fm.attributesSync(path)
        return Number(a?.size ?? a?.fileSize ?? 0)
    }
    if (typeof fm?.attributes === "function") {
        const a = await fm.attributes(path)
        return Number(a?.size ?? a?.fileSize ?? 0)
    }
    throw new Error("无法获取文件大小（FileManager 缺少 fileSize/stat/attributes）")
}

// ===== 模式匹配 =====

export function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function compilePatterns(patterns: string[]): RegExp[] {
    const list: RegExp[] = []
    for (const raw of patterns ?? []) {
        const p = String(raw ?? "").trim()
        if (!p) continue
        try {
            list.push(new RegExp(p))
            continue
        } catch { }
        list.push(new RegExp("^" + p.split("*").map(escapeRe).join(".*") + "$", "i"))
    }
    return list
}

export function matchAny(v: string, patterns: RegExp[]): boolean {
    for (const re of patterns) {
        if (re.test(v)) return true
    }
    return false
}

// ===== GitHub/CNB 工具 =====

export function pickGithubSha256FromDigest(digest?: string): string | undefined {
    if (!digest) return undefined
    const m = String(digest).match(/sha256\s*:\s*([0-9a-fA-F]{32,})/i)
    return m?.[1]
}

export function globToRegExp(glob: string): RegExp {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    return new RegExp("^" + esc + "$", "i")
}

export function pickExpectedSize(asset: any): number | undefined {
    const candidates = [
        asset?.size,
        asset?.fileSize,
        asset?.contentLength,
        asset?.bytes,
        asset?.asset?.size,
        asset?.asset?.fileSize,
    ]
    for (const v of candidates) {
        const n = typeof v === "string" ? Number(v) : v
        if (typeof n === "number" && Number.isFinite(n) && n > 0) return n
    }
    return undefined
}
