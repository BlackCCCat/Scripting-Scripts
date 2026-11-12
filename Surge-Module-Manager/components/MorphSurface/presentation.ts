import { createStateSource } from "../../shared/EventBus"
import { scheduleUI } from "../../hooks/scheduleUI"

// Shared presentation lifecycle. Geometry and native animation phases remain in MorphSurface.
// Internal to the suite: consumers use MorphCard or a composed host such as LiquidTabs.
export type MorphPresentation<T> = {
 id: number; value: T
 close: () => void
 bind: (close: () => void) => void
 finish: () => void
}
export const createMorphSession = <T,>() => {
 const state = createStateSource<MorphPresentation<T> | null>(null)
 let active = true, serial = 0, cleanup: (() => void) | undefined
 const reset = (): void => { cleanup?.(); cleanup = undefined; state.write(null) }
 return {
  state, reset,
  open(value: T): MorphPresentation<T> | null {
   if (!active || state.read()) return null
   let close: (() => void) | undefined, requested = false, task: ReturnType<typeof setTimeout> | undefined
   const current = (): boolean => active && state.read() === instance
   const dispatch = (): void => {
    if (!requested || !close || task !== undefined) return
    task = scheduleUI(() => {
     task = undefined
     if (!current() || !requested) return
     requested = false; close?.()
    })
   }
   const instance: MorphPresentation<T> = {
    id: ++serial, value,
    close: () => { if (current()) { requested = true; dispatch() } },
    bind: action => { if (current()) { close = action; dispatch() } },
    finish: () => { if (current()) reset() },
   }
   cleanup = () => { clearTimeout(task); task = undefined; requested = false; close = undefined }
   state.write(instance)
   return instance
  },
  close: (): void => state.read()?.close(),
  dispose: (): void => { active = false; reset() },
 }
}
