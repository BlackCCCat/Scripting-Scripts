import { useEffect, useState } from "scripting"
import type { StateSource } from "../shared/EventBus"
import { animateState } from "./animateState"
import { scheduleUI } from "./scheduleUI"

// bus 只传递失效通知；离开事件回调后取最新快照，同一轮变化只提交一次。
export const useBusState = <T,>(source: StateSource<T>, animate: (change: () => void) => void = animateState): T => {
  const [snapshot, setSnapshot] = useState(() => ({ source, value: source.read() }))
  useEffect(() => {
    let active = true, pending = false, current = snapshot.value, bound = snapshot.source === source
    let timer: ReturnType<typeof setTimeout> | undefined
    const notify = (): void => {
      if (!active || pending) return
      pending = true
      timer = scheduleUI(() => {
        pending = false
        if (!active) return
        const next = source.read()
        if (bound && Object.is(current, next)) return
        animate(() => {
          if (!active || !Object.is(source.read(), next) || bound && Object.is(current, next)) return
          current = next; bound = true
          setSnapshot({ source, value: next })
        })
      })
    }
    const unsubscribe = source.subscribe(notify)
    notify()
    return () => {
      active = false
      unsubscribe()
      clearTimeout(timer)
    }
  }, [source, animate])
  // A new controller/source must not render the previous source's value for one event loop.
  return snapshot.source === source ? snapshot.value : source.read()
}
