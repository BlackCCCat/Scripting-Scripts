const maxConcurrentAccounts = 4
const updateIntervalMs = 240

export function createDashboardRefreshLimiter() {
  let active = 0
  const waiting: Array<() => void> = []

  return async function withRefreshSlot<Result>(refresh: () => Promise<Result>): Promise<Result> {
    if (active < maxConcurrentAccounts) {
      active++
    } else {
      await new Promise<void>((resume) => waiting.push(resume))
    }
    try {
      return await refresh()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

export async function runDashboardRefreshQueue<Account, Result>(
  accounts: readonly Account[],
  refresh: (account: Account) => Promise<Result | undefined>,
  publish: (results: Result[]) => void
) {
  let nextIndex = 0
  let results: Result[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (results.length === 0) return
    const batch = results
    results = []
    publish(batch)
  }

  const worker = async () => {
    while (nextIndex < accounts.length) {
      const account = accounts[nextIndex++]
      try {
        const result = await refresh(account)
        if (result === undefined) continue
        results.push(result)
        timer ??= setTimeout(flush, updateIntervalMs)
      } catch (error) {
        console.error("Dashboard account refresh failed", error instanceof Error ? error.name : "Error")
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(maxConcurrentAccounts, accounts.length) }, worker))
  } finally {
    flush()
  }
}
