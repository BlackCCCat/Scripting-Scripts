export type StateSource<T> = {
  read: () => T
  subscribe: (notify: () => void) => () => void
}

// 只订阅所需字段；原状态的其他字段变化不进入组件更新队列。
export const selectStateSource = <T, Value>(source: StateSource<T>, select: (value: T) => Value, equal: (previous: Value, next: Value) => boolean = Object.is): StateSource<Value> => {
  let snapshot = select(source.read())
  // 多字段投影也保留稳定快照；无关字段变化既不通知，也不改变读取身份。
  const read = (): Value => {
    const next = select(source.read())
    if (!equal(snapshot, next)) snapshot = next
    return snapshot
  }
  return { read,
    subscribe: notify => {
      let previous = read()
      return source.subscribe(() => {
        const next = read()
        if (Object.is(previous, next)) return
        previous = next
        notify()
      })
    },
  }
}

// 每个工作区自行创建 bus；固定本轮监听快照，重订阅不会延长派发循环。
export const createEventBus = <Key extends string | symbol>() => {
  const listeners = new Map<Key, Set<() => void>>()
  const subscribe = (key: Key, notify: () => void): (() => void) => {
    const group = listeners.get(key) ?? new Set<() => void>()
    group.add(notify)
    listeners.set(key, group)
    return () => {
      group.delete(notify)
      if (!group.size && listeners.get(key) === group) listeners.delete(key)
    }
  }
  const emit = (key: Key): void => {
    const current = [...(listeners.get(key) ?? [])]
    current.forEach(notify => notify())
  }
  return { subscribe, emit }
}

export const createStateSource = <T,>(initial: T) => {
  const bus = createEventBus<"change">()
  let snapshot = initial
  const read = (): T => snapshot
  const write = (next: T): void => {
    if (Object.is(snapshot, next)) return
    snapshot = next
    bus.emit("change")
  }
  const subscribe = (notify: () => void): (() => void) => bus.subscribe("change", notify)
  return { read, subscribe, write }
}
