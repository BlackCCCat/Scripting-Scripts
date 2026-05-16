export type ClipKind = "text" | "url" | "image"

export type ClipPayload = {
  kind: ClipKind
  text?: string
  url?: string
  image?: UIImage
  sourceChangeCount?: number
}

export type ClipItem = {
  id: string
  kind: ClipKind
  title: string
  content: string
  contentHash: string
  imagePath?: string
  sourceChangeCount?: number
  createdAt: number
  updatedAt: number
  lastCopiedAt?: number
  pinned: boolean
  favorite: boolean
  manualFavorite?: boolean
  deletedAt?: number | null
}

export type ClipListScope = "favorites" | "clipboard"

export type ClipboardClearRange = "recent" | "threeDays" | "sevenDays" | "older"

export type ClipGroup = {
  title: string
  items: ClipItem[]
}

export type CaptureResult =
  | { status: "created"; item: ClipItem }
  | { status: "updated"; item: ClipItem }
  | { status: "skipped"; reason: string }

export type DuplicatePolicy = "skip" | "bump"

export type CaisSettings = {
  captureText: boolean
  captureImages: boolean
  monitorIntervalMs: number
  duplicatePolicy: DuplicatePolicy
  maxItems: number
  appContentLineLimit: number
  keyboardShowTitle: boolean
  keyboardMaxItems: number
  keyboardMenu: KeyboardMenuSettings
}

export type KeyboardMenuBuiltinAction =
  | "pin"
  | "favorite"
  | "base64Encode"
  | "base64Decode"
  | "cleanWhitespace"
  | "removeBlankLines"
  | "splitLines"
  | "uppercase"
  | "lowercase"
  | "chineseAmount"
  | "openUrl"

export type KeyboardCustomActionMode = "template" | "regexExtract" | "regexRemove" | "javascript"

export type KeyboardCustomAction = {
  id: string
  title: string
  mode: KeyboardCustomActionMode
  template: string
  regex?: string
  regexRemoveAll?: boolean
  script?: string
  enabled: boolean
}

export type KeyboardMenuSettings = {
  builtins: Record<KeyboardMenuBuiltinAction, boolean>
  builtinOrder?: KeyboardMenuBuiltinAction[]
  customActions: KeyboardCustomAction[]
}

export type MonitorStatus = {
  active: boolean
  lastMessage: string
  lastCheckedAt?: number
  lastCapturedAt?: number
  capturedCount?: number
}

export const DEFAULT_CAIS_SETTINGS: CaisSettings = {
  captureText: true,
  captureImages: false,
  monitorIntervalMs: 200,
  duplicatePolicy: "bump",
  maxItems: 800,
  appContentLineLimit: 3,
  keyboardShowTitle: true,
  keyboardMaxItems: 30,
  keyboardMenu: {
    builtins: {
      pin: true,
      favorite: true,
      base64Encode: true,
      base64Decode: true,
      cleanWhitespace: true,
      removeBlankLines: true,
      splitLines: true,
      uppercase: true,
      lowercase: true,
      chineseAmount: false,
      openUrl: true,
    },
    customActions: [],
  },
}
