export type CheckStatus = "unknown" | "checking" | "green" | "yellow" | "red"

export type ApiCheckResult = {
  status: CheckStatus
  baseAvailable: boolean
  modelsAvailable: boolean
  checkedAt: number | null
  message: string
}

export type ApiEntry = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  updatedAt: number
  check: ApiCheckResult
}

export type ManagerSettings = {
  autoCheckOnLaunch: boolean
  autoCheckOnAdd: boolean
  widgetRefreshHours: number
}

export type ManagerState = {
  settings: ManagerSettings
  entries: ApiEntry[]
}
