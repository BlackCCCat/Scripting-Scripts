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

export function isSupportedSoundFileName(name: string): boolean {
  return SUPPORTED_SOUND_EXTENSIONS.has(Path.extname(name).toLowerCase())
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

export function soundSymbolName(name: string): string {
  switch (Path.extname(name).toLowerCase()) {
    case ".mp3":
      return "music.note"
    case ".wav":
      return "waveform"
    case ".caf":
      return "speaker.wave.2.fill"
    case ".aiff":
      return "waveform.circle.fill"
    default:
      return "speaker.fill"
  }
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
    .filter(isSupportedSoundFileName)
    .sort((a: string, b: string) => a.localeCompare(b, "zh-Hans-CN"))

  return normalizeSoundNames(names)
}

export async function importSoundFile(filePath: string, options?: { overwrite?: boolean }): Promise<string> {
  const fileManager = getFileManager()
  if (!fileManager?.exists || !fileManager?.createDirectory || !fileManager?.copyFile || !fileManager?.remove) {
    throw new Error("FileManager 不可用，无法导入声音文件。")
  }

  const fileName = Path.basename(filePath).trim()
  if (!fileName || !isSupportedSoundFileName(fileName)) {
    throw new Error("请选择 .aiff、.wav、.caf 或 .mp3 声音文件。")
  }

  const soundsDir = soundsDirectoryPath()
  if (!(await fileManager.exists(soundsDir))) {
    await fileManager.createDirectory(soundsDir, true)
  }

  const destination = Path.join(soundsDir, fileName)
  if (filePath === destination) return fileName

  if ((await fileManager.exists(destination)) && !options?.overwrite) {
    throw new Error("声音文件已存在。")
  }
  if ((await fileManager.exists(destination)) && options?.overwrite) {
    await fileManager.remove(destination)
  }

  await fileManager.copyFile(filePath, destination)
  return fileName
}

export async function deleteSoundFile(name: string): Promise<void> {
  if (name === DEFAULT_SOUND_NAME) return

  const fileManager = getFileManager()
  if (!fileManager?.exists || !fileManager?.remove) {
    throw new Error("FileManager 不可用，无法删除声音文件。")
  }

  const fileName = Path.basename(name).trim()
  if (!fileName || !isSupportedSoundFileName(fileName)) return

  const filePath = Path.join(soundsDirectoryPath(), fileName)
  if (await fileManager.exists(filePath)) {
    await fileManager.remove(filePath)
  }
}

export async function renameSoundFile(name: string, nextDisplayName: string): Promise<string> {
  if (name === DEFAULT_SOUND_NAME) return DEFAULT_SOUND_NAME

  const fileManager = getFileManager()
  if (!fileManager?.exists || !fileManager?.rename) {
    throw new Error("FileManager 不可用，无法重命名声音文件。")
  }

  const fileName = Path.basename(name).trim()
  const ext = Path.extname(fileName)
  const nextBaseName = Path.basename(nextDisplayName).trim()
  const typedExt = Path.extname(nextBaseName)
  const cleanBaseName = (typedExt ? nextBaseName.slice(0, -typedExt.length) : nextBaseName).trim()

  if (!fileName || !isSupportedSoundFileName(fileName)) return name
  if (!cleanBaseName) throw new Error("请输入声音名称。")
  if (cleanBaseName === DEFAULT_SOUND_NAME) throw new Error("不能使用默认声音名称。")

  const nextName = `${cleanBaseName}${ext}`
  if (nextName === fileName) return fileName

  const soundsDir = soundsDirectoryPath()
  const currentPath = Path.join(soundsDir, fileName)
  const nextPath = Path.join(soundsDir, nextName)

  if (!(await fileManager.exists(currentPath))) {
    throw new Error("声音文件不存在。")
  }
  if (await fileManager.exists(nextPath)) {
    throw new Error("声音文件已存在。")
  }

  await fileManager.rename(currentPath, nextPath)
  return nextName
}
