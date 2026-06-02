import { Path } from "scripting"

export const DEFAULT_SOUND_NAME = "Default"
const SUPPORTED_SOUND_EXTENSIONS = new Set([".aiff", ".wav", ".caf", ".mp3"])

export function soundsDirectoryPath(): string {
  const fileManager = getFileManager()
  return Path.join(
    fileManager?.documentsDirectory || "",
    "../Library/Sounds"
  )
}

function getFileManager(): any {
  return (globalThis as any).FileManager
}

export function normalizeSoundNames(names: string[]): string[] {
  const seen = new Set<string>()
  const result = [DEFAULT_SOUND_NAME]

  for (const name of names) {
    const trimmed = String(name ?? "").trim()
    if (!trimmed || trimmed === DEFAULT_SOUND_NAME || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

export function soundDisplayName(name: string): string {
  if (name === DEFAULT_SOUND_NAME) return DEFAULT_SOUND_NAME
  const ext = Path.extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

export async function loadAvailableSoundNames(): Promise<string[]> {
  const soundsDir = soundsDirectoryPath()
  const fileManager = getFileManager()
  if (!fileManager?.exists || !fileManager?.readDirectory) return [DEFAULT_SOUND_NAME]

  const exists = await fileManager.exists(soundsDir)
  if (!exists) return [DEFAULT_SOUND_NAME]

  const entries = await fileManager.readDirectory(soundsDir, false)
  const names = entries
    .map((entry: string) => Path.basename(entry))
    .filter((name: string) => SUPPORTED_SOUND_EXTENSIONS.has(Path.extname(name).toLowerCase()))
    .sort((a: string, b: string) => a.localeCompare(b, "zh-Hans-CN"))

  return normalizeSoundNames(names)
}
