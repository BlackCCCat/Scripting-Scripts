export type TabActions = {
  add: () => void
  update: () => void
  canAdd: boolean
  canUpdate: boolean
  search: () => void
  batch: () => void
  searchActive: boolean
  batchActive: boolean
}

export type TabActionSink = (actions: TabActions | null) => void
