export const PREVIEW_TAB = 0
export const HOME_TAB = 1
export const SETTINGS_TAB = 2

export interface PickedItem {
  code: string
  timestamp: number
}

export interface PickupInfo {
  courier: string | null
  code: string
  snippet: string
  date: string | null
  importedAt?: string | null
  picked?: boolean
}

export interface ImportedRecord {
  text: string
  importedAt: string | null
}

export interface Config {
  autoDetectSMS: boolean
  keywords: string[]
  widgetShowCount: number
  showDate: boolean
  importedMessages: string[]
  importedRecords: ImportedRecord[]
  pickedItems: PickedItem[]
  deletedCodes: string[]
}

export type ContentTab = typeof PREVIEW_TAB | typeof HOME_TAB | typeof SETTINGS_TAB
