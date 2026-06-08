import { Path, Script, fetch } from "scripting"
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
  metadata?: YouTubeMetadata | null
}

type ExtractedStream = {
  url?: string | null
  ext?: string | null
  format_id?: string | null
  filesize?: number | null
  filesize_approx?: number | null
  http_headers?: Record<string, string>
}

type YtDlpStreamResult = {
  exitCode: number
  output: string
  stream?: ExtractedStream | null
  metadata?: YouTubeMetadata | null
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

export type MediaDownloadKind = "douyin" | "youtube" | "m3u8"

type YouTubeMetadata = {
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
let ytdlpConfigCounter = 0
const currentTaskPaths = new Set<string>()
const currentURLSessionTasks = new Set<URLSessionDownloadTask>()

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

function extractDownloadedPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"))
    .filter((line) => [".mp4", ".m4v", ".mov", ".mkv", ".webm", ".m4a", ".aac", ".opus"].includes(Path.extname(line).toLowerCase()))
}

function extractYouTubeMetadata(output: string): YouTubeMetadata | null {
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

function extractYtDlpStream(output: string): ExtractedStream | null {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith("MEDIA_DOWNLOADER_STREAM "))
  if (!line) return null
  try {
    return JSON.parse(line.slice("MEDIA_DOWNLOADER_STREAM ".length))
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

function startSmoothM3U8UnitProgress(options: {
  rangeStart: number
  rangeEnd: number
  stage: string
  completedBytes: number
  onProgress?: DownloadProgressFn
}) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastFraction = options.rangeStart
  const startedAt = Date.now()
  const rangeWidth = Math.max(0, options.rangeEnd - options.rangeStart)
  const maxSyntheticFraction = options.rangeStart + rangeWidth * 0.92

  const tick = () => {
    if (stopped) return
    const elapsed = Date.now() - startedAt
    const inner = Math.min(0.92, 1 - Math.exp(-elapsed / 5500))
    const nextFraction = Math.min(maxSyntheticFraction, options.rangeStart + rangeWidth * inner)
    if (nextFraction > lastFraction) {
      lastFraction = nextFraction
      options.onProgress?.({
        fraction: nextFraction,
        stage: `${options.stage} · ${formatBytes(options.completedBytes)}`,
      })
    }
    timer = setTimeout(tick, 250)
  }

  timer = setTimeout(tick, 250)

  return {
    observe(fraction: number) {
      if (fraction > lastFraction) lastFraction = fraction
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
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
  let bytesWritten = 0
  const totalUnits = options.plan.segments.length + (options.plan.initMapURL ? 1 : 0)
  let completedUnits = 0
  const unitRange = (unitIndex: number) => {
    const width = totalUnits > 0 ? (options.end - options.start) / totalUnits : 0
    return {
      start: options.start + unitIndex * width,
      end: options.start + (unitIndex + 1) * width,
    }
  }
  const downloadedFileNames: string[] = []

  const downloadUnit = async (url: string, fileName: string, unitLabel: string) => {
    if (options.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) {
      throw new Error("下载已取消")
    }
    const filePath = Path.join(options.directory, fileName)
    const range = unitRange(completedUnits)
    const displayUnit = Math.min(totalUnits, completedUnits + 1)
    const stage = `${options.label} ${displayUnit}/${totalUnits}`
    const smoothProgress = startSmoothM3U8UnitProgress({
      rangeStart: range.start,
      rangeEnd: range.end,
      stage,
      completedBytes: bytesWritten,
      onProgress: options.onProgress,
    })
    try {
      await downloadURLWithProgress({
        url,
        destination: filePath,
        headers: {
          "User-Agent": MOBILE_SAFARI_UA,
          Referer: options.plan.playlistURL,
        },
        start: range.start,
        end: range.end,
        stage,
        onProgress: (progress) => {
          smoothProgress.observe(progress.fraction)
          options.onProgress?.(progress)
        },
        isCancelled: options.isCancelled,
      })
    } finally {
      smoothProgress.stop()
    }
    bytesWritten += fileSize(filePath)
    completedUnits += 1
    options.onProgress?.({
      fraction: range.end,
      stage: `${unitLabel} · ${formatBytes(bytesWritten)}`,
    })
  }

  let initFileName: string | undefined
  if (options.plan.initMapURL) {
    initFileName = `${options.prefix}_init${segmentExtension(options.plan.initMapURL)}`
    await downloadUnit(options.plan.initMapURL, initFileName, `${options.label} init`)
  }

  for (let index = 0; index < options.plan.segments.length; index++) {
    const segment = options.plan.segments[index]
    const fileName = `${options.prefix}_${String(index).padStart(5, "0")}${segmentExtension(segment.url)}`
    downloadedFileNames.push(fileName)
    await downloadUnit(segment.url, fileName, `${options.label} ${index + 1}/${options.plan.segments.length}`)
  }

  const playlistPath = Path.join(options.directory, options.playlistFileName)
  FileManager.writeAsStringSync(playlistPath, buildLocalHLSPlaylist({
    plan: options.plan,
    initFileName,
    segmentFileNames: downloadedFileNames,
  }))
  registerCurrentTaskPath(playlistPath)

  return { playlistPath, bytesWritten, segmentCount: options.plan.segments.length }
}

export function detectMediaDownloadKind(url: string): MediaDownloadKind {
  const lower = url.toLowerCase()
  if (lower.includes(".m3u8") || lower.includes("application/x-mpegurl")) return "m3u8"
  if (/(^https?:\/\/)?([^/]+\.)?(youtube\.com|youtu\.be)\//i.test(url)) return "youtube"
  return "douyin"
}

export async function isYtDlpAvailable(): Promise<boolean> {
  const result = await Shell.run("python3 -m yt_dlp --version", { timeout: 20 })
  return result.exitCode === 0
}

export async function getYtDlpVersion(): Promise<string | null> {
  const result = await Shell.run("python3 -m yt_dlp --version", { timeout: 20 })
  if (result.exitCode !== 0) return null
  return result.output.trim().split(/\s+/)[0] || null
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
  cancelBackgroundDownloads()
  for (const task of Array.from(currentURLSessionTasks)) {
    try {
      task.cancel()
    } catch {}
  }
}

function throwIfCancelled() {
  if (FileManager.existsSync(CANCEL_FLAG_PATH)) {
    throw new Error("下载已取消")
  }
}

function writeYtDlpConfig(url: string, format: string, outputTemplate: string, paths: string): string {
  ytdlpConfigCounter += 1
  const configPath = Path.join(TEMP_DIR, `ytdlp-${Date.now()}-${ytdlpConfigCounter}.json`)
  FileManager.writeAsStringSync(configPath, JSON.stringify({
    url,
    format,
    output: outputTemplate,
    paths,
    cancel_flag: CANCEL_FLAG_PATH,
  }))
  return configPath
}

function writeYtDlpExtractConfig(url: string, format: string): string {
  ytdlpConfigCounter += 1
  const configPath = Path.join(TEMP_DIR, `ytdlp-extract-${Date.now()}-${ytdlpConfigCounter}.json`)
  FileManager.writeAsStringSync(configPath, JSON.stringify({
    mode: "extract",
    url,
    format,
    cancel_flag: CANCEL_FLAG_PATH,
  }))
  return configPath
}

function buildYtDlpRunnerArgs(url: string, format: string, outputTemplate: string, paths: string): string[] {
  const configPath = writeYtDlpConfig(url, format, outputTemplate, paths)
  return ["python3", YTDLP_RUNNER_PATH, configPath]
}

function buildYtDlpExtractArgs(url: string, format: string): string[] {
  const configPath = writeYtDlpExtractConfig(url, format)
  return ["python3", YTDLP_RUNNER_PATH, configPath]
}

function baseNameWithoutExtension(path: string): string {
  const ext = Path.extname(path)
  const base = Path.basename(path)
  return ext ? base.slice(0, -ext.length) : base
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers || {})) {
    if (typeof value === "string" && value) result[key] = value
  }
  return result
}

async function extractYouTubeStream(url: string, format: string): Promise<YtDlpStreamResult> {
  const result = await Shell.run(
    commandLine(buildYtDlpExtractArgs(url, format)),
    { timeout: 120 }
  )
  return {
    exitCode: result.exitCode,
    output: result.output,
    stream: extractYtDlpStream(result.output),
    metadata: extractYouTubeMetadata(result.output),
  }
}

async function downloadURLWithProgress(options: {
  url: string
  destination: string
  headers?: Record<string, string>
  start: number
  end: number
  stage: string
  onProgress?: DownloadProgressFn
  isCancelled?: () => boolean
}): Promise<void> {
  registerCurrentTaskPath(options.destination)
  await removeIfExists(options.destination)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error | null) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    const task = BackgroundURLSession.startDownload({
      url: options.url,
      destination: options.destination,
      headers: normalizeHeaders(options.headers),
    })
    currentURLSessionTasks.add(task)
    task.onProgress = (details) => {
      if (options.isCancelled?.() || FileManager.existsSync(CANCEL_FLAG_PATH)) {
        task.cancel()
        return
      }

      const total = details.totalBytesExpectedToWrite
      const downloaded = details.totalBytesWritten
      const inner = total > 0
        ? Math.max(0, Math.min(1, downloaded / total))
        : Math.max(0.02, Math.min(0.96, Math.log2(downloaded / (1024 * 1024) + 1) / 8))
      const fraction = options.start + (options.end - options.start) * inner
      const detail = total > 0
        ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
        : formatBytes(downloaded)
      options.onProgress?.({ fraction, stage: `${options.stage} · ${detail}` })
    }
    task.onComplete = (error) => {
      currentURLSessionTasks.delete(task)
      if (FileManager.existsSync(CANCEL_FLAG_PATH) || options.isCancelled?.()) {
        finish(new Error("下载已取消"))
      } else {
        finish(error)
      }
    }
    task.resume()
  })

  if (!FileManager.existsSync(options.destination)) {
    throw new Error("下载文件未生成")
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

async function downloadSingleFileMp4(url: string, log: DownloadLogFn | undefined): Promise<ShellDownloadResult> {
  log?.("高质量音视频分流失败，回退下载单文件 mp4。")
  const result = await Shell.run(
    commandLine(buildYtDlpRunnerArgs(
      url,
      "b[ext=mp4][vcodec^=avc1]/b[ext=mp4]/best",
      "%(title).120B [%(id)s].%(ext)s",
      DOWNLOAD_DIR
    )),
    { timeout: 7200 }
  )
  return {
    exitCode: result.exitCode,
    output: result.output,
    paths: extractDownloadedPaths(result.output).filter((path) => FileManager.existsSync(path)),
    metadata: extractYouTubeMetadata(result.output),
  }
}

async function downloadSingleYouTubeStream(url: string, options: {
  onProgress?: DownloadProgressFn
  onLog?: DownloadLogFn
  isCancelled?: () => boolean
}): Promise<ShellDownloadResult> {
  const report = (fraction: number, stage: string) => options.onProgress?.({ fraction, stage })
  const log = options.onLog

  report(0.18, "正在解析 YouTube 单文件视频流")
  log?.("高质量音视频分流失败，回退解析单文件 mp4。")
  const streamResult = await extractYouTubeStream(
    url,
    "b[ext=mp4][vcodec^=avc1]/b[ext=mp4]/best"
  )
  if (streamResult.exitCode !== 0 || !streamResult.stream?.url) {
    return downloadSingleFileMp4(url, log)
  }

  const title = streamResult.metadata?.title || "youtube_video"
  const id = streamResult.metadata?.id ? ` [${streamResult.metadata.id}]` : ""
  const ext = streamResult.stream.ext || "mp4"
  const finalPath = uniqueFilePath(DOWNLOAD_DIR, `${sanitizeFileName(`${title}${id}`)}.${ext}`)
  registerCurrentTaskPath(finalPath)
  await downloadURLWithProgress({
    url: streamResult.stream.url,
    destination: finalPath,
    headers: streamResult.stream.http_headers,
    start: 0.22,
    end: 0.94,
    stage: "正在下载 YouTube 视频",
    onProgress: options.onProgress,
    isCancelled: options.isCancelled,
  })

  return {
    exitCode: FileManager.existsSync(finalPath) ? 0 : 1,
    output: streamResult.output,
    paths: FileManager.existsSync(finalPath) ? [finalPath] : [],
    metadata: streamResult.metadata,
  }
}

async function downloadHighQualityYouTube(url: string, options: {
  onProgress?: DownloadProgressFn
  onLog?: DownloadLogFn
  isCancelled?: () => boolean
}): Promise<ShellDownloadResult> {
  const report = (fraction: number, stage: string) => options.onProgress?.({ fraction, stage })
  const log = options.onLog

  await ensureDownloadDirectories()
  await ensureTempDirectory()
  await cleanupTempDirectory()

  report(0.18, "正在解析 YouTube 视频流")
  log?.("开始解析 YouTube 视频流。")
  throwIfCancelled()
  const videoResult = await extractYouTubeStream(
    url,
    "bv*[ext=mp4][vcodec^=avc1]/bestvideo[ext=mp4][vcodec^=avc1]/bv*[ext=mp4]/bestvideo[ext=mp4]"
  )
  const videoMetadata = videoResult.metadata
  if (videoResult.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
    throw new Error("下载已取消")
  }
  if (videoResult.exitCode !== 0 || !videoResult.stream?.url) {
    log?.(`YouTube 视频流下载失败：${compactLog(videoResult.output, 900)}`)
    return downloadSingleYouTubeStream(url, options)
  }

  const baseTitle = sanitizeFileName(`${videoMetadata?.title || "youtube_video"}${videoMetadata?.id ? ` [${videoMetadata.id}]` : ""}`)
  const videoExt = videoResult.stream.ext || "mp4"
  const videoPath = uniqueFilePath(TEMP_DIR, `${baseTitle}.video.${videoExt}`)
  registerCurrentTaskPath(videoPath)
  report(0.22, "正在下载 YouTube 视频流")
  log?.("开始下载 YouTube 视频流。")
  await downloadURLWithProgress({
    url: videoResult.stream.url,
    destination: videoPath,
    headers: videoResult.stream.http_headers,
    start: 0.22,
    end: 0.5,
    stage: "正在下载 YouTube 视频流",
    onProgress: options.onProgress,
    isCancelled: options.isCancelled,
  })
  throwIfCancelled()

  report(0.52, "正在解析 YouTube 音频流")
  log?.("开始解析 YouTube 音频流。")
  const audioResult = await extractYouTubeStream(url, "ba[ext=m4a]/bestaudio[ext=m4a]/bestaudio")
  const audioMetadata = audioResult.metadata
  if (audioResult.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
    await removeIfExists(videoPath)
    throw new Error("下载已取消")
  }
  if (audioResult.exitCode !== 0 || !audioResult.stream?.url) {
    await removeIfExists(videoPath)
    log?.(`YouTube 音频流下载失败：${compactLog(audioResult.output, 900)}`)
    return downloadSingleYouTubeStream(url, options)
  }

  const audioExt = audioResult.stream.ext || "m4a"
  const audioPath = uniqueFilePath(TEMP_DIR, `${baseTitle}.audio.${audioExt}`)
  registerCurrentTaskPath(audioPath)
  report(0.56, "正在下载 YouTube 音频流")
  log?.("开始下载 YouTube 音频流。")
  await downloadURLWithProgress({
    url: audioResult.stream.url,
    destination: audioPath,
    headers: audioResult.stream.http_headers,
    start: 0.56,
    end: 0.78,
    stage: "正在下载 YouTube 音频流",
    onProgress: options.onProgress,
    isCancelled: options.isCancelled,
  })
  throwIfCancelled()

  const videoStem = baseNameWithoutExtension(videoPath).replace(/\.video$/, "")
  const finalPath = uniqueFilePath(DOWNLOAD_DIR, `${videoStem}.mp4`)
  registerCurrentTaskPath(finalPath)
  report(0.82, "正在通过 ffmpeg 合并音视频")
  log?.("开始用 ffmpeg 合并 YouTube 音视频。")
  const ffmpegResult = await Shell.run(
    commandLine(["ffmpeg", "-nostdin", "-y", "-i", videoPath, "-i", audioPath, "-c", "copy", "-movflags", "+faststart", finalPath]),
    { timeout: 900 }
  )

  await removeIfExists(videoPath)
  await removeIfExists(audioPath)

  if (ffmpegResult.exitCode === 130 || FileManager.existsSync(CANCEL_FLAG_PATH)) {
    await removeIfExists(finalPath)
    throw new Error("下载已取消")
  }

  const ok = ffmpegResult.exitCode === 0 && FileManager.existsSync(finalPath)
  return {
    exitCode: ok ? 0 : ffmpegResult.exitCode || 1,
    output: `${videoResult.output}\n${audioResult.output}\n${ffmpegResult.output}`,
    paths: ok ? [finalPath] : [],
    metadata: videoMetadata || audioMetadata,
  }
}

async function downloadYouTube(
  sourceURL: string,
  options?: {
    onProgress?: DownloadProgressFn
    onLog?: DownloadLogFn
    isCancelled?: () => boolean
  }
): Promise<DownloadSuccess> {
  const report = (fraction: number, stage: string) => options?.onProgress?.({ fraction, stage })
  const log = (message: string) => options?.onLog?.(message)

  report(0.04, "正在检查 yt-dlp")
  log("识别为 YouTube 链接，切换到 yt-dlp 下载器。")
  await clearDownloadCancelFlag()
  if (!(await isYtDlpAvailable())) {
    report(0.08, "正在安装 yt-dlp")
    log("未检测到 yt-dlp，开始自动安装。")
    await installOrUpdateYtDlp()
  }

  report(0.16, "正在准备 YouTube 下载")
  log("开始执行 yt-dlp Python wrapper，必要时会调用 ffmpeg 合并音视频。")
  const result = await downloadHighQualityYouTube(sourceURL, {
    onProgress: options?.onProgress,
    onLog: log,
    isCancelled: options?.isCancelled,
  })
  if (result.exitCode !== 0 || !result.paths.length) {
    throw new Error(`yt-dlp 下载失败：${compactLog(result.output || `exit code ${result.exitCode}`)}`)
  }

  const filePath = result.paths[result.paths.length - 1]
  const fileName = Path.basename(filePath)
  const bytesWritten = fileSize(filePath)
  if (!bytesWritten) throw new Error("yt-dlp 输出文件为空")
  const title = result.metadata?.title || Path.basename(fileName, Path.extname(fileName))
  const pageURL = result.metadata?.webpage_url || sourceURL

  report(1, `下载完成：${fileName}`)
  log(`YouTube 下载完成：${fileName}，大小 ${formatBytes(bytesWritten)}`)

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
      description: result.metadata?.description || null,
      thumbnailURL: result.metadata?.thumbnail || null,
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
    matchedCandidateLabel: "youtube_yt_dlp_ffmpeg",
  }
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
  }
): Promise<DownloadSuccess> {
  if (options?.isCancelled?.()) throw new Error("下载已取消")
  const kind = detectMediaDownloadKind(sourceURL)
  if (kind === "youtube") return downloadYouTube(sourceURL, options)
  if (kind === "m3u8") return downloadM3U8(sourceURL, options)
  return downloadDouyinVideo(sourceURL, options)
}

export { ROOT_DIR }
