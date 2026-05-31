import { fetch } from "scripting"
import { OilPriceData, ProvincePrice } from "./types"

type FuelPageCode = "92" | "95" | "98" | "0"
type OilPriceCache = {
  savedDate: string
  data: OilPriceData
}

const SOURCE_HOST = "http://www.qiyoujiage.com"
const CACHE_KEY = "oilPriceDataCache.v1"
const PRIVATE_STORAGE = { shared: false }
const PRICE_PAGES: { code: FuelPageCode; url: string }[] = [
  { code: "92", url: `${SOURCE_HOST}/92.shtml` },
  { code: "95", url: `${SOURCE_HOST}/95.shtml` },
  { code: "98", url: `${SOURCE_HOST}/98.shtml` },
  { code: "0", url: `${SOURCE_HOST}/chaiyou.shtml` },
]

/** 油价数据服务层：从 qiyoujiage.com 的公开页面抓取并归一化。 */
export async function fetchOilPrices(options?: {
  forceRefresh?: boolean
}): Promise<OilPriceData> {
  const cached = readOilPriceCache()
  if (!options?.forceRefresh && cached) {
    return cached.data
  }

  try {
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

    const data = normalizePages(pages)
    Storage.set<OilPriceCache>(
      CACHE_KEY,
      {
        savedDate: todayKey(),
        data,
      },
      PRIVATE_STORAGE
    )

    return data
  } catch (e) {
    const cached = readOilPriceCache()
    if (cached) {
      return cached.data
    }
    throw e
  }
}

function readOilPriceCache(): OilPriceCache | null {
  const cached = Storage.get<OilPriceCache>(CACHE_KEY, PRIVATE_STORAGE)
  if (cached?.data?.provinces?.length && cached.savedDate === todayKey()) {
    return cached
  }
  return null
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
    source: SOURCE_HOST,
  }
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
    return {
      nextAdjustText: "以网站公布为准",
      remainingDays: 0,
      direction: "调整",
      perTon: null,
      perLiterRange: null,
      sourceText: "下次调价信息以数据来源页面公布为准。",
    }
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
