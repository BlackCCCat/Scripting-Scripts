const PIP_CONTROL_KEY = "cais_pip_control_v1"
const SHARED_OPTIONS = { shared: true }

export type PipControlState = {
  active: boolean
  command?: "start" | "stop"
  updatedAt: number
}

function getStorage(): any {
  return (globalThis as any).Storage
}

export function readPipControlState(): PipControlState {
  const st = getStorage()
  try {
    const raw = st?.get?.(PIP_CONTROL_KEY, SHARED_OPTIONS) ?? st?.getString?.(PIP_CONTROL_KEY, SHARED_OPTIONS)
    if (!raw) throw new Error("empty")
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    return {
      active: Boolean(parsed?.active),
      command: parsed?.command === "start" || parsed?.command === "stop" ? parsed.command : undefined,
      updatedAt: Number(parsed?.updatedAt ?? 0),
    }
  } catch {
    return { active: false, updatedAt: 0 }
  }
}

export function writePipControlState(patch: Partial<PipControlState>): PipControlState {
  const next: PipControlState = {
    ...readPipControlState(),
    ...patch,
    updatedAt: patch.updatedAt ?? Date.now(),
  }
  const st = getStorage()
  const raw = JSON.stringify(next)
  try {
    if (typeof st?.set === "function") {
      st.set(PIP_CONTROL_KEY, raw, SHARED_OPTIONS)
    } else {
      st?.setString?.(PIP_CONTROL_KEY, raw, SHARED_OPTIONS)
    }
  } catch {
  }
  return next
}

export function requestPipStart(): PipControlState {
  return writePipControlState({ active: true, command: "start" })
}

export function requestPipStop(): PipControlState {
  return writePipControlState({ active: false, command: "stop" })
}
