import { Path, fetch } from "scripting"
import { formatBytes, getArray, getString, isRecord, safeJSONParse, sanitizeFileName, sleep } from "../utils/common"

export type ExtractedInfo = {
  pageURL: string
  canonical: string | null
  title: string
  description: string | null
  thumbnailURL: string | null
  videoSrc: string | null
  routerDataJSON: string | null
  videoInfoResJSON: string | null
  bodyTextPreview: string
  resourceHints: string[]
  performanceMedia: string[]
}

export type DownloadSuccess = {
  id: string
  sourceURL: string
  filePath: string
  fileName: string
  extracted: ExtractedInfo
  finalURL: string
  bytesWritten: number
  createdAt: string
  matchedCandidateLabel: string
}

export type DownloadProgress = {
  fraction: number
  stage: string
}

export type DownloadLogFn = (message: string) => void
export type DownloadProgressFn = (progress: DownloadProgress) => void

export type DownloadCandidate = {
  label: string
  url: string
  headers: Record<string, string>
}

export const ROOT_DIR = Path.join(FileManager.documentsDirectory, "douyin-downloader")
export const DOWNLOAD_DIR = Path.join(ROOT_DIR, "videos")
export const MOBILE_SAFARI_UA = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  "AppleWebKit/605.1.15 (KHTML, like Gecko)",
  "Version/18.0 Mobile/15E148 Safari/604.1",
].join(" ")

function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return isRecord(value) ? value : null
}

function extractVideoId(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/[?&]video_id=([^&]+)/)
  return match?.[1] || null
}

function firstURLFromAddress(address: unknown): string | null {
  if (!isRecord(address)) return null

  const urls = getArray(address.url_list)
    .map((item: unknown) => getString(item))
    .filter((item: string | null): item is string => Boolean(item))
  if (urls.length) return urls[0]

  return getString(address.url) || getString(address.uri)
}

export function extractThumbnailURL(extracted: ExtractedInfo): string | null {
  if (extracted.thumbnailURL) return extracted.thumbnailURL

  const inlineRoot = extractInlineDetailRoot(extracted)
  if (!inlineRoot) return null

  const video = getNestedRecord(inlineRoot, "video")
  if (video) {
    for (const key of ["cover", "origin_cover", "dynamic_cover", "animated_cover"]) {
      const url = firstURLFromAddress(video[key])
      if (url) return url
    }
  }

  const images = getArray(inlineRoot.images)
  for (const image of images) {
    const url = firstURLFromAddress(image)
    if (url) return url
  }

  return null
}

export function extractAwemeDetailRoot(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null

  const record = data

  if (isRecord(record.aweme_detail)) return record.aweme_detail
  if (isRecord(record.video) || typeof record.aweme_id === "string") return record

  const itemList = getArray(record.item_list)
  if (itemList.length > 0 && isRecord(itemList[0])) return itemList[0]

  const nestedData = record.data
  if (isRecord(nestedData) && isRecord(nestedData.aweme_detail)) {
    return nestedData.aweme_detail
  }

  return null
}

export function extractInlineDetailRoot(extracted: ExtractedInfo): Record<string, unknown> | null {
  const directCandidates = [
    safeJSONParse(extracted.videoInfoResJSON),
    safeJSONParse(extracted.routerDataJSON),
  ]

  for (const candidate of directCandidates) {
    const root = extractAwemeDetailRoot(candidate)
    if (root) return root

    if (isRecord(candidate)) {
      const loaderData = getNestedRecord(candidate, "loaderData")
      if (loaderData) {
        for (const rawValue of Object.values(loaderData)) {
          const value = rawValue
          const hit = extractAwemeDetailRoot(value)
          if (hit) return hit
          if (isRecord(value) && isRecord(value.data)) {
            const nested = extractAwemeDetailRoot(value.data)
            if (nested) return nested
          }
          if (isRecord(value)) {
            const nested = extractAwemeDetailRoot(value.videoInfoRes)
            if (nested) return nested
          }
        }
      }
    }
  }

  for (const hint of extracted.resourceHints) {
    const parsed = safeJSONParse(hint)
    const root = extractAwemeDetailRoot(parsed)
    if (root) return root
  }

  return null
}

export function buildDownloadCandidates(
  extracted: ExtractedInfo,
  preferNoWatermark: boolean
): DownloadCandidate[] {
  const baseHeaders = {
    "User-Agent": MOBILE_SAFARI_UA,
    Origin: "https://www.douyin.com",
    Accept: "*/*",
  }
  const pageReferer = extracted.pageURL
  const canonicalReferer = extracted.canonical || extracted.pageURL || "https://www.douyin.com/"
  const candidates: DownloadCandidate[] = []

  const inlineRoot = extractInlineDetailRoot(extracted)
  if (inlineRoot) {
    const video = getNestedRecord(inlineRoot, "video")
    if (video) {
      const pushAddress = (label: string, address: unknown) => {
        if (!isRecord(address)) return
        const addressRecord = address
        const urls = getArray(addressRecord.url_list)
          .map((item: unknown) => getString(item))
          .filter((item: string | null): item is string => Boolean(item))
        for (const url of urls) {
          if (preferNoWatermark && url.includes("/playwm/")) {
            candidates.push({
              label: `${label}_replace_playwm_to_play`,
              url: url.replace("/playwm/", "/play/"),
              headers: {
                ...baseHeaders,
                Referer: pageReferer,
              },
            })
          }
          candidates.push({
            label,
            url,
            headers: {
              ...baseHeaders,
              Referer: pageReferer,
            },
          })
        }
      }

      pushAddress("inline_play_addr_h264", video.play_addr_h264)
      pushAddress("inline_play_addr", video.play_addr)
      pushAddress("inline_play_addr_265", video.play_addr_265)
      pushAddress("inline_download_addr", video.download_addr)

      const bitRates = getArray(video.bit_rate)
      for (const item of bitRates) {
        if (!isRecord(item)) continue
        const gearName = getString(item.gear_name) || getString(item.quality_type) || "bit_rate"
        pushAddress(`inline_bit_rate_${gearName}`, item.play_addr)
      }
    }
  }

  if (!extracted.videoSrc) {
    return dedupeCandidates(candidates)
  }

  const videoId = extractVideoId(extracted.videoSrc)

  if (preferNoWatermark) {
    if (extracted.videoSrc.includes("/playwm/")) {
      candidates.push({
        label: "replace_playwm_to_play",
        url: extracted.videoSrc.replace("/playwm/", "/play/"),
        headers: {
          ...baseHeaders,
          Referer: pageReferer,
        },
      })
    }

    if (videoId) {
      candidates.push({
        label: "constructed_play_watermark0",
        url: `https://www.iesdouyin.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0&is_play_url=1&watermark=0&source=PackSourceEnum_PUBLISH`,
        headers: {
          ...baseHeaders,
          Referer: canonicalReferer,
        },
      })
    }
  }

  candidates.push({
    label: "videoSrc_pageReferer",
    url: extracted.videoSrc,
    headers: {
      ...baseHeaders,
      Referer: pageReferer,
    },
  })

  candidates.push({
    label: "videoSrc_canonicalReferer",
    url: extracted.videoSrc,
    headers: {
      ...baseHeaders,
      Referer: canonicalReferer,
    },
  })

  return dedupeCandidates(candidates)
}

function dedupeCandidates(candidates: DownloadCandidate[]) {
  const seen = new Set<string>()
  const result: DownloadCandidate[] = []
  for (const item of candidates) {
    if (!item.url || seen.has(item.url)) continue
    seen.add(item.url)
    result.push(item)
  }
  return result
}

async function ensureDir(path: string) {
  if (!(await FileManager.exists(path))) {
    await FileManager.createDirectory(path, true)
  }
}

export async function ensureDownloadDirectories() {
  await ensureDir(ROOT_DIR)
  await ensureDir(DOWNLOAD_DIR)
}

export function isLikelyMediaResponse(finalURL: string, mimeType?: string): boolean {
  const mime = mimeType || ""
  if (mime.startsWith("video/")) return true
  if (mime === "application/octet-stream") return true
  return ["douyinvod", ".mp4", "video_mp4", "tos-cn", "aweme.snssdk.com/aweme/v1/play"].some((token) => finalURL.includes(token))
}

export async function extractFromWebView(
  url: string,
  options?: {
    onLog?: DownloadLogFn
    onProgress?: DownloadProgressFn
  }
): Promise<ExtractedInfo> {
  const log = options?.onLog
  const report = options?.onProgress
  const webView = new WebViewController({ ephemeral: true })

  try {
    log?.("正在创建 WebView 并设置移动端 UA…")
    webView.setCustomUserAgent(MOBILE_SAFARI_UA)

    report?.({ fraction: 0.05, stage: "正在打开分享链接" })
    log?.(`开始加载页面：${url}`)
    await webView.loadURL(url)

    report?.({ fraction: 0.1, stage: "正在等待页面首屏加载" })
    await webView.waitForLoad()
    log?.("页面首屏加载完成，等待脚本注入稳定…")
    await sleep(2500)

    report?.({ fraction: 0.14, stage: "正在尝试激活视频节点" })
    await webView.evaluateJavaScript(`
      (async () => {
        const video = document.querySelector('video')
        if (video) {
          try {
            video.muted = true
            await video.play()
          } catch (e) {}
        }
        return {
          hasVideo: Boolean(video),
          readyState: video?.readyState || 0,
          currentSrc: video?.currentSrc || video?.src || null,
        }
      })()
    `)

    log?.("已执行视频激活动作，继续等待页面内嵌数据出现…")
    await sleep(4000)

    report?.({ fraction: 0.18, stage: "正在读取页面内嵌数据" })
    const data = await webView.evaluateJavaScript<ExtractedInfo>(`
      const mediaEntries = performance.getEntriesByType('resource')
        .map((item) => item.name)
        .filter((name) => ['video','playwm','/play/','mp4','m3u8','aweme','douyinvod','tos-cn','iteminfo'].some((token) => name.includes(token)))
      const scripts = Array.from(document.scripts)
        .map((s) => s.textContent || '')
        .filter((text) => ['aweme_detail','play_addr','bit_rate','playwm','video_id','iteminfo','_ROUTER_DATA','videoInfoRes'].some((token) => text.includes(token)))
        .slice(0, 8)
        .map((text) => text.slice(0, 12000))
      let routerDataJSON = null
      let videoInfoResJSON = null
      try {
        if (typeof window._ROUTER_DATA !== 'undefined') {
          routerDataJSON = JSON.stringify(window._ROUTER_DATA)
          const loaderValues = Object.values(window._ROUTER_DATA?.loaderData || {})
          const matched = loaderValues.find((item) => item?.videoInfoRes)?.videoInfoRes
          if (matched) {
            videoInfoResJSON = JSON.stringify(matched)
          }
        }
      } catch (e) {}
      try {
        if (!videoInfoResJSON && typeof window.videoInfoRes !== 'undefined') {
          videoInfoResJSON = JSON.stringify(window.videoInfoRes)
        }
      } catch (e) {}
      return {
        pageURL: location.href,
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        title: document.title || '',
        description: document.querySelector('meta[name="description"]')?.content || null,
        thumbnailURL: document.querySelector('meta[property="og:image"]')?.content
          || document.querySelector('meta[name="twitter:image"]')?.content
          || document.querySelector('video')?.poster
          || null,
        videoSrc: document.querySelector('video')?.currentSrc || document.querySelector('video')?.src || null,
        routerDataJSON,
        videoInfoResJSON,
        bodyTextPreview: document.body?.innerText?.slice(0, 600) || '',
        resourceHints: scripts,
        performanceMedia: mediaEntries,
      }
    `)

    log?.(`页面信息读取完成：title=${data.title || "(空)"}`)
    log?.(`videoSrc=${data.videoSrc ? "已提取" : "未提取"}，routerData=${data.routerDataJSON ? "有" : "无"}，videoInfoRes=${data.videoInfoResJSON ? "有" : "无"}`)
    data.thumbnailURL = extractThumbnailURL(data)
    log?.(`thumbnail=${data.thumbnailURL ? "已提取" : "未提取"}`)
    log?.(`performanceMedia=${data.performanceMedia.length}，resourceHints=${data.resourceHints.length}`)

    return data
  } finally {
    webView.dispose()
  }
}

export async function downloadVideo(
  sourceURL: string,
  options?: {
    preferNoWatermark?: boolean
    onProgress?: DownloadProgressFn
    onLog?: DownloadLogFn
  }
): Promise<DownloadSuccess> {
  const reportProgress = (fraction: number, stage: string) => {
    options?.onProgress?.({ fraction, stage })
  }
  const log = (message: string) => {
    options?.onLog?.(message)
  }

  reportProgress(0.03, "正在分析分享页面")
  log("开始解析分享链接页面…")

  const extracted = await extractFromWebView(sourceURL, {
    onLog: log,
    onProgress: options?.onProgress,
  })

  const inlineRoot = extractInlineDetailRoot(extracted)
  log(`页面 aweme 内嵌数据：${inlineRoot ? "已命中" : "未命中"}`)

  if (!extracted.videoSrc && !inlineRoot) {
    throw new Error("未能从页面中提取到视频地址或 aweme 内嵌数据")
  }

  await ensureDownloadDirectories()
  log("已确认下载目录可用：Documents/douyin-downloader/videos")

  const candidates = buildDownloadCandidates(
    extracted,
    options?.preferNoWatermark ?? true
  )
  let lastError = "未生成可用下载候选地址"

  if (!candidates.length) {
    throw new Error(lastError)
  }

  log(`共生成 ${candidates.length} 个下载候选，开始逐个尝试。`)
  log(`候选顺序：${candidates.map((item) => item.label).join(", ")}`)
  reportProgress(0.22, `已生成 ${candidates.length} 个候选地址`)

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const attemptBase = 0.22 + (index / candidates.length) * 0.5
    reportProgress(attemptBase, `正在尝试候选 ${index + 1}/${candidates.length}：${candidate.label}`)
    log(`尝试候选 ${index + 1}/${candidates.length}：${candidate.label}`)

    try {
      const response = await fetch(candidate.url, {
        method: "GET",
        timeout: 180,
        debugLabel: `douyin-downloader-${candidate.label}`,
        headers: candidate.headers,
      })

      if (!response.ok) {
        const preview = await response.text().catch(() => "")
        lastError = `${candidate.label}: ${response.status} ${response.statusText} ${preview.slice(0, 120)}`
        log(`候选失败：${candidate.label} -> ${response.status} ${response.statusText}`)
        continue
      }

      if (!isLikelyMediaResponse(response.url, response.mimeType)) {
        const preview = await response.text().catch(() => "")
        lastError = `${candidate.label}: 响应不是视频资源 ${response.mimeType || "unknown"} ${preview.slice(0, 120)}`
        log(`候选跳过：${candidate.label} 响应不是视频资源，mime=${response.mimeType || "unknown"}`)
        continue
      }

      log(`候选命中：${candidate.label}，开始读取二进制数据…`)
      reportProgress(0.8, `候选命中：${candidate.label}，正在读取视频数据`)

      const bytes = await response.bytes()
      const fileName = `${sanitizeFileName(extracted.title)}.mp4`
      const filePath = Path.join(DOWNLOAD_DIR, fileName)

      log(`视频读取完成，大小 ${formatBytes(bytes.byteLength)}，开始写入本地文件…`)
      reportProgress(0.9, `正在写入文件：${fileName}`)
      await FileManager.writeAsBytes(filePath, bytes)
      log(`文件写入完成：${fileName}`)
      reportProgress(1, `下载完成：${fileName}`)

      return {
        id: UUID.string(),
        sourceURL,
        filePath,
        fileName,
        extracted,
        finalURL: response.url,
        bytesWritten: bytes.byteLength,
        createdAt: new Date().toISOString(),
        matchedCandidateLabel: candidate.label,
      }
    } catch (error) {
      lastError = `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`
      log(`候选异常：${lastError}`)
    }
  }

  throw new Error(`所有下载候选均失败：${lastError}`)
}
