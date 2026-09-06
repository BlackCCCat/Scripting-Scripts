import { fetch, type RequestInit } from "scripting"
import {
  FuelCode,
  OilPriceData,
  PriceForecast,
  ProvincePrice,
  isValidFuelPrice,
} from "./types"
import { getOilPriceSource, type OilPriceSource } from "./settings"

type FuelPageCode = "92" | "95" | "98" | "0"
type OilPriceCache = {
  savedDate: string
  preferredSource: OilPriceSource
  data: OilPriceData
}
type SourceFetchResult = OilPriceData & {
  sourceId: OilPriceSource
}
type SinopecProvinceSpec = {
  id: string
  name: string
}

const QIYOUJIAGE_HOST = "http://www.qiyoujiage.com"
const AUTOHOME_URL = "https://www.autohome.com.cn/oil"
const SINOPEC_INIT_URL = "https://cx.sinopecsales.com/yjkqiantai/core/initCpb"
const SINOPEC_PROVINCE_URL =
  "https://cx.sinopecsales.com/yjkqiantai/data/switchProvince"
const CACHE_KEY = "oilPriceDataCache.v4"
const PRIVATE_STORAGE = { shared: false }
const SOURCE_TIMEOUT_MS = 8000
const SUPPLEMENT_TIMEOUT_MS = 3000
const SINOPEC_CONCURRENCY = 6
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
const PRICE_PAGES: { code: FuelPageCode; url: string }[] = [
  { code: "92", url: `${QIYOUJIAGE_HOST}/92.shtml` },
  { code: "95", url: `${QIYOUJIAGE_HOST}/95.shtml` },
  { code: "98", url: `${QIYOUJIAGE_HOST}/98.shtml` },
  { code: "0", url: `${QIYOUJIAGE_HOST}/chaiyou.shtml` },
]
const SINOPEC_PROVINCES: SinopecProvinceSpec[] = [
  { id: "11", name: "北京" },
  { id: "31", name: "上海" },
  { id: "32", name: "江苏" },
  { id: "12", name: "天津" },
  { id: "50", name: "重庆" },
  { id: "36", name: "江西" },
  { id: "21", name: "辽宁" },
  { id: "34", name: "安徽" },
  { id: "15", name: "内蒙古" },
  { id: "35", name: "福建" },
  { id: "64", name: "宁夏" },
  { id: "62", name: "甘肃" },
  { id: "63", name: "青海" },
  { id: "44", name: "广东" },
  { id: "37", name: "山东" },
  { id: "45", name: "广西" },
  { id: "14", name: "山西" },
  { id: "52", name: "贵州" },
  { id: "61", name: "陕西" },
  { id: "46", name: "海南" },
  { id: "51", name: "四川" },
  { id: "13", name: "河北" },
  { id: "54", name: "西藏" },
  { id: "41", name: "河南" },
  { id: "65", name: "新疆" },
  { id: "23", name: "黑龙江" },
  { id: "22", name: "吉林" },
  { id: "53", name: "云南" },
  { id: "42", name: "湖北" },
  { id: "33", name: "浙江" },
  { id: "43", name: "湖南" },
]
const SINOPEC_FUEL_FIELDS: Record<FuelCode, string[]> = {
  "92": ["GAS_92", "E92", "AIPAO_GAS_92", "AIPAO_GAS_E92"],
  "95": ["GAS_95", "E95", "AIPAO_GAS_95", "AIPAO_GAS_E95"],
  "98": ["GAS_98", "E98", "AIPAO_GAS_98", "AIPAO_GAS_E98"],
  "0": ["CHECHAI_0", "CHAI_0"],
}

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
  const sources = sourceOrder(preferredSource)
  const fetched: SourceFetchResult[] = []
  let combined: SourceFetchResult | null = null

  for (const source of sources) {
    if (combined && !shouldSupplementPrices(combined)) {
      break
    }
    try {
      const result = await fetchSourceWithTimeout(source)
      fetched.push(result)
      combined = combined ? mergeOilPriceData(combined, result) : result
    } catch {
      // 当前源不可用时继续尝试后续源。
    }
  }

  if (!combined) {
    throw new Error("油价数据加载失败")
  }

  const forecast = await resolveForecast(fetched)

  return {
    provinces: combined.provinces,
    forecast,
    source: sourceLabel(combined, forecast),
  }
}

function sourceOrder(preferredSource: OilPriceSource): OilPriceSource[] {
  const fallback: OilPriceSource[] = ["sinopec", "autohome", "qiyoujiage"]
  return [
    preferredSource,
    ...fallback.filter(source => source !== preferredSource),
  ]
}

function shouldSupplementPrices(data: OilPriceData): boolean {
  return data.provinces.length < 31 || hasIncompleteProvincePrices(data)
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
        : source === "sinopec"
          ? fetchSinopecOilPrices()
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
      const response = await fetch(
        page.url,
        qiyoujiageRequestInit(SOURCE_TIMEOUT_MS, `汽油价格网油价-${page.code}`)
      )
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
  const response = await fetch(AUTOHOME_URL, {
    timeout: SOURCE_TIMEOUT_MS / 1000,
    debugLabel: "汽车之家油价",
  })
  if (!response.ok) {
    throw new Error(`油价数据请求失败：${AUTOHOME_URL}`)
  }
  return normalizeAutohomePage(await response.text())
}

async function fetchSinopecOilPrices(): Promise<SourceFetchResult> {
  await fetch(SINOPEC_INIT_URL, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
    },
    timeout: SUPPLEMENT_TIMEOUT_MS / 1000,
    debugLabel: "中国石化油价初始化",
  }).catch(() => null)

  const provinces = (
    await mapLimited(SINOPEC_PROVINCES, SINOPEC_CONCURRENCY, spec =>
      fetchSinopecProvince(spec).catch(() => null)
    )
  ).filter((item): item is ProvincePrice => !!item)

  if (!provinces.length) {
    throw new Error("未能从中国石化接口解析到省份价格")
  }

  return {
    provinces,
    forecast: defaultForecast("中国石化暂未提供结构化调价预测。"),
    source: SINOPEC_INIT_URL,
    sourceId: "sinopec",
  }
}

async function fetchSinopecProvince(
  spec: SinopecProvinceSpec
): Promise<ProvincePrice | null> {
  const response = await fetch(SINOPEC_PROVINCE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "User-Agent": BROWSER_USER_AGENT,
      Origin: "https://cx.sinopecsales.com",
      Referer: SINOPEC_INIT_URL,
    },
    body: JSON.stringify({ provinceId: spec.id }),
    timeout: SOURCE_TIMEOUT_MS / 1000,
    debugLabel: `中国石化油价-${spec.name}`,
  })

  if (!response.ok) {
    return null
  }

  return normalizeSinopecProvince(spec, await response.json())
}

async function resolveForecast(
  fetched: SourceFetchResult[]
): Promise<PriceForecast> {
  const qiyoujiage = fetched.find(item => {
    return item.sourceId === "qiyoujiage" && hasConcreteForecast(item.forecast)
  })
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
  const response = await fetch(
    `${QIYOUJIAGE_HOST}/92.shtml`,
    qiyoujiageRequestInit(SUPPLEMENT_TIMEOUT_MS, "汽油价格网调价预测")
  )
  if (!response.ok) {
    throw new Error("调价预测请求失败")
  }
  return parseForecast(await response.text())
}

function qiyoujiageRequestInit(
  timeoutMs: number,
  debugLabel: string
): RequestInit {
  return {
    allowInsecureRequest: true,
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
    },
    timeout: timeoutMs / 1000,
    debugLabel,
  }
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

function normalizeSinopecProvince(
  spec: SinopecProvinceSpec,
  json: any
): ProvincePrice | null {
  const records = extractSinopecPriceRecords(json)
  if (!records.length) {
    return null
  }

  const prices = {
    "92": pickSinopecPrice(records, "92"),
    "95": pickSinopecPrice(records, "95"),
    "98": pickSinopecPrice(records, "98"),
    "0": pickSinopecPrice(records, "0"),
  }

  if (!isUsableProvincePrices(prices)) {
    return null
  }

  return {
    province: spec.name,
    prices,
    updatedAt: pickSinopecUpdatedAt(records) ?? todayKey(),
  }
}

function extractSinopecPriceRecords(json: any): Record<string, any>[] {
  const data = json?.data
  const records: Record<string, any>[] = []
  if (data?.provinceData && typeof data.provinceData === "object") {
    records.push(data.provinceData)
  }
  if (Array.isArray(data?.area)) {
    for (const area of data.area) {
      if (area?.areaData && typeof area.areaData === "object") {
        records.push(area.areaData)
      }
    }
  }
  return records
}

function pickSinopecPrice(
  records: Record<string, any>[],
  code: FuelCode
): number {
  for (const field of SINOPEC_FUEL_FIELDS[code]) {
    for (const record of records) {
      const price = Number(record[field])
      if (isValidFuelPrice(price)) {
        return price
      }
    }
  }
  return 0
}

function pickSinopecUpdatedAt(records: Record<string, any>[]): string | null {
  const dates = records
    .map(record => {
      const value = record.START_DATE
      return typeof value === "string" ? value.slice(0, 10) : null
    })
    .filter((date): date is string => !!date)

  return dates.reduce<string | null>(
    (latest, date) => (!latest || date > latest ? date : latest),
    null
  )
}

function isUsableProvincePrices(
  prices: Record<FuelCode, number>
): prices is Record<FuelCode, number> {
  return Object.values(prices).some(isValidFuelPrice)
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const current = cursor
      cursor += 1
      results[current] = await run(items[current])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
  return results
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
    merged.push(
      fallbackProvince ? mergeProvince(province, fallbackProvince) : province
    )
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
      "92": isValidFuelPrice(primary.prices["92"])
        ? primary.prices["92"]
        : fallback.prices["92"],
      "95": isValidFuelPrice(primary.prices["95"])
        ? primary.prices["95"]
        : fallback.prices["95"],
      "98": isValidFuelPrice(primary.prices["98"])
        ? primary.prices["98"]
        : fallback.prices["98"],
      "0": isValidFuelPrice(primary.prices["0"])
        ? primary.prices["0"]
        : fallback.prices["0"],
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
  if (source === "autohome") {
    return "汽车之家"
  }
  return source === "sinopec" ? "中国石化" : "汽油价格网"
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
