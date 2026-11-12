import { useCallback, useRef } from "scripting"

// 原生控件保留稳定的事件绑定，回调内部始终读取最新状态。
export const useStableAction = <Args extends unknown[], Result>(action: (...args: Args) => Result): ((...args: Args) => Result) => {
  const latest = useRef(action)
  latest.current = action
  return useCallback((...args: Args) => latest.current(...args), [])
}
