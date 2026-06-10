let minimizeRequested = false

export function markMinimizeRequested(): void {
  minimizeRequested = true
}

export function clearMinimizeRequested(): void {
  minimizeRequested = false
}

export function shouldResumeFromMinimize(): boolean {
  return minimizeRequested
}
