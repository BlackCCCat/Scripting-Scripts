export type ClipKind = "text" | "url" | "image"
export type FavoriteFormat = "plain" | "fields"
export type FavoriteGroupRuleType = "keyword" | "regex"

export type FavoriteGroup = {
  id: string
  title: string
  ruleType: FavoriteGroupRuleType
  pattern: string
  ignoreCase: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type ClipPayload = {
  kind: ClipKind
  text?: string
  url?: string
  image?: UIImage
  imageContentHash?: string
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
  favoriteFormat?: FavoriteFormat
  fieldDelimiter?: string
  fieldDelimiterOverride?: boolean
  favoriteGroupId?: string
  favoriteGroupManual?: boolean
  favoriteOrder?: number
  favoriteUpdatedAt?: number
  deletedAt?: number | null
}

export type ClipListScope = "favorites" | "clipboard"

export type ClipKindCounts = {
  total: number
  text: number
  url: number
  image: number
}

export type ClipKindCountsByScope = {
  clipboard: ClipKindCounts
  favorites: ClipKindCounts & { plain: number; fields: number }
}

export type ClipboardClearRange = "recent" | "threeDays" | "sevenDays" | "older"

export type ClipGroup = {
  id?: string
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
  iCloudSync: boolean
  iCloudSyncImages: boolean
  lanSharingEnabled: boolean
  lanSharingPort: number
  appContentLineLimit: number
  appClipRowGlassEffect: boolean
  homeScreenEmbeddedNavigation: boolean
  keyboardShowTitle: boolean
  keyboardNativeGlassEffect: boolean
  showRimeKeyboardSwitch: boolean
  inputClicks: boolean
  hapticEngineClicks: boolean
  launchAnimationEnabled: boolean
  favoriteFieldDelimiter: string
  keyboardMaxItems: number
  keyboardMenu: KeyboardMenuSettings
}

export type KeyboardMenuBuiltinAction =
  | "pin"
  | "favorite"
  | "tokenize"
  | "base64Encode"
  | "base64Decode"
  | "cleanWhitespace"
  | "removeBlankLines"
  | "splitLines"
  | "uppercase"
  | "lowercase"
  | "chineseAmount"
  | "openUrl"

export type KeyboardCustomActionMode = "template" | "regexExtract" | "regexRemove" | "javascript" | "networkRequest"

export type KeyboardCustomAction = {
  id: string
  title: string
  mode: KeyboardCustomActionMode
  template: string
  regex?: string
  regexRemoveAll?: boolean
  script?: string
  writeToClipboard?: boolean
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
  iCloudSync: false,
  iCloudSyncImages: false,
  lanSharingEnabled: false,
  lanSharingPort: 8787,
  appContentLineLimit: 3,
  appClipRowGlassEffect: true,
  homeScreenEmbeddedNavigation: true,
  keyboardShowTitle: true,
  keyboardNativeGlassEffect: true,
  showRimeKeyboardSwitch: false,
  inputClicks: false,
  hapticEngineClicks: true,
  launchAnimationEnabled: true,
  favoriteFieldDelimiter: ":",
  keyboardMaxItems: 30,
  keyboardMenu: {
    builtins: {
      pin: true,
      favorite: true,
      tokenize: true,
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
