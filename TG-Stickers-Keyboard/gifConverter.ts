function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function commandLine(args: string[]): string {
  const [command, ...rest] = args
  return [command, ...rest.map(shellQuote)].join(" ")
}

export async function convertWebmToGif(sourcePath: string, targetPath: string): Promise<string> {
  if (await FileManager.exists(targetPath)) return targetPath

  const filter = [
    "fps=12,scale=256:256:force_original_aspect_ratio=decrease:flags=lanczos,split[s0][s1]",
    "[s0]palettegen=max_colors=128:reserve_transparent=1[p]",
    "[s1][p]paletteuse=dither=sierra2_4a:alpha_threshold=128",
  ].join(";")
  const result = await Shell.run(commandLine([
    "ffmpeg",
    "-nostdin",
    "-y",
    "-i",
    sourcePath,
    "-filter_complex",
    filter,
    "-loop",
    "0",
    targetPath,
  ]), { timeout: 180 })

  if (result.exitCode !== 0 || !(await FileManager.exists(targetPath))) {
    try {
      if (await FileManager.exists(targetPath)) await FileManager.remove(targetPath)
    } catch {}
    const detail = result.output.trim().split("\n").slice(-2).join(" ")
    throw new Error(detail ? `动态贴纸转换失败：${detail}` : "动态贴纸转换失败")
  }

  return targetPath
}
