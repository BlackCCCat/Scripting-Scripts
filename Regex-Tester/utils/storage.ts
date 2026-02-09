export type RegexTesterState = {
  pattern: string
  text: string
  result: string
  matchedCount: number
}

const KEY = "regex_tester_state_v1"

export const DEFAULT_PATTERN = String.raw`(?is)(?=.*(拒收请回复\s*[Rr]|https?://|www\.|[a-z0-9-]+\.(?:cn|com|net)\b))(?=.*(流量|回馈|领取|抽取|福利|补贴|特惠|现金|立减金|返现|优惠|下单|券|借款|额度|年化|利率)).+`

export const DEFAULT_TEXT = `
【CCB 建融家园】登录“CCB 建融家园”小程序，抽取至高 168 元微信立减金！先到先得，s.ccb.cn/ce 8 ptN 拒收请回复 R
`

const DEFAULT_STATE: RegexTesterState = {
  pattern: DEFAULT_PATTERN,
  text: DEFAULT_TEXT,
  result: "",
  matchedCount: 0,
}

function getStorage(): any {
  return (globalThis as any).Storage
}

export function loadState(): RegexTesterState {
  const st = getStorage()
  try {
    const raw = st?.get?.(KEY) ?? st?.getString?.(KEY)
    if (!raw) return DEFAULT_STATE
    const obj = JSON.parse(String(raw))
    return {
      pattern: String(obj?.pattern ?? DEFAULT_STATE.pattern),
      text: String(obj?.text ?? DEFAULT_STATE.text),
      result: String(obj?.result ?? ""),
      matchedCount: Number.isFinite(Number(obj?.matchedCount)) ? Number(obj?.matchedCount) : 0,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function saveState(state: RegexTesterState): void {
  const st = getStorage()
  const fixed: RegexTesterState = {
    pattern: String(state.pattern ?? ""),
    text: String(state.text ?? ""),
    result: String(state.result ?? ""),
    matchedCount: Number.isFinite(Number(state.matchedCount)) ? Number(state.matchedCount) : 0,
  }
  const raw = JSON.stringify(fixed)
  if (st?.set) st.set(KEY, raw)
  else if (st?.setString) st.setString(KEY, raw)
}

