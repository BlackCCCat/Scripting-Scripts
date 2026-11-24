import { createContext, useContext, useEffect, useMemo, useRef, useState } from "scripting"
import { remainingQuotaColor } from "./theme"

export const DashboardAnimationContext = createContext<{ active: boolean; visit: number }>()

const frameInterval = 16
const duration = 448
const progressFirstSegment = 32
const progressInterval = (duration - progressFirstSegment) / 4
const updatesPerFrame = 4

type Motion = "native" | "wallet" | "counter" | "wholeNumber" | "palette" | "progress"

interface PendingUpdate {
  nextAt: number
  startedAt?: number
  update: (now: number) => boolean
}

// Keep the overview wallet counters ahead of the other ready views.
const walletUpdates = new Set<PendingUpdate>()
const progressUpdates = new Set<PendingUpdate>()
const otherUpdates = new Set<PendingUpdate>()
const queues = [walletUpdates, progressUpdates, otherUpdates]
let timer: number | undefined
let scheduledAt = Infinity
let lastFrameAt = -Infinity
let running = false
const animations = new Map<number, Animation>()

function linearAnimation(milliseconds: number) {
  let animation = animations.get(milliseconds)
  if (animation === undefined) {
    animation = Animation.linear(milliseconds / 1000)
    animations.set(milliseconds, animation)
  }
  return animation
}

function scheduleAt(time: number) {
  if (running) return

  const nextAt = Math.max(time, lastFrameAt + frameInterval)
  if (nextAt === scheduledAt) return
  if (timer !== undefined) clearTimeout(timer)
  scheduledAt = nextAt
  timer = Number.isFinite(nextAt) ? setTimeout(runFrame, Math.max(0, nextAt - Date.now())) : undefined
}

function runFrame() {
  timer = undefined
  scheduledAt = Infinity
  const now = Date.now()
  lastFrameAt = now
  running = true
  try {
    const ready = new Map<PendingUpdate, Set<PendingUpdate>>()
    const collectReady = (queue: Set<PendingUpdate>, limit = updatesPerFrame, movingOnly = false) => {
      for (const entry of queue) {
        if (ready.size === limit) break
        if (entry.nextAt <= now && (!movingOnly || entry.startedAt !== undefined)) ready.set(entry, queue)
      }
    }
    collectReady(walletUpdates)
    const progressLimit = ready.size + Math.ceil((updatesPerFrame - ready.size) / 2)
    // Give the progress bars a share of the budget and finish moving bars first.
    collectReady(progressUpdates, progressLimit, true)
    collectReady(progressUpdates, progressLimit)
    collectReady(otherUpdates)
    collectReady(progressUpdates)
    for (const [entry, queue] of ready) {
      if (!queue.has(entry)) continue
      let keep = false
      try {
        keep = entry.update(now)
      } finally {
        // Ready views take turns within their queue.
        if (queue.delete(entry) && keep) queue.add(entry)
      }
    }
  } finally {
    running = false
    let nextAt = Infinity
    for (const queue of queues) {
      for (const entry of queue) nextAt = Math.min(nextAt, entry.nextAt)
    }
    scheduleAt(nextAt)
  }
}

function enqueue(entry: PendingUpdate, motion: Motion) {
  const queue = motion === "wallet" ? walletUpdates : motion === "progress" ? progressUpdates : otherUpdates
  queue.add(entry)
  if (entry.nextAt < scheduledAt) scheduleAt(entry.nextAt)
  return () => {
    if (queue.delete(entry) && queues.every(queue => queue.size === 0)) scheduleAt(Infinity)
  }
}

function progressSampleAt(elapsed: number) {
  if (elapsed < progressFirstSegment) return progressFirstSegment
  const segment = Math.floor((elapsed - progressFirstSegment) / progressInterval) + 1
  return Math.min(duration, progressFirstSegment + segment * progressInterval)
}

type Metrics<Key extends string> = Partial<Record<Key, number>>

interface Frame<Key extends string> {
  visit: number
  values: Metrics<Key>
  decreasing: ReadonlySet<Key>
  transitionMs?: number
}

export function useDashboardMetricAnimation<Key extends string>(
  targets: Partial<Record<Key, number | null | undefined>>,
  motion: Motion = "native",
  options?: {
    paletteKey?: (values: Metrics<Key>) => string
    inViewport?: boolean
    animateOnMount?: boolean
  }
) {
  const { paletteKey, inViewport, animateOnMount = true } = options ?? {}
  const { active, visit } = useContext(DashboardAnimationContext)
  const [appearance, setAppearance] = useState<object | null>(null)
  const [frame, setFrame] = useState<Frame<Key> | null>(null)
  const latestFrame = useRef(frame)
  const isVisible = useRef(false)
  const wasInViewport = useRef(inViewport === true && animateOnMount)
  const cancel = useRef<(() => void) | undefined>(undefined)
  const lifecycle = useMemo(() => ({
    onAppear: () => {
      if (isVisible.current) return
      isVisible.current = true
      setAppearance({})
    },
    onDisappear: () => {
      if (!isVisible.current) return
      isVisible.current = false
      cancel.current?.()
      setAppearance(null)
    },
  }), [])
  const signature = JSON.stringify(targets)
  const visible = inViewport ?? (appearance !== null)
  const useTarget = inViewport !== undefined && (!inViewport || !wasInViewport.current)

  useEffect(() => {
    if (inViewport === false) {
      wasInViewport.current = false
      return
    }
    if (!active || !visible || (inViewport === undefined && !isVisible.current)) return

    const previous: Metrics<Key> = latestFrame.current?.visit === visit ? latestFrame.current.values : {}
    const end: Metrics<Key> = {}
    const moving: { key: Key; from: number; delta: number }[] = []
    const decreasing = new Set<Key>()
    for (const key of Object.keys(targets) as Key[]) {
      const target = targets[key]
      if (typeof target !== "number" || !Number.isFinite(target)) continue
      const to = motion === "wholeNumber" ? Math.round(target) : target
      end[key] = to
      const from = previous[key] ?? 0
      const delta = to - from
      if (delta === 0) continue
      moving.push({ key, from, delta })
      if (delta < 0) decreasing.add(key)
    }
    const removed = (Object.keys(previous) as Key[]).some(key => end[key] === undefined)
    const publish = (values: Metrics<Key>, transitionMs?: number) => {
      const next = { visit, values, decreasing, transitionMs }
      latestFrame.current = next
      setFrame(next)
    }

    // An incoming column already shows its target. Use that as the next refresh's baseline.
    if (inViewport && !wasInViewport.current) {
      wasInViewport.current = true
      publish(end, 0)
      return
    }
    if (moving.length === 0 && !removed) return

    // Give the replay's zero values a render before submitting targets.
    const start = Date.now() + frameInterval
    const interval = motion === "wallet" ? 32 : 64
    const direct = motion === "native" || moving.length === 0
    let last = previous
    let lastPalette = paletteKey?.(previous)
    const finalPalette = paletteKey?.(end)
    const entry: PendingUpdate = {
      // Sampled counters skip the sample at elapsed zero.
      nextAt: direct || removed || motion === "progress" ? start : start + interval,
      update(now) {
        if (inViewport === undefined && !isVisible.current) return false
        const dropPreviousKeys = removed && last === previous
        if (motion === "progress") entry.startedAt ??= now
        const elapsed = now - (entry.startedAt ?? start)
        if (direct || elapsed >= duration) {
          if (paletteKey && !dropPreviousKeys && lastPalette === finalPalette) {
            latestFrame.current = { visit, values: end, decreasing }
          } else if (dropPreviousKeys || moving.some(({ key }) => last[key] !== end[key])) {
            publish(end, motion === "progress" ? progressInterval : undefined)
          }
          return false
        }

        // Native progress animates toward the next sample while JavaScript waits.
        const progressEnd = motion === "progress" ? progressSampleAt(elapsed) : undefined
        const transitionMs = progressEnd === undefined ? undefined : progressEnd - elapsed
        entry.nextAt = now + (transitionMs ?? Math.min(interval, duration - elapsed))
        const linear = (progressEnd ?? elapsed) / duration
        const fraction = motion === "wallet" || motion === "counter"
          ? linear + 0.35 * linear * (1 - linear)
          : linear
        const values = progressEnd === duration ? end : { ...end }
        if (values !== end) {
          for (const { key, from, delta } of moving) {
            const value = from + delta * fraction
            values[key] = motion === "wholeNumber" ? Math.round(value) : value
          }
        }
        if (paletteKey) {
          const palette = paletteKey(values)
          if (palette === lastPalette && !dropPreviousKeys) return true
          lastPalette = palette
        } else if (!dropPreviousKeys && moving.every(({ key }) => values[key] === (last[key] ?? 0))) {
          return progressEnd !== duration
        }
        last = values
        publish(values, transitionMs)
        return progressEnd !== duration
      },
    }
    const stop = enqueue(entry, motion)
    cancel.current = stop
    return () => {
      stop()
      if (cancel.current === stop) cancel.current = undefined
    }
  }, [active, appearance, visit, signature, motion, paletteKey, inViewport])

  const current = frame?.visit === visit ? frame : null
  const value = (key: Key) => {
    if (!useTarget) return current?.values[key] ?? 0
    const target = targets[key]
    if (typeof target !== "number" || !Number.isFinite(target)) return 0
    return motion === "wholeNumber" ? Math.round(target) : target
  }
  const animation = linearAnimation(!active || !visible || !current || useTarget
    ? 0
    : current.transitionMs ?? (motion === "palette" ? 100 : duration))
  return {
    value,
    lifecycle,
    animate: (key: Key) => ({ animation, value: value(key) }),
    rollingText: (key: Key, text: string) => ({
      contentTransition: current?.decreasing.has(key)
        ? "numericTextCountsDown" as const
        : "numericTextCountsUp" as const,
      animation: { animation, value: text },
    }),
  }
}

export function dashboardQuotaColor(percentage: number, target: number, isExhausted?: boolean) {
  if (percentage === target) return remainingQuotaColor(percentage, isExhausted)
  return percentage <= 0 ? "#FF3B30" : remainingQuotaColor(percentage)
}
