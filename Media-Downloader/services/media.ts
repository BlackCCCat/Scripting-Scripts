import { Path, Script, fetch, type Cookie } from "scripting"
import {
  DOWNLOAD_DIR,
  ROOT_DIR,
  downloadVideo as downloadDouyinVideo,
  ensureDownloadDirectories,
  MOBILE_SAFARI_UA,
  type DownloadLogFn,
  type DownloadProgressFn,
  type DownloadSuccess,
} from "./douyin"
import { formatBytes, sanitizeFileName } from "../utils/common"
import { cancelBackgroundDownloads } from "./background-download"

type ShellDownloadResult = {
  exitCode: number
  output: string
  paths: string[]
  metadata?: MediaMetadata | null
}

type YtDlpProgress = {
  status?: string
  percent?: number | null
  downloadedBytes?: number
  totalBytes?: number | null
  speed?: number | null
  eta?: number | null
  fragmentIndex?: number | null
  fragmentCount?: number | null
  part?: number | null
  totalParts?: number | null
  updatedAt?: number
}

type YtDlpFormat = {
  format_id: string
  format_note?: string | null
  ext?: string | null
  vcodec?: string | null
  acodec?: string | null
  height?: number | null
  width?: number | null
  abr?: number | null
  tbr?: number | null
  fps?: number | null
  filesize?: number | null
  filesize_approx?: number | null
  protocol?: string | null
}

type YtDlpProbe = MediaMetadata & {
  extractor_key?: string | null
  duration?: number | null
  formats: YtDlpFormat[]
}

type GenericDownloadChoice =
  | {
      kind: "progressive"
      format: YtDlpFormat
      label: string
    }
  | {
      kind: "adaptive"
      video: YtDlpFormat
      audio: YtDlpFormat
      label: string
    }

type YtDlpProbeResult = {
  probe: YtDlpProbe
  noCheckCertificate: boolean
  url: string
  httpHeaders?: Record<string, string>
  cookieFilePath?: string
}

type HLSDownloadPlan = {
  playlistURL: string
  segments: Array<{
    url: string
    duration: number
  }>
  initMapURL?: string
  unsupportedReason?: string
}

type HLSMasterSelection = {
  videoURL: string
  audioURL?: string
  bandwidth?: number
}

export type MediaDownloadKind = "douyin" | "youtube" | "m3u8" | "generic"

type MediaMetadata = {
  id?: string | null
  title?: string | null
  description?: string | null
  webpage_url?: string | null
  thumbnail?: string | null
}

const SCRIPT_DIR = Script.directory
const TEMP_DIR = Path.join(ROOT_DIR, "tmp")
const YTDLP_RUNNER_PATH = Path.join(SCRIPT_DIR, "ytdlp_runner.py")
const CANCEL_FLAG_PATH = Path.join(TEMP_DIR, "cancel.flag")
const YTDLP_PROGRESS_PATH = Path.join(TEMP_DIR, "ytdlp-progress.json")
const YTDLP_COOKIE_PATH = Path.join(TEMP_DIR, "yt-dlp-cookies.txt")
const YTDLP_FORMAT_SORT = ["vcodec:h264", "lang", "quality", "res", "fps", "hdr:12", "acodec:aac"]
const DESKTOP_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
let ytdlpConfigCounter = 0
const currentTaskPaths = new Set<string>()

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function commandLine(args: string[]): string {
  const [command, ...rest] = args
  return [command, ...rest.map(shellQuote)].join(" ")
}

function compactLog(output: string, maxLength = 2200): string {
  const trimmed = output.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `...${trimmed.slice(trimmed.length - maxLength)}`
}

function logShellResult(log: DownloadLogFn | undefined, label: string, result: Partial<ShellExecutionResult>, maxLength = 2200) {
  const flags = [
    `exit=${result.exitCode ?? "unknown"}`,
    result.timedOut ? "timedOut=true" : null,
    result.cancelled ? "cancelled=true" : null,
  ].filter(Boolean).join(" · ")
  log?.(`${label}：${flags}`)
  const output = typeof result.output === "string" ? result.output.trim() : ""
  if (output) {
    log?.(`${label} 输出：${compactLog(output, maxLength)}`)
  }
}

function isCertificateVerifyFailure(output: string | undefined): boolean {
  return /CERTIFICATE_VERIFY_FAILED|certificate verify failed|self-signed certificate/i.test(output || "")
}

function isInstagramEmptyMediaResponse(output: string | undefined): boolean {
  return /Instagram sent an empty media response/i.test(output || "")
}

function normalizeInstagramURL(url: string): string {
  if (!hostMatches(hostFromURL(url), ["instagram.com"])) return url
  const match = url.match(/^(https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[^/?#]+)/i)
  return match ? `${match[1]}/` : url
}

function instagramBrowserHeaders(url: string): Record<string, string> {
  return {
    "User-Agent": DESKTOP_BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Referer": normalizeInstagramURL(url),
  }
}

function netscapeBoolean(value: boolean): string {
  return value ? "TRUE" : "FALSE"
}

function cookieExpiry(cookie: Cookie): number {
  if (cookie.isSessionOnly || !cookie.expiresDate) return 0
  const date = cookie.expiresDate instanceof Date ? cookie.expiresDate : new Date(cookie.expiresDate)
  const timestamp = Math.floor(date.getTime() / 1000)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function cookieDomainForNetscape(cookie: Cookie): string {
  return cookie.domain || ""
}

function serializeCookiesForYtDlp(cookies: Cookie[]): string {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by Media Downloader from Scripting WebView cookies.",
  ]
  for (const cookie of cookies) {
    if (!cookie.name || cookie.value == null || !cookie.domain) continue
    const domain = cookieDomainForNetscape(cookie)
    lines.push([
      domain,
      netscapeBoolean(domain.startsWith(".")),
      cookie.path || "/",
      netscapeBoolean(Boolean(cookie.isSecure)),
      String(cookieExpiry(cookie)),
      cookie.name,
      cookie.value,
    ].join("\t"))
  }
  return `${lines.join("\n")}\n`
}

async function writeYtDlpCookieFileForURL(url: string, log?: DownloadLogFn): Promise<string | undefined> {
  try {
    await ensureTempDirectory()
    const webView = new WebViewController()
    try {
      const cookies = await webView.getCookies(url)
      if (!cookies.length) {
        log?.("未找到可用于当前站点的 WebView Cookie。")
        await removeIfExists(YTDLP_COOKIE_PATH)
        return undefined
      }
      FileManager.writeAsStringSync(YTDLP_COOKIE_PATH, serializeCookiesForYtDlp(cookies))
      registerCurrentTaskPath(YTDLP_COOKIE_PATH)
      log?.(`已为当前站点导出 ${cookies.length} 条 WebView Cookie 给 yt-dlp。`)
      return YTDLP_COOKIE_PATH
    } finally {
      webView.dispose()
    }
  } catch (error) {
    log?.(`WebView Cookie 导出失败：${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function describeFormat(format: YtDlpFormat): string {
  const parts = [
    `id=${format.format_id}`,
    format.ext ? `ext=${format.ext}` : null,
    format.height ? `${format.height}p` : null,
    format.vcodec ? `v=${format.vcodec}` : null,
    format.acodec ? `a=${format.acodec}` : null,
    format.protocol ? `protocol=${format.protocol}` : null,
    format.tbr ? `tbr=${format.tbr}` : null,
    format.abr ? `abr=${format.abr}` : null,
    formatSize(format) > 0 ? `size=${formatBytes(formatSize(format))}` : null,
  ].filter(Boolean)
  return parts.join(" · ")
}

function extractDownloadedPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"))
    .filter((line) => [".mp4", ".m4v", ".mov", ".mkv", ".webm", ".m4a", ".aac", ".opus"].includes(Path.extname(line).toLowerCase()))
}

function extractYtDlpMetadata(output: string): MediaMetadata | null {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith("MEDIA_DOWNLOADER_METADATA "))
  if (!line) return null
  try {
    return JSON.parse(line.slice("MEDIA_DOWNLOADER_METADATA ".length))
  } catch {
    return null
  }
}

function extractYtDlpProbe(output: string): YtDlpProbe | null {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith("MEDIA_DOWNLOADER_PROBE "))
  if (!line) return null
  try {
    const parsed = JSON.parse(line.slice("MEDIA_DOWNLOADER_PROBE ".length)) as YtDlpProbe
    return {
      ...parsed,
      formats: Array.isArray(parsed.formats) ? parsed.formats : [],
    }
  } catch {
    return null
  }
}

function uniqueFilePath(directory: string, fileName: string): string {
  const ext = Path.extname(fileName)
  const stem = ext ? fileName.slice(0, -ext.length) : fileName
  let candidate = Path.join(directory, fileName)
  let index = 2
  while (FileManager.existsSync(candidate)) {
    candidate = Path.join(directory, `${stem} ${index}${ext}`)
    index += 1
  }
  return candidate
}

function registerCurrentTaskPath(path: string) {
  if (path) currentTaskPaths.add(path)
}

function resolveRelativeURL(baseURL: string, relativeURL: string): string {
  if (/^https?:\/\//i.test(relativeURL)) return relativeURL
  const baseWithoutQuery = baseURL.split("?")[0]
  const prefix = baseWithoutQuery.slice(0, baseWithoutQuery.lastIndexOf("/") + 1)
  if (relativeURL.startsWith("/")) {
    const originMatch = baseURL.match(/^(https?:\/\/[^/]+)/i)
    return `${originMatch?.[1] || ""}${relativeURL}`
  }
  return `${prefix}${relativeURL}`
}

function parseHLSAttributes(line: string): Record<string, string> {
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line
  const result: Record<string, string> = {}
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) {
    result[match[1]] = match[2].replace(/^"|"$/g, "")
  }
  return result
}

async function resolveBestM3U8Selection(sourceURL: string, log: DownloadLogFn | undefined): Promise<HLSMasterSelection> {
  try {
    const response = await fetch(sourceURL, {
      method: "GET",
      timeout: 30,
      debugLabel: "media-downloader-m3u8-master",
      headers: {
        "User-Agent": MOBILE_SAFARI_UA,
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      },
    })
    if (!response.ok) return { videoURL: sourceURL }
    const text = await response.text()
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const audioGroups = new Map<string, string>()
    for (const line of lines) {
      if (!line.startsWith("#EXT-X-MEDIA")) continue
      const attrs = parseHLSAttributes(line)
      if (attrs.TYPE !== "AUDIO" || !attrs["GROUP-ID"] || !attrs.URI) continue
      if (!audioGroups.has(attrs["GROUP-ID"]) || attrs.DEFAULT === "YES") {
        audioGroups.set(attrs["GROUP-ID"], resolveRelativeURL(sourceURL, attrs.URI))
      }
    }

    let best: { bandwidth: number; score: number; url: string; audioURL?: string } | null = null
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (!line.startsWith("#EXT-X-STREAM-INF")) continue
      const attrs = parseHLSAttributes(line)
      const bandwidth = Number(attrs.BANDWIDTH || 0)
      const nextLine = lines[index + 1]
      if (!nextLine || nextLine.startsWith("#")) continue
      const candidateURL = resolveRelativeURL(sourceURL, nextLine)
      const codecs = attrs.CODECS || ""
      const score = bandwidth + (codecs.includes("mp4a.") ? 1_000_000_000 : 0)
      if (!best || score > best.score) {
        best = {
          bandwidth,
          score,
          url: candidateURL,
          audioURL: attrs.AUDIO ? audioGroups.get(attrs.AUDIO) : undefined,
        }
      }
    }
    if (best) {
      log?.(`已选择 m3u8 最高码率子流：${best.bandwidth}`)
      return { videoURL: best.url, audioURL: best.audioURL, bandwidth: best.bandwidth }
    }
  } catch (error) {
    log?.(`m3u8 主列表解析失败，直接交给 ffmpeg：${error instanceof Error ? error.message : String(error)}`)
  }
  return { videoURL: sourceURL }
}

async function fetchM3U8Text(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    timeout: 30,
    debugLabel: "media-downloader-m3u8-playlist",
    headers: {
      "User-Agent": MOBILE_SAFARI_UA,
      Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
    },
  })
  if (!response.ok) {
    throw new Error(`m3u8 playlist request failed: ${response.status}`)
  }
  return response.text()
}

function parseHLSMediaPlaylist(playlistURL: string, text: string): HLSDownloadPlan {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.some((line) => line.startsWith("#EXT-X-KEY"))) {
    return { playlistURL, segments: [], unsupportedReason: "encrypted_hls" }
  }
  if (lines.some((line) => line.startsWith("#EXT-X-BYTERANGE"))) {
    return { playlistURL, segments: [], unsupportedReason: "byterange_hls" }
  }
  if (lines.some((line) => line.startsWith("#EXT-X-DISCONTINUITY"))) {
    return { playlistURL, segments: [], unsupportedReason: "discontinuity_hls" }
  }

  const mapLine = lines.find((line) => line.startsWith("#EXT-X-MAP"))
  const initMapURI = mapLine ? parseHLSAttributes(mapLine).URI : undefined

  const segments: HLSDownloadPlan["segments"] = []
  let pendingDuration = 0
  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      pendingDuration = Number(line.match(/^#EXTINF:([^,]+)/)?.[1] || 0)
      continue
    }
    if (!line || line.startsWith("#")) continue
    segments.push({
      url: resolveRelativeURL(playlistURL, line),
      duration: pendingDuration || 0,
    })
    pendingDuration = 0
  }

  return {
    playlistURL,
    segments,
    initMapURL: initMapURI ? resolveRelativeURL(playlistURL, initMapURI) : undefined,
  }
}

function segmentExtension(url: string): string {
  const cleanURL = url.split(/[?#]/)[0]
  const ext = Path.extname(cleanURL).toLowerCase()
  return ext || ".ts"
}

function fileSize(path: string): number {
  try {
    return FileManager.statSync(path).size
  } catch {
    const data = Data.fromFile(path)
    return data?.size || 0
  }
}

function hlsPlaylistURI(fileName: string): string {
  return fileName.replace(/"/g, "%22")
}

function buildLocalHLSPlaylist(options: {
  plan: HLSDownloadPlan
  initFileName?: string
  segmentFileNames: string[]
}): string {
  const maxDuration = Math.max(1, ...options.plan.segments.map((segment) => Math.ceil(segment.duration || 0)))
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${maxDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ]
  if (options.initFileName) {
    lines.push(`#EXT-X-MAP:URI="${hlsPlaylistURI(options.initFileName)}"`)
  }
  for (let index = 0; index < options.plan.segments.length; index++) {
    const duration = options.plan.segments[index].duration || maxDuration
    lines.push(`#EXTINF:${duration.toFixed(6)},`)
    lines.push(hlsPlaylistURI(options.segmentFileNames[index]))
  }
  lines.push("#EXT-X-ENDLIST")
  return lines.join("\n")
}

const HLS_MAX_CONCURRENCY = 5

async function fetchSegmentToFile(options: {
  url: string
  filePath: string
  headers: Record<string, string>
  debugLabel: string
  isCancelled?: () => boolean
}): Promise<number> {
  if (options.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) {
    throw new Error("下载已取消")
  }

  await removeIfExists(options.filePath)
  registerCurrentTaskPath(options.filePath)

  const response = await fetch(options.url, {
    method: "GET",
    timeout: 120,
    debugLabel: options.debugLabel,
    headers: {
      ...options.headers,
      Accept: "*/*",
    },
  })

  if (!response.ok) {
    throw new Error(`segment download failed: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  try {
    while (true) {
      if (options.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) {
        await reader.cancel("cancelled")
        throw new Error("下载已取消")
      }
      const { done, value } = await reader.read()
      if (done) break
      if (value != null) {
        const data = Data.fromUint8Array(value)
        if (data) FileManager.appendDataSync(options.filePath, data)
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }

  const written = fileSize(options.filePath)
  if (written <= 0) {
    throw new Error(`segment ${options.debugLabel} downloaded 0 bytes`)
  }

  return written
}

async function downloadHLSPlanAsLocalPlaylist(options: {
  plan: HLSDownloadPlan
  directory: string
  playlistFileName: string
  prefix: string
  label: string
  start: number
  end: number
  onProgress?: DownloadProgressFn
  isCancelled?: () => boolean
}): Promise<{ playlistPath: string; bytesWritten: number; segmentCount: number }> {
  const headers = {
    "User-Agent": MOBILE_SAFARI_UA,
    Referer: options.plan.playlistURL,
  }

  const totalUnits = options.plan.segments.length + (options.plan.initMapURL ? 1 : 0)
  let completedUnits = 0
  let bytesWritten = 0

  const reportProgress = () => {
    const fraction = totalUnits > 0
      ? options.start + (options.end - options.start) * (completedUnits / totalUnits)
      : options.start
    options.onProgress?.({
      fraction,
      stage: `${options.label} ${completedUnits}/${totalUnits} · ${formatBytes(bytesWritten)}`,
    })
  }

  reportProgress()

  // Download init segment first (must complete before regular segments)
  let initFileName: string | undefined
  if (options.plan.initMapURL) {
    initFileName = `${options.prefix}_init${segmentExtension(options.plan.initMapURL)}`
    const bytes = await fetchSegmentToFile({
      url: options.plan.initMapURL,
      filePath: Path.join(options.directory, initFileName),
      headers,
      debugLabel: `${options.label}-init`,
      isCancelled: options.isCancelled,
    })
    bytesWritten += bytes
    completedUnits += 1
    reportProgress()
  }

  // Pre-compute segment file names
  const segmentFileNames: string[] = []
  for (let i = 0; i < options.plan.segments.length; i++) {
    segmentFileNames.push(
      `${options.prefix}_${String(i).padStart(5, "0")}${segmentExtension(options.plan.segments[i].url)}`
    )
  }

  // Download segments with up to 5 concurrent fetch workers
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      if (options.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) {
        throw new Error("下载已取消")
      }
      const index = nextIndex
      if (index >= options.plan.segments.length) break
      nextIndex += 1

      const segment = options.plan.segments[index]
      const bytes = await fetchSegmentToFile({
        url: segment.url,
        filePath: Path.join(options.directory, segmentFileNames[index]),
        headers,
        debugLabel: `${options.label}-seg-${index}`,
        isCancelled: options.isCancelled,
      })
      bytesWritten += bytes
      completedUnits += 1
      reportProgress()
    }
  }

  const workerCount = Math.min(HLS_MAX_CONCURRENCY, options.plan.segments.length)
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  }

  // Build local m3u8 playlist pointing to downloaded segment files
  const playlistPath = Path.join(options.directory, options.playlistFileName)
  FileManager.writeAsStringSync(playlistPath, buildLocalHLSPlaylist({
    plan: options.plan,
    initFileName,
    segmentFileNames,
  }))
  registerCurrentTaskPath(playlistPath)

  return { playlistPath, bytesWritten, segmentCount: options.plan.segments.length }
}

function hostFromURL(url: string): string {
  const match = url.match(/^https?:\/\/([^/?#]+)/i)
  return (match?.[1] || "").toLowerCase().replace(/^www\./, "")
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function isHttpURL(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isDouyinURL(url: string): boolean {
  const host = hostFromURL(url)
  return hostMatches(host, [
    "douyin.com",
    "iesdouyin.com",
    "amemv.com",
    "snssdk.com",
  ])
}

function isYouTubeURL(url: string): boolean {
  const host = hostFromURL(url)
  return hostMatches(host, ["youtube.com", "youtu.be", "youtube-nocookie.com"])
}

function platformLabel(url: string): string {
  const host = hostFromURL(url)
  if (isYouTubeURL(url)) return "YouTube"
  if (hostMatches(host, ["x.com", "twitter.com"])) return "X/Twitter"
  if (hostMatches(host, ["instagram.com"])) return "Instagram"
  if (hostMatches(host, ["threads.net"])) return "Threads"
  if (hostMatches(host, ["tiktok.com"])) return "TikTok"
  if (hostMatches(host, ["vimeo.com"])) return "Vimeo"
  if (hostMatches(host, ["twitch.tv"])) return "Twitch"
  if (hostMatches(host, ["reddit.com"])) return "Reddit"
  if (hostMatches(host, ["facebook.com", "fb.watch"])) return "Facebook"
  return host || "Generic"
}

export function detectMediaDownloadKind(url: string): MediaDownloadKind {
  const lower = url.toLowerCase()
  if (lower.includes(".m3u8") || lower.includes("application/x-mpegurl")) return "m3u8"
  if (isYouTubeURL(url)) return "youtube"
  if (isDouyinURL(url)) return "douyin"
  if (isHttpURL(url)) return "generic"
  return "douyin"
}

const YTDLP_VERSION_COMMANDS = [
  "python3 -m yt_dlp --version",
  commandLine([
    "python3",
    "-c",
    "from yt_dlp.version import __version__; print(__version__)",
  ]),
  commandLine([
    "python3",
    "-c",
    "import importlib.metadata as m; print(m.version('yt-dlp'))",
  ]),
]

async function runShellWithTimeout(command: string, options: { timeout: number }): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Shell.run(command, options),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({
          exitCode: 124,
          output: `Timed out after ${options.timeout}s`,
        }), options.timeout * 1000 + 1000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function isYtDlpAvailable(): Promise<boolean> {
  return (await getYtDlpVersion()) != null
}

export async function getYtDlpVersion(): Promise<string | null> {
  for (const command of YTDLP_VERSION_COMMANDS) {
    const result = await runShellWithTimeout(command, { timeout: 20 })
    if (result.exitCode === 0) {
      const version = result.output.trim().split(/\s+/)[0]
      if (version) return version
    }
  }
  return null
}

export async function installOrUpdateYtDlp(): Promise<string> {
  await ensureDownloadDirectories()
  const result = await Shell.run(
    commandLine(["python3", "-m", "pip", "install", "--upgrade", "yt-dlp"]),
    { timeout: 900 }
  )
  if (result.exitCode !== 0) {
    throw new Error(compactLog(result.output || `pip exited with code ${result.exitCode}`))
  }
  return compactLog(result.output || "yt-dlp updated")
}

async function ensureTempDirectory() {
  if (!(await FileManager.exists(TEMP_DIR))) {
    await FileManager.createDirectory(TEMP_DIR, true)
  }
}

export async function clearDownloadCancelFlag() {
  await ensureTempDirectory()
  try {
    if (FileManager.existsSync(CANCEL_FLAG_PATH)) FileManager.removeSync(CANCEL_FLAG_PATH)
  } catch {}
}

export async function requestDownloadCancel() {
  await ensureTempDirectory()
  FileManager.writeAsStringSync(CANCEL_FLAG_PATH, String(Date.now()))
  clearYtDlpProgress()
  cancelBackgroundDownloads()
}

function throwIfCancelled() {
  if (FileManager.existsSync(CANCEL_FLAG_PATH)) {
    throw new Error("下载已取消")
  }
}

function writeYtDlpConfig(url: string, format: string, outputTemplate: string, paths: string, noCheckCertificate = false, httpHeaders?: Record<string, string>, cookieFilePath?: string): string {
  ytdlpConfigCounter += 1
  const configPath = Path.join(TEMP_DIR, `ytdlp-${Date.now()}-${ytdlpConfigCounter}.json`)
  FileManager.writeAsStringSync(configPath, JSON.stringify({
    url,
    format,
    format_sort: YTDLP_FORMAT_SORT,
    output: outputTemplate,
    paths,
    cancel_flag: CANCEL_FLAG_PATH,
    progress_path: YTDLP_PROGRESS_PATH,
    no_check_certificate: noCheckCertificate,
    http_headers: httpHeaders,
    cookiefile: cookieFilePath,
  }))
  return configPath
}

function buildYtDlpRunnerArgs(url: string, format: string, outputTemplate: string, paths: string, noCheckCertificate = false, httpHeaders?: Record<string, string>, cookieFilePath?: string): string[] {
  const configPath = writeYtDlpConfig(url, format, outputTemplate, paths, noCheckCertificate, httpHeaders, cookieFilePath)
  return ["python3", YTDLP_RUNNER_PATH, configPath]
}

function buildYtDlpProbeArgs(url: string, noCheckCertificate = false, httpHeaders?: Record<string, string>, cookieFilePath?: string): string[] {
  ytdlpConfigCounter += 1
  const configPath = Path.join(TEMP_DIR, `ytdlp-probe-${Date.now()}-${ytdlpConfigCounter}.json`)
  FileManager.writeAsStringSync(configPath, JSON.stringify({
    mode: "probe",
    url,
    format_sort: YTDLP_FORMAT_SORT,
    cancel_flag: CANCEL_FLAG_PATH,
    no_check_certificate: noCheckCertificate,
    http_headers: httpHeaders,
    cookiefile: cookieFilePath,
  }))
  return ["python3", YTDLP_RUNNER_PATH, configPath]
}

function clearYtDlpProgress() {
  try {
    if (FileManager.existsSync(YTDLP_PROGRESS_PATH)) FileManager.removeSync(YTDLP_PROGRESS_PATH)
  } catch {}
}

function readYtDlpProgress(): YtDlpProgress | null {
  try {
    if (!FileManager.existsSync(YTDLP_PROGRESS_PATH)) return null
    return JSON.parse(FileManager.readAsStringSync(YTDLP_PROGRESS_PATH)) as YtDlpProgress
  } catch {
    return null
  }
}

function formatEta(seconds?: number | null): string | null {
  if (seconds == null || seconds < 0 || !Number.isFinite(seconds)) return null
  const totalSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  return `${minutes}:${String(secs).padStart(2, "0")}`
}

function startYtDlpProgressPolling(options: {
  start: number
  end: number
  stage: string
  onProgress?: DownloadProgressFn
}) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const tick = () => {
    if (stopped) return
    const progress = readYtDlpProgress()
    if (progress) {
      const percent = progress.percent ?? null
      const inner = percent != null
        ? Math.max(0, Math.min(1, percent / 100))
        : progress.downloadedBytes
          ? Math.max(0.02, Math.min(0.96, Math.log2(progress.downloadedBytes / (1024 * 1024) + 1) / 8))
          : 0
      const fraction = options.start + (options.end - options.start) * inner
      const downloaded = progress.downloadedBytes ? formatBytes(progress.downloadedBytes) : null
      const total = progress.totalBytes ? formatBytes(progress.totalBytes) : null
      const speed = progress.speed ? `${formatBytes(progress.speed)}/s` : null
      const eta = formatEta(progress.eta)
      const fragments = progress.fragmentIndex && progress.fragmentCount
        ? `frag ${progress.fragmentIndex}/${progress.fragmentCount}`
        : null
      const percentText = percent != null ? `${percent.toFixed(1)}%` : null
      const detail = [
        percentText,
        downloaded && total ? `${downloaded} / ${total}` : downloaded,
        speed,
        eta ? `ETA ${eta}` : null,
        fragments,
      ].filter(Boolean).join(" · ")
      options.onProgress?.({
        fraction,
        stage: detail ? `${options.stage} · ${detail}` : options.stage,
      })
    }
    timer = setTimeout(tick, 500)
  }
  timer = setTimeout(tick, 100)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

function formatSize(format: YtDlpFormat): number {
  return format.filesize || format.filesize_approx || 0
}

function hasVideo(format: YtDlpFormat): boolean {
  if (format.vcodec === "none") return false
  return Boolean(format.vcodec || format.height || format.width)
}

function hasAudio(format: YtDlpFormat): boolean {
  if (format.acodec === "none") return false
  const note = (format.format_note || "").toLowerCase()
  return Boolean(format.acodec || format.abr || note.includes("audio"))
}

function isProgressive(format: YtDlpFormat): boolean {
  if (!hasVideo(format)) return false
  if (hasAudio(format)) return true
  const protocol = (format.protocol || "").toLowerCase()
  const ext = (format.ext || "").toLowerCase()
  return protocol === "https" && ext === "mp4" && format.acodec !== "none"
}

function videoScore(format: YtDlpFormat): number {
  let score = (format.height || 0) * 1_000_000 + (format.tbr || 0)
  const ext = (format.ext || "").toLowerCase()
  const vcodec = (format.vcodec || "").toLowerCase()
  const acodec = (format.acodec || "").toLowerCase()
  if (ext === "mp4") score += 100_000_000
  if (vcodec.startsWith("avc") || vcodec.startsWith("h264")) score += 50_000_000
  if (acodec.startsWith("mp4a") || acodec.startsWith("aac")) score += 10_000_000
  return score
}

function audioScore(format: YtDlpFormat): number {
  let score = format.abr || format.tbr || 0
  const ext = (format.ext || "").toLowerCase()
  const acodec = (format.acodec || "").toLowerCase()
  if (ext === "m4a" || ext === "mp4") score += 10_000
  if (acodec.startsWith("mp4a") || acodec.startsWith("aac")) score += 5_000
  return score
}

function buildYtDlpChoice(probe: YtDlpProbe): GenericDownloadChoice {
  const formats = probe.formats.filter((format) => format.format_id)
  const progressive = formats
    .filter(isProgressive)
    .sort((a, b) => videoScore(b) - videoScore(a))[0]
  const video = formats
    .filter((format) => hasVideo(format) && !hasAudio(format))
    .sort((a, b) => videoScore(b) - videoScore(a))[0]
  const audio = formats
    .filter((format) => hasAudio(format) && !hasVideo(format))
    .sort((a, b) => audioScore(b) - audioScore(a))[0]

  if (video && audio) {
    const height = video.height ? `${video.height}p` : "best video"
    const size = formatSize(video) + formatSize(audio)
    return {
      kind: "adaptive",
      video,
      audio,
      label: size > 0 ? `${height} + audio · ~${formatBytes(size)}` : `${height} + audio`,
    }
  }

  if (progressive) {
    const height = progressive.height ? `${progressive.height}p` : "best"
    const size = formatSize(progressive)
    return {
      kind: "progressive",
      format: progressive,
      label: size > 0 ? `${height} · ~${formatBytes(size)}` : height,
    }
  }

  throw new Error("yt-dlp 未返回可下载的视频格式")
}

async function probeYtDlpMedia(url: string, options: {
  onProgress?: DownloadProgressFn
  onLog?: DownloadLogFn
  platform: string
}): Promise<YtDlpProbeResult> {
  options.onProgress?.({ fraction: 0.12, stage: `正在读取 ${options.platform} 媒体信息` })
  options.onLog?.(`正在读取 ${options.platform} 媒体信息。`)
  let noCheckCertificate = false
  let effectiveURL = url
  let httpHeaders: Record<string, string> | undefined
  const cookieFilePath = await writeYtDlpCookieFileForURL(effectiveURL, options.onLog)
  let result = await Shell.run(commandLine(buildYtDlpProbeArgs(effectiveURL, false, undefined, cookieFilePath)), { timeout: 180 })
  logShellResult(options.onLog, `yt-dlp ${options.platform} probe`, result)
  if (result.exitCode !== 0 && isCertificateVerifyFailure(result.output)) {
    noCheckCertificate = true
    options.onLog?.("检测到 SSL 证书校验失败，使用 nocheckcertificate 自动重试一次。")
    options.onProgress?.({ fraction: 0.14, stage: `正在重试 ${options.platform} 媒体信息` })
    result = await Shell.run(commandLine(buildYtDlpProbeArgs(effectiveURL, true, undefined, cookieFilePath)), { timeout: 180 })
    logShellResult(options.onLog, `yt-dlp ${options.platform} probe nocheckcertificate`, result)
  }
  if (result.exitCode !== 0 && options.platform === "Instagram" && isInstagramEmptyMediaResponse(result.output)) {
    effectiveURL = normalizeInstagramURL(url)
    httpHeaders = instagramBrowserHeaders(effectiveURL)
    options.onLog?.(`Instagram 返回空媒体数据，去除分享参数并使用浏览器 UA 重试：${effectiveURL}`)
    options.onProgress?.({ fraction: 0.16, stage: "正在重试 Instagram 媒体信息" })
    result = await Shell.run(commandLine(buildYtDlpProbeArgs(effectiveURL, noCheckCertificate, httpHeaders, cookieFilePath)), { timeout: 180 })
    logShellResult(options.onLog, "yt-dlp Instagram probe browser headers", result)
  }
  if (result.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
    throw new Error("下载已取消")
  }
  if (result.exitCode !== 0) {
    if (options.platform === "Instagram" && isInstagramEmptyMediaResponse(result.output)) {
      throw new Error("Instagram 返回空媒体数据。该内容在 yt-dlp 匿名访问下不可用，可能需要登录 cookies，或 Instagram 对当前网络/设备触发了风控。")
    }
    throw new Error(`yt-dlp 媒体信息读取失败：${compactLog(result.output || `exit code ${result.exitCode}`)}`)
  }
  const probe = extractYtDlpProbe(result.output)
  if (!probe) {
    throw new Error("yt-dlp 未返回媒体信息")
  }
  options.onLog?.(`yt-dlp 媒体信息：extractor=${probe.extractor_key || "unknown"}，title=${probe.title || "unknown"}，formats=${probe.formats.length}`)
  return { probe, noCheckCertificate, url: effectiveURL, httpHeaders, cookieFilePath }
}

async function verifyOutputFile(path: string, log?: DownloadLogFn) {
  const bytes = fileSize(path)
  if (!bytes) throw new Error("输出文件为空")
  const result = await Shell.run(
    commandLine(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path]),
    { timeout: 60 }
  )
  if (result.exitCode === 0 && result.output.trim()) {
    log?.(`ffprobe 验证通过：${Path.basename(path)}`)
  } else {
    log?.(`ffprobe 验证未通过，保留文件但请检查兼容性：${compactLog(result.output || `exit code ${result.exitCode}`, 500)}`)
  }
}

async function removeIfExists(path: string | null | undefined) {
  if (!path) return
  try {
    if (FileManager.existsSync(path)) FileManager.removeSync(path)
  } catch {}
}

export async function cleanupCurrentDownloadFiles() {
  for (const path of Array.from(currentTaskPaths)) {
    await removeIfExists(path)
  }
  currentTaskPaths.clear()

  try {
    if (FileManager.existsSync(TEMP_DIR)) {
      for (const entry of FileManager.readDirectorySync(TEMP_DIR, true)) {
        const path = Path.isAbsolute(entry) ? entry : Path.join(TEMP_DIR, entry)
        await removeIfExists(path)
      }
    }
  } catch {}
}

async function cleanupTempDirectory() {
  await ensureTempDirectory()
  try {
    for (const entry of FileManager.readDirectorySync(TEMP_DIR, true)) {
      const path = Path.isAbsolute(entry) ? entry : Path.join(TEMP_DIR, entry)
      await removeIfExists(path)
    }
  } catch {}
}

async function runYtDlpDownloadWithProgress(options: {
  args: string[]
  start: number
  end: number
  stage: string
  onProgress?: DownloadProgressFn
  onLog?: DownloadLogFn
  debugLabel: string
}): Promise<ShellExecutionResult> {
  clearYtDlpProgress()
  const stopPolling = startYtDlpProgressPolling({
    start: options.start,
    end: options.end,
    stage: options.stage,
    onProgress: options.onProgress,
  })
  try {
    const result = await Shell.run(commandLine(options.args), { timeout: 7200 })
    logShellResult(options.onLog, options.debugLabel, result)
    return result
  } finally {
    stopPolling()
    clearYtDlpProgress()
  }
}

async function ensureYtDlpReadyForDownload(options: {
  ytDlpReady?: boolean | null
  onProgress?: DownloadProgressFn
  onLog?: DownloadLogFn
  onYtDlpStatus?: (ready: boolean, version: string | null) => void
}) {
  if (options.ytDlpReady === true) {
    options.onProgress?.({ fraction: 0.06, stage: "正在准备 yt-dlp 下载" })
    return
  }

  options.onProgress?.({ fraction: 0.04, stage: "正在检查 yt-dlp" })
  const version = await getYtDlpVersion()
  if (version) {
    options.onYtDlpStatus?.(true, version)
    return
  }

  options.onYtDlpStatus?.(false, null)
  options.onProgress?.({ fraction: 0.08, stage: "正在安装 yt-dlp" })
  options.onLog?.("未检测到 yt-dlp，开始自动安装。")
  await installOrUpdateYtDlp()
  options.onYtDlpStatus?.(true, await getYtDlpVersion())
}

function metadataTitle(metadata: MediaMetadata | null | undefined, fallback: string): string {
  return metadata?.title || fallback
}

function outputStemFromMetadata(metadata: MediaMetadata | null | undefined, fallback: string): string {
  const title = sanitizeFileName(metadataTitle(metadata, fallback)).slice(0, 120) || fallback
  const id = metadata?.id ? ` [${sanitizeFileName(metadata.id)}]` : ""
  return `${title}${id}`
}

async function mergeAdaptiveMedia(options: {
  videoPath: string
  audioPath: string
  finalPath: string
  onProgress?: DownloadProgressFn
  onLog?: DownloadLogFn
  isCancelled?: () => boolean
}): Promise<ShellExecutionResult> {
  options.onProgress?.({ fraction: 0.84, stage: "正在通过 ffmpeg 合并音视频" })
  options.onLog?.("开始用 ffmpeg 合并音视频。")
  const copyResult = await Shell.run(
    commandLine(["ffmpeg", "-nostdin", "-y", "-i", options.videoPath, "-i", options.audioPath, "-c", "copy", "-movflags", "+faststart", options.finalPath]),
    { timeout: 1800 }
  )
  logShellResult(options.onLog, "ffmpeg stream-copy merge", copyResult)
  if (copyResult.exitCode === 0 && FileManager.existsSync(options.finalPath)) {
    return copyResult
  }
  if (FileManager.existsSync(CANCEL_FLAG_PATH) || options.isCancelled?.()) return copyResult

  await removeIfExists(options.finalPath)
  options.onProgress?.({ fraction: 0.88, stage: "正在转码为兼容 MP4" })
  options.onLog?.(`无损合并失败，转码为兼容 MP4：${compactLog(copyResult.output, 700)}`)
  const transcodeResult = await Shell.run(
    commandLine([
      "ffmpeg",
      "-nostdin",
      "-y",
      "-i",
      options.videoPath,
      "-i",
      options.audioPath,
      "-c:v",
      "h264_videotoolbox",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      options.finalPath,
    ]),
    { timeout: 7200 }
  )
  logShellResult(options.onLog, "ffmpeg compatible transcode", transcodeResult)
  return {
    exitCode: transcodeResult.exitCode,
    output: `${copyResult.output}\n${transcodeResult.output}`,
    timedOut: Boolean(transcodeResult.timedOut),
    cancelled: Boolean(transcodeResult.cancelled),
  }
}

async function downloadGenericMedia(
  sourceURL: string,
  options?: {
    platform?: string
    onProgress?: DownloadProgressFn
    onLog?: DownloadLogFn
    isCancelled?: () => boolean
    ytDlpReady?: boolean | null
    onYtDlpStatus?: (ready: boolean, version: string | null) => void
  }
): Promise<DownloadSuccess> {
  const platform = options?.platform || platformLabel(sourceURL)
  const report = (fraction: number, stage: string) => options?.onProgress?.({ fraction, stage })
  const log = (message: string) => options?.onLog?.(message)

  log(`识别为 ${platform} 链接，切换到通用 yt-dlp 下载器。`)
  await clearDownloadCancelFlag()
  await ensureDownloadDirectories()
  await ensureTempDirectory()
  await cleanupTempDirectory()
  await ensureYtDlpReadyForDownload({
    ytDlpReady: options?.ytDlpReady,
    onProgress: options?.onProgress,
    onLog: options?.onLog,
    onYtDlpStatus: options?.onYtDlpStatus,
  })

  throwIfCancelled()
  const probeResult = await probeYtDlpMedia(sourceURL, {
    platform,
    onProgress: options?.onProgress,
    onLog: options?.onLog,
  })
  const { probe, noCheckCertificate } = probeResult
  const downloadURL = probeResult.url
  const httpHeaders = probeResult.httpHeaders
  const cookieFilePath = probeResult.cookieFilePath
  if (noCheckCertificate) {
    log("本次 yt-dlp 下载将继续使用 nocheckcertificate。")
  }
  if (downloadURL !== sourceURL) {
    log(`yt-dlp 下载使用规范化链接：${downloadURL}`)
  }
  const choice = buildYtDlpChoice(probe)
  log(`已选择 yt-dlp 格式：${choice.label}`)
  if (choice.kind === "progressive") {
    log(`yt-dlp progressive 格式详情：${describeFormat(choice.format)}`)
  } else {
    log(`yt-dlp 视频格式详情：${describeFormat(choice.video)}`)
    log(`yt-dlp 音频格式详情：${describeFormat(choice.audio)}`)
  }

  let result: ShellDownloadResult
  if (choice.kind === "progressive") {
    report(0.2, `正在下载 ${platform} 视频`)
    const raw = await runYtDlpDownloadWithProgress({
      args: buildYtDlpRunnerArgs(
        downloadURL,
        choice.format.format_id,
        "%(title).120B [%(id)s].%(ext)s",
        DOWNLOAD_DIR,
        noCheckCertificate,
        httpHeaders,
        cookieFilePath
      ),
      start: 0.2,
      end: 0.94,
      stage: `正在下载 ${platform} 视频`,
      onProgress: options?.onProgress,
      onLog: options?.onLog,
      debugLabel: `yt-dlp ${platform} progressive`,
    })
    result = {
      exitCode: raw.exitCode,
      output: raw.output,
      paths: extractDownloadedPaths(raw.output).filter((path) => FileManager.existsSync(path)),
      metadata: extractYtDlpMetadata(raw.output) || probe,
    }
  } else {
    report(0.2, `正在下载 ${platform} 视频流`)
    const videoRaw = await runYtDlpDownloadWithProgress({
      args: buildYtDlpRunnerArgs(
        downloadURL,
        choice.video.format_id,
        "%(title).120B [%(id)s].video.%(ext)s",
        TEMP_DIR,
        noCheckCertificate,
        httpHeaders,
        cookieFilePath
      ),
      start: 0.2,
      end: 0.54,
      stage: `正在下载 ${platform} 视频流`,
      onProgress: options?.onProgress,
      onLog: options?.onLog,
      debugLabel: `yt-dlp ${platform} video stream`,
    })
    if (videoRaw.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) throw new Error("下载已取消")
    const videoPath = extractDownloadedPaths(videoRaw.output).find((path) => FileManager.existsSync(path))
    if (videoRaw.exitCode !== 0 || !videoPath) {
      throw new Error(`yt-dlp 视频流下载失败：${compactLog(videoRaw.output || `exit code ${videoRaw.exitCode}`)}`)
    }
    registerCurrentTaskPath(videoPath)

    report(0.56, `正在下载 ${platform} 音频流`)
    const audioRaw = await runYtDlpDownloadWithProgress({
      args: buildYtDlpRunnerArgs(
        downloadURL,
        choice.audio.format_id,
        "%(title).120B [%(id)s].audio.%(ext)s",
        TEMP_DIR,
        noCheckCertificate,
        httpHeaders,
        cookieFilePath
      ),
      start: 0.56,
      end: 0.78,
      stage: `正在下载 ${platform} 音频流`,
      onProgress: options?.onProgress,
      onLog: options?.onLog,
      debugLabel: `yt-dlp ${platform} audio stream`,
    })
    if (audioRaw.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
      await removeIfExists(videoPath)
      throw new Error("下载已取消")
    }
    const audioPath = extractDownloadedPaths(audioRaw.output).find((path) => FileManager.existsSync(path))
    if (audioRaw.exitCode !== 0 || !audioPath) {
      await removeIfExists(videoPath)
      throw new Error(`yt-dlp 音频流下载失败：${compactLog(audioRaw.output || `exit code ${audioRaw.exitCode}`)}`)
    }
    registerCurrentTaskPath(audioPath)

    const finalPath = uniqueFilePath(DOWNLOAD_DIR, `${outputStemFromMetadata(probe, `${platform}_video`)}.mp4`)
    registerCurrentTaskPath(finalPath)
    const mergeResult = await mergeAdaptiveMedia({
      videoPath,
      audioPath,
      finalPath,
      onProgress: options?.onProgress,
      onLog: options?.onLog,
      isCancelled: options?.isCancelled,
    })
    await removeIfExists(videoPath)
    await removeIfExists(audioPath)
    if (mergeResult.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
      await removeIfExists(finalPath)
      throw new Error("下载已取消")
    }
    result = {
      exitCode: mergeResult.exitCode,
      output: `${videoRaw.output}\n${audioRaw.output}\n${mergeResult.output}`,
      paths: mergeResult.exitCode === 0 && FileManager.existsSync(finalPath) ? [finalPath] : [],
      metadata: extractYtDlpMetadata(videoRaw.output) || extractYtDlpMetadata(audioRaw.output) || probe,
    }
  }

  if (result.exitCode !== 0 || !result.paths.length) {
    throw new Error(`yt-dlp 下载失败：${compactLog(result.output || `exit code ${result.exitCode}`)}`)
  }

  const filePath = result.paths[result.paths.length - 1]
  await verifyOutputFile(filePath, log)
  const fileName = Path.basename(filePath)
  const bytesWritten = fileSize(filePath)
  if (!bytesWritten) throw new Error("yt-dlp 输出文件为空")
  const metadata = result.metadata || probe
  const title = metadataTitle(metadata, Path.basename(fileName, Path.extname(fileName)))
  const pageURL = metadata?.webpage_url || sourceURL

  report(1, `下载完成：${fileName}`)
  log(`${platform} 下载完成：${fileName}，大小 ${formatBytes(bytesWritten)}`)

  return {
    id: UUID.string(),
    sourceURL,
    filePath,
    fileName,
    files: [{
      filePath,
      fileName,
      finalURL: sourceURL,
      bytesWritten,
      mediaType: "video",
    }],
    mediaType: "video",
    extracted: {
      pageURL,
      canonical: pageURL,
      title,
      description: metadata?.description || null,
      thumbnailURL: metadata?.thumbnail || null,
      imageURLs: [],
      videoSrc: null,
      apiDetailJSON: null,
      routerDataJSON: null,
      videoInfoResJSON: null,
      bodyTextPreview: "",
      resourceHints: [],
      performanceMedia: [],
    },
    finalURL: sourceURL,
    bytesWritten,
    createdAt: new Date().toISOString(),
    matchedCandidateLabel: `yt_dlp_${choice.kind}_${platform.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  }
}

async function downloadYouTube(
  sourceURL: string,
  options?: {
    onProgress?: DownloadProgressFn
    onLog?: DownloadLogFn
    isCancelled?: () => boolean
    ytDlpReady?: boolean | null
    onYtDlpStatus?: (ready: boolean, version: string | null) => void
  }
): Promise<DownloadSuccess> {
  return downloadGenericMedia(sourceURL, {
    ...options,
    platform: "YouTube",
  })
}

async function downloadM3U8(
  sourceURL: string,
  options?: {
    onProgress?: DownloadProgressFn
    onLog?: DownloadLogFn
    isCancelled?: () => boolean
  }
): Promise<DownloadSuccess> {
  const report = (fraction: number, stage: string) => options?.onProgress?.({ fraction, stage })
  const log = (message: string) => options?.onLog?.(message)
  await ensureDownloadDirectories()
  await ensureTempDirectory()

  const fileName = `${sanitizeFileName("m3u8_video")}_${Date.now()}.mp4`
  const filePath = uniqueFilePath(DOWNLOAD_DIR, fileName)
  registerCurrentTaskPath(filePath)
  const selection = await resolveBestM3U8Selection(sourceURL, log)
  const inputURL = selection.videoURL

  report(0.1, "正在解析 m3u8 分片列表")
  log("识别为 m3u8 链接，开始解析分片列表。")
  try {
    const videoPlaylistText = await fetchM3U8Text(selection.videoURL)
    const videoPlan = parseHLSMediaPlaylist(selection.videoURL, videoPlaylistText)
    let audioPlan: HLSDownloadPlan | null = null
    if (selection.audioURL) {
      const audioPlaylistText = await fetchM3U8Text(selection.audioURL)
      audioPlan = parseHLSMediaPlaylist(selection.audioURL, audioPlaylistText)
    }

    const canDownloadVideo = !videoPlan.unsupportedReason && videoPlan.segments.length > 0
    const canDownloadAudio = !audioPlan || (!audioPlan.unsupportedReason && audioPlan.segments.length > 0)

    if (canDownloadVideo && canDownloadAudio) {
      const segmentDir = Path.join(TEMP_DIR, `m3u8-${Date.now()}`)
      FileManager.createDirectorySync(segmentDir, true)
      registerCurrentTaskPath(segmentDir)

      if (options?.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) {
        await removeIfExists(segmentDir)
        throw new Error("下载已取消")
      }

      const videoDownload = await downloadHLSPlanAsLocalPlaylist({
        plan: videoPlan,
        directory: segmentDir,
        playlistFileName: "video_local.m3u8",
        prefix: "video",
        label: "正在下载 m3u8 视频分片",
        start: 0.14,
        end: audioPlan ? 0.56 : 0.78,
        onProgress: options?.onProgress,
        isCancelled: options?.isCancelled,
      })

      let audioInputPath: string | null = null
      let audioDownload: { playlistPath: string; bytesWritten: number; segmentCount: number } | null = null
      if (audioPlan) {
        audioDownload = await downloadHLSPlanAsLocalPlaylist({
          plan: audioPlan,
          directory: segmentDir,
          playlistFileName: "audio_local.m3u8",
          prefix: "audio",
          label: "正在下载 m3u8 音频分片",
          start: 0.58,
          end: 0.78,
          onProgress: options?.onProgress,
          isCancelled: options?.isCancelled,
        })
        audioInputPath = audioDownload.playlistPath
      }

      report(0.84, "正在通过 ffmpeg 合并 m3u8 分片")
      const downloadedBytes = videoDownload.bytesWritten + (audioDownload?.bytesWritten || 0)
      const downloadedSegments = videoDownload.segmentCount + (audioDownload?.segmentCount || 0)
      log(`m3u8 分片下载完成：${downloadedSegments} 个分片，累计 ${formatBytes(downloadedBytes)}。`)
      const ffmpegArgs = audioInputPath
        ? ["ffmpeg", "-nostdin", "-y", "-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-allowed_extensions", "ALL", "-i", videoDownload.playlistPath, "-i", audioInputPath, "-c", "copy", "-movflags", "+faststart", filePath]
        : ["ffmpeg", "-nostdin", "-y", "-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-allowed_extensions", "ALL", "-i", videoDownload.playlistPath, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", filePath]
      const concatResult = await Shell.run(
        commandLine(ffmpegArgs),
        { timeout: 900 }
      )
      logShellResult(log, "ffmpeg m3u8 segment merge", concatResult)
      await removeIfExists(segmentDir)

      if (concatResult.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
        await removeIfExists(filePath)
        throw new Error("下载已取消")
      }
      if (concatResult.exitCode !== 0 || !FileManager.existsSync(filePath)) {
        await removeIfExists(filePath)
        throw new Error(`ffmpeg 合并 m3u8 分片失败：${compactLog(concatResult.output || `exit code ${concatResult.exitCode}`)}`)
      }

      const bytesWritten = fileSize(filePath)
      if (!bytesWritten) throw new Error("ffmpeg 输出文件为空")
      report(1, `下载完成：${Path.basename(filePath)}`)
      log(`m3u8 下载完成：${Path.basename(filePath)}，大小 ${formatBytes(bytesWritten)}`)

      return {
        id: UUID.string(),
        sourceURL,
        filePath,
        fileName: Path.basename(filePath),
        files: [{
          filePath,
          fileName: Path.basename(filePath),
          finalURL: sourceURL,
          bytesWritten,
          mediaType: "video",
        }],
        mediaType: "video",
        extracted: {
          pageURL: sourceURL,
          canonical: sourceURL,
          title: "m3u8_video",
          description: null,
          thumbnailURL: null,
          imageURLs: [],
          videoSrc: sourceURL,
          apiDetailJSON: null,
          routerDataJSON: null,
          videoInfoResJSON: null,
          bodyTextPreview: "",
          resourceHints: [],
          performanceMedia: [],
        },
        finalURL: sourceURL,
        bytesWritten,
        createdAt: new Date().toISOString(),
        matchedCandidateLabel: "m3u8_segments_ffmpeg",
      }
    }
    if (videoPlan.unsupportedReason || audioPlan?.unsupportedReason) {
      log(`m3u8 列表包含复杂特性（${videoPlan.unsupportedReason || audioPlan?.unsupportedReason}），回退到 ffmpeg 直连下载。`)
    }
  } catch (error) {
    if (FileManager.existsSync(CANCEL_FLAG_PATH) || options?.isCancelled?.()) {
      await removeIfExists(filePath)
      throw new Error("下载已取消")
    }
    log(`m3u8 分片下载不可用，回退到 ffmpeg：${error instanceof Error ? error.message : String(error)}`)
  }

  report(0.12, "正在通过 ffmpeg 下载 m3u8")
  log("切换到 ffmpeg 下载器。")

  let smoothStopped = false
  let smoothTimer: ReturnType<typeof setTimeout> | null = null
  const smoothStartedAt = Date.now()
  const smoothTick = () => {
    if (smoothStopped || options?.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) return
    const elapsed = Date.now() - smoothStartedAt
    const inner = Math.min(0.95, 1 - Math.exp(-elapsed / 90000))
    const fraction = 0.12 + (0.94 - 0.12) * inner
    options?.onProgress?.({
      fraction,
      stage: `正在通过 ffmpeg 下载 m3u8 · ${Math.round(fraction * 100)}%`,
    })
    smoothTimer = setTimeout(smoothTick, 500)
  }
  smoothTimer = setTimeout(smoothTick, 500)

  const baseCommand = [
      "ffmpeg",
      "-nostdin",
      "-y",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      "-allowed_extensions",
      "ALL",
      "-user_agent",
      MOBILE_SAFARI_UA,
      "-i",
      inputURL,
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-movflags",
      "+faststart",
      filePath,
    ]
  const result = await Shell.run(
    commandLine(baseCommand),
    { timeout: 7200 }
  )
  logShellResult(log, "ffmpeg m3u8 direct download", result)

  smoothStopped = true
  if (smoothTimer) clearTimeout(smoothTimer)

  if (result.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
    await removeIfExists(filePath)
    throw new Error("下载已取消")
  }

  if (result.exitCode !== 0 || !FileManager.existsSync(filePath)) {
    throw new Error(`ffmpeg 下载 m3u8 失败：${compactLog(result.output || `exit code ${result.exitCode}`)}`)
  }

  const bytesWritten = fileSize(filePath)
  if (!bytesWritten) throw new Error("ffmpeg 输出文件为空")
  report(1, `下载完成：${Path.basename(filePath)}`)
  log(`m3u8 下载完成：${Path.basename(filePath)}，大小 ${formatBytes(bytesWritten)}`)

  return {
    id: UUID.string(),
    sourceURL,
    filePath,
    fileName: Path.basename(filePath),
    files: [{
      filePath,
      fileName: Path.basename(filePath),
      finalURL: sourceURL,
      bytesWritten,
      mediaType: "video",
    }],
    mediaType: "video",
    extracted: {
      pageURL: sourceURL,
      canonical: sourceURL,
      title: "m3u8_video",
      description: null,
      thumbnailURL: null,
      imageURLs: [],
      videoSrc: sourceURL,
      apiDetailJSON: null,
      routerDataJSON: null,
      videoInfoResJSON: null,
      bodyTextPreview: "",
      resourceHints: [],
      performanceMedia: [],
    },
    finalURL: sourceURL,
    bytesWritten,
    createdAt: new Date().toISOString(),
    matchedCandidateLabel: "m3u8_ffmpeg",
  }
}

export async function downloadMedia(
  sourceURL: string,
  options?: {
    preferNoWatermark?: boolean
    onProgress?: DownloadProgressFn
    onLog?: DownloadLogFn
    isCancelled?: () => boolean
    ytDlpReady?: boolean | null
    onYtDlpStatus?: (ready: boolean, version: string | null) => void
  }
): Promise<DownloadSuccess> {
  if (options?.isCancelled?.()) throw new Error("下载已取消")
  const kind = detectMediaDownloadKind(sourceURL)
  if (kind === "youtube") return downloadYouTube(sourceURL, options)
  if (kind === "m3u8") return downloadM3U8(sourceURL, options)
  if (kind === "generic") return downloadGenericMedia(sourceURL, options)
  return downloadDouyinVideo(sourceURL, options)
}

export { ROOT_DIR }
