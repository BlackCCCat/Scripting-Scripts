// 油价相关数据类型定义

/** 油品代号 */
export type FuelCode = "92" | "95" | "98" | "0"

/** 油品展示信息 */
export interface FuelMeta {
  code: FuelCode
  /** 列表里的短标题，如 "92号" */
  label: string
  /** 头部放大区使用的全称，如 "92号汽油" */
  fullName: string
}

/** 所有支持的油品，顺序与 UI 列表一致 */
export const FUELS: FuelMeta[] = [
  { code: "92", label: "92号", fullName: "92号汽油" },
  { code: "95", label: "95号", fullName: "95号汽油" },
  { code: "98", label: "98号", fullName: "98号汽油" },
  { code: "0", label: "0号柴油", fullName: "0号柴油" },
]

export function fuelMeta(code: FuelCode): FuelMeta {
  return FUELS.find(f => f.code === code) ?? FUELS[1]
}

/** 单个省份的油价 */
export interface ProvincePrice {
  /** 省份名，如 "河南" */
  province: string
  /** 各油品的价格（元/升） */
  prices: Record<FuelCode, number>
  /** 更新日期，如 "2026-05-31" */
  updatedAt: string
}

/** 下次调价预测信息 */
export interface PriceForecast {
  /** 下次调价时间文案，如 "06月04日 24:00" */
  nextAdjustText: string
  /** 距离调价剩余天数 */
  remainingDays: number
  /** 预计调整方向 */
  direction: "上调" | "下调" | "调整"
  /** 预计每吨调整金额（元） */
  perTon: number | null
  /** 预计每升调整区间，如 "0.39元/升-0.46元/升" */
  perLiterRange: string | null
  /** 来源页面里的预测说明 */
  sourceText: string
}

/** 全量油价数据结构（接口返回的整体结构） */
export interface OilPriceData {
  /** 全国各省油价 */
  provinces: ProvincePrice[]
  /** 调价预测 */
  forecast: PriceForecast
  /** 数据来源 */
  source: string
}
