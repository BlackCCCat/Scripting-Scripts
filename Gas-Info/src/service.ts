import { fetch } from "scripting"
import {
  FuelCode,
  OilPriceData,
  PriceForecast,
  ProvincePrice,
  isValidFuelPrice,
} from "./types"
import { getOilPriceSource, OilPriceSource } from "./settings"

type FuelPageCode = "92" | "95" | "98" | "0"
type OilPriceCache = {
  savedDate: string
  preferredSource: OilPriceSource
  data: OilPriceData
}
type SourceFetchResult = OilPriceData & {
  sourceId: OilPriceSource
}

const QIYOUJIAGE_HOST = "http://www.qiyoujiage.com"
const AUTOHOME_URL = "https://www.autohome.com.cn/oil"
const CACHE_KEY = "oilPriceDataCache.v3"
const PRIVATE_STORAGE = { shared: false }
const SOURCE_TIMEOUT_MS = 8000
const SUPPLEMENT_TIMEOUT_MS = 3000
const PRICE_PAGES: { code: FuelPageCode; url: string }[] = [
  { code: "92", url: `${QIYOUJIAGE_HOST}/92.shtml` },
  { code: "95", url: `${QIYOUJIAGE_HOST}/95.shtml` },
  { code: "98", url: `${QIYOUJIAGE_HOST}/98.shtml` },
  { code: "0", url: `${QIYOUJIAGE_HOST}/chaiyou.shtml` },
]

/** 油价数据服务层：按首选源抓取，超时或缺数据时自动回退补全。 */
export async function fetchOilPrices(options?: {
  forceRefresh?: boolean
  preferredSource?: OilPriceSource
}): Promise<OilPriceData> {
  const preferredSource = options?.preferredSource ?? getOilPriceSource()
  const cached = readOilPriceCache(preferredSource)
  if (!options?.forceRefresh && cached) {
    return cached.data
  }

  try {
    const data = await fetchCombinedOilPrices(preferredSource)
    Storage.set<OilPriceCache>(
      CACHE_KEY,
      {
        savedDate: todayKey(),
        preferredSource,
        data,
      },
      PRIVATE_STORAGE
    )

    return data
  } catch (e) {
    const cached = readOilPriceCache(preferredSource)
    if (cached) {
      return cached.data
    }
    throw e
  }
}

function readOilPriceCache(preferredSource: OilPriceSource): OilPriceCache | null {
  const cached = Storage.get<OilPriceCache>(CACHE_KEY, PRIVATE_STORAGE)
  if (
    isUsableOilData(cached?.data) &&
    cached.savedDate === todayKey() &&
    cached.preferredSource === preferredSource
  ) {
    return cached
  }
  return null
}

function isUsableOilData(data: OilPriceData | undefined): data is OilPriceData {
  return !!(
    data?.provinces?.length &&
    data.provinces.length >= 31 &&
    matchProvince(data.provinces, "甘肃")
  )
}

async function fetchCombinedOilPrices(
  preferredSource: OilPriceSource
): Promise<OilPriceData> {
  const fallbackSource = otherSource(preferredSource)
  let primary: SourceFetchResult | null = null
  let fallback: SourceFetchResult | null = null

  try {
    primary = await fetchSourceWithTimeout(preferredSource)
  } catch {
    fallback = await fetchSourceWithTimeout(fallbackSource)
  }

  if (primary && shouldSupplement(primary)) {
    const timeoutMs = hasIncompleteProvincePrices(primary)
      ? SOURCE_TIMEOUT_MS
      : SUPPLEMENT_TIMEOUT_MS
    try {
      fallback = await fetchSourceWithTimeout(
        fallbackSource,
        timeoutMs
      )
    } catch {
      // 首选源已经可用，补充源失败时继续使用首选源数据。
    }
  }

  const base = primary ?? fallback
  if (!base) {
    throw new Error("油价数据加载失败")
  }

  const supplemented = fallback ? mergeOilPriceData(base, fallback) : base
  const forecast = await resolveForecast(supplemented, primary, fallback)

  return {
    provinces: supplemented.provinces,
    forecast,
    source: sourceLabel(supplemented, forecast),
  }
}

function otherSource(source: OilPriceSource): OilPriceSource {
  return source === "autohome" ? "qiyoujiage" : "autohome"
}

function shouldSupplement(data: OilPriceData): boolean {
  return (
    data.provinces.length < 31 ||
    hasIncompleteProvincePrices(data) ||
    !hasConcreteForecast(data.forecast)
  )
}

function hasIncompleteProvincePrices(data: OilPriceData): boolean {
  return data.provinces.some(
    province =>
      !isValidFuelPrice(province.prices["92"]) ||
      !isValidFuelPrice(province.prices["95"]) ||
      !isValidFuelPrice(province.prices["98"]) ||
      !isValidFuelPrice(province.prices["0"])
  )
}

function hasConcreteForecast(forecast: PriceForecast): boolean {
  return forecast.perTon !== null && forecast.perLiterRange !== null
}

async function fetchSourceWithTimeout(
  source: OilPriceSource,
  timeoutMs = SOURCE_TIMEOUT_MS
): Promise<SourceFetchResult> {
  return withTimeout(
    () =>
      source === "autohome"
        ? fetchAutohomeOilPrices()
        : fetchQiyoujiageOilPrices(),
    timeoutMs,
    sourceLabelText(source)
  )
}

function withTimeout<T>(
  run: () => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}请求超时`))
    }, ms)
    run()
      .then(resolve, reject)
      .finally(() => {
        if (timer) {
          clearTimeout(timer)
        }
      })
  })
}

async function fetchQiyoujiageOilPrices(): Promise<SourceFetchResult> {
  const pages = await Promise.all(
    PRICE_PAGES.map(async page => {
      const response = await fetch(page.url)
      if (!response.ok) {
        throw new Error(`油价数据请求失败：${page.url}`)
      }
      return {
        ...page,
        html: await response.text(),
      }
    })
  )

  return {
    ...normalizePages(pages),
    sourceId: "qiyoujiage",
  }
}

async function fetchAutohomeOilPrices(): Promise<SourceFetchResult> {
  const response = await fetch(AUTOHOME_URL)
  if (!response.ok) {
    throw new Error(`油价数据请求失败：${AUTOHOME_URL}`)
  }
  return normalizeAutohomePage(await response.text())
}

async function resolveForecast(
  data: OilPriceData,
  primary: SourceFetchResult | null,
  fallback: SourceFetchResult | null
): Promise<PriceForecast> {
  if (hasConcreteForecast(data.forecast)) {
    return data.forecast
  }

  const qiyoujiage = [primary, fallback].find(
    item => item?.sourceId === "qiyoujiage" && hasConcreteForecast(item.forecast)
  )
  if (qiyoujiage) {
    return qiyoujiage.forecast
  }

  try {
    return await withTimeout(
      fetchQiyoujiageForecast,
      SUPPLEMENT_TIMEOUT_MS,
      "调价预测"
    )
  } catch {
    return defaultForecast("下次调价信息以数据来源页面公布为准。")
  }
}

async function fetchQiyoujiageForecast(): Promise<PriceForecast> {
  const response = await fetch(`${QIYOUJIAGE_HOST}/92.shtml`)
  if (!response.ok) {
    throw new Error("调价预测请求失败")
  }
  return parseForecast(await response.text())
}

function todayKey(): string {
  return formatDate(new Date())
}

function normalizePages(
  pages: { code: FuelPageCode; url: string; html: string }[]
): OilPriceData {
  const byProvince = new Map<string, Partial<ProvincePrice>>()
  const order: string[] = []

  for (const page of pages) {
    const rows = parsePriceRows(page.html)
    const updatedAt = parseUpdatedAt(page.html)

    for (const row of rows) {
      if (!byProvince.has(row.province)) {
        byProvince.set(row.province, {
          province: row.province,
          prices: {} as ProvincePrice["prices"],
          updatedAt,
        })
        order.push(row.province)
      }

      const item = byProvince.get(row.province)!
      ;(item.prices as Partial<ProvincePrice["prices"]>)[page.code] =
        row.price
      item.updatedAt = latestDate(item.updatedAt, updatedAt)
    }
  }

  const provinces = order
    .map(name => byProvince.get(name))
    .filter((item): item is ProvincePrice => {
      const prices = item?.prices as Partial<ProvincePrice["prices"]> | undefined
      return !!(
        item?.province &&
        item.updatedAt &&
        typeof prices?.["92"] === "number" &&
        typeof prices?.["95"] === "number" &&
        typeof prices?.["98"] === "number" &&
        typeof prices?.["0"] === "number"
      )
    })

  if (!provinces.length) {
    throw new Error("未能从油价页面解析到省份价格")
  }

  return {
    provinces,
    forecast: parseForecast(pages[0].html),
    source: QIYOUJIAGE_HOST,
  }
}

function normalizeAutohomePage(html: string): SourceFetchResult {
  const jsonText = extractNextDataJson(html)
  const data = JSON.parse(jsonText)
  const rows = data?.props?.pageProps?.baseData?.oilPriceInfo?.oilPrices
  if (!Array.isArray(rows)) {
    throw new Error("未能从汽车之家页面解析到油价数据")
  }

  const provinces = rows
    .map(row => normalizeAutohomeRow(row))
    .filter((item): item is ProvincePrice => !!item)

  if (!provinces.length) {
    throw new Error("未能从汽车之家页面解析到省份价格")
  }

  return {
    provinces,
    forecast: defaultForecast("汽车之家暂未提供结构化调价预测。"),
    source: AUTOHOME_URL,
    sourceId: "autohome",
  }
}

function extractNextDataJson(html: string): string {
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  )
  if (!match) {
    throw new Error("未找到汽车之家油价页面数据")
  }
  return match[1]
}

function normalizeAutohomeRow(row: any): ProvincePrice | null {
  const prices = {
    "92": Number(row?.oilPrice92),
    "95": Number(row?.oilPrice95),
    "98": Number(row?.oilPrice98),
    "0": Number(row?.oilPrice0),
  }
  if (!row?.provinceName || !isUsableProvincePrices(prices)) {
    return null
  }

  return {
    province: String(row.provinceName),
    prices,
    updatedAt: typeof row.dateTime === "string" ? row.dateTime : todayKey(),
  }
}

function isUsableProvincePrices(
  prices: Record<FuelCode, number>
): prices is Record<FuelCode, number> {
  return Object.values(prices).some(isValidFuelPrice)
}

function mergeOilPriceData(
  primary: SourceFetchResult,
  fallback: SourceFetchResult
): SourceFetchResult {
  const byProvince = new Map<string, ProvincePrice>()
  for (const province of fallback.provinces) {
    byProvince.set(normalizeProvinceName(province.province), province)
  }

  const merged: ProvincePrice[] = []
  const seen = new Set<string>()
  for (const province of primary.provinces) {
    const key = normalizeProvinceName(province.province)
    const fallbackProvince = byProvince.get(key)
    merged.push(fallbackProvince ? mergeProvince(province, fallbackProvince) : province)
    seen.add(key)
  }

  for (const province of fallback.provinces) {
    const key = normalizeProvinceName(province.province)
    if (!seen.has(key)) {
      merged.push(province)
    }
  }

  return {
    provinces: merged,
    forecast: hasConcreteForecast(primary.forecast)
      ? primary.forecast
      : fallback.forecast,
    source: `${primary.source}；${fallback.source}`,
    sourceId: primary.sourceId,
  }
}

function mergeProvince(
  primary: ProvincePrice,
  fallback: ProvincePrice
): ProvincePrice {
  return {
    province: primary.province,
    prices: {
      "92": isValidFuelPrice(primary.prices["92"]) ? primary.prices["92"] : fallback.prices["92"],
      "95": isValidFuelPrice(primary.prices["95"]) ? primary.prices["95"] : fallback.prices["95"],
      "98": isValidFuelPrice(primary.prices["98"]) ? primary.prices["98"] : fallback.prices["98"],
      "0": isValidFuelPrice(primary.prices["0"]) ? primary.prices["0"] : fallback.prices["0"],
    },
    updatedAt: latestDate(primary.updatedAt, fallback.updatedAt),
  }
}

function sourceLabel(
  data: OilPriceData,
  forecast: PriceForecast
): string {
  const sources = data.source.split("；").filter(Boolean)
  if (
    hasConcreteForecast(forecast) &&
    !sources.includes(QIYOUJIAGE_HOST)
  ) {
    sources.push(QIYOUJIAGE_HOST)
  }
  return Array.from(new Set(sources)).join("；")
}

function sourceLabelText(source: OilPriceSource): string {
  return source === "autohome" ? "汽车之家" : "汽油价格网"
}

/**
 * 在省份列表里按定位省份名匹配（容错处理 "省/市/自治区" 等后缀）。
 * 返回匹配到的省份，未匹配则返回 null。
 */
export function matchProvince(
  provinces: ProvincePrice[],
  locatedName: string | null | undefined
): ProvincePrice | null {
  if (!locatedName) {
    return null
  }
  const target = normalizeProvinceName(locatedName)
  if (!target) {
    return null
  }
  return (
    provinces.find(p => {
      const name = normalizeProvinceName(p.province)
      return name === target || target.includes(name) || name.includes(target)
    }) ?? null
  )
}

/** 去掉常见行政区后缀做省份匹配和搜索。 */
export function normalizeProvinceName(s: string): string {
  return s
    .replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)/g, "")
    .trim()
}

function parsePriceRows(html: string): { province: string; price: number }[] {
  const rows: { province: string; price: number }[] = []
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let match: RegExpExecArray | null

  while ((match = rowPattern.exec(html))) {
    const cells = extractCells(match[1])
    if (cells.length < 2 || cells[0] === "地区") {
      continue
    }

    const price = Number(cells[1])
    if (!Number.isFinite(price)) {
      continue
    }

    rows.push({
      province: cells[0],
      price,
    })
  }

  return rows
}

function extractCells(rowHtml: string): string[] {
  const cells: string[] = []
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let match: RegExpExecArray | null

  while ((match = cellPattern.exec(rowHtml))) {
    const text = stripHtml(match[1])
    if (text) {
      cells.push(text)
    }
  }

  return cells
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function htmlText(html: string): string {
  return stripHtml(html).replace(/\s+/g, "")
}

function parseUpdatedAt(html: string): string {
  const text = htmlText(html)
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日24时/)
  if (!match) {
    return formatDate(new Date())
  }

  return [
    match[1],
    match[2].padStart(2, "0"),
    match[3].padStart(2, "0"),
  ].join("-")
}

function parseForecast(html: string): OilPriceData["forecast"] {
  const text = htmlText(html)
  const match = text.match(
    /油价(\d{1,2})月(\d{1,2})日24时调整.*?预计(上调|下调)(\d+)元\/吨\(([0-9.]+元\/升-[0-9.]+元\/升)\)/
  )

  if (!match) {
    return defaultForecast("下次调价信息以数据来源页面公布为准。")
  }

  const month = Number(match[1])
  const day = Number(match[2])
  const direction = match[3] as "上调" | "下调"
  const perTon = Number(match[4])
  const perLiterRange = match[5]

  return {
    nextAdjustText: `${String(month).padStart(2, "0")}月${String(day).padStart(
      2,
      "0"
    )}日 24:00`,
    remainingDays: daysUntil(month, day),
    direction,
    perTon: Number.isFinite(perTon) ? perTon : null,
    perLiterRange,
    sourceText: `目前预计${direction}${perTon}元/吨（${perLiterRange}）`,
  }
}

function defaultForecast(sourceText: string): PriceForecast {
  return {
    nextAdjustText: "以网站公布为准",
    remainingDays: 0,
    direction: "调整",
    perTon: null,
    perLiterRange: null,
    sourceText,
  }
}

function daysUntil(month: number, day: number): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let target = new Date(now.getFullYear(), month - 1, day)

  if (target.getTime() < today.getTime()) {
    target = new Date(now.getFullYear() + 1, month - 1, day)
  }

  return Math.max(
    0,
    Math.round((target.getTime() - today.getTime()) / 86400000)
  )
}

function latestDate(a: string | undefined, b: string): string {
  if (!a) {
    return b
  }
  return a > b ? a : b
}

function formatDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}
