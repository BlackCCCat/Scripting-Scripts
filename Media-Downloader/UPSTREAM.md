# Upstream References

## yoinks

- Repository: https://github.com/pablostanley/yoinks
- License: MIT
- Reference files:
  - `src/lib/platforms.ts` for public media platform detection.
  - `src/lib/ytdlp.ts` for probe-first format selection and progress shape.
  - `src/lib/format.ts` for byte, speed, and ETA presentation ideas.

Media Downloader does not depend on the yoinks npm package. yoinks is a Node terminal app that uses Ink and `child_process`, while this project runs inside Scripting and uses the Scripting UI, Python `yt_dlp`, and Scripting `Shell.run` for FFmpeg.

When following upstream updates, compare only the pure download logic:

1. Platform host detection.
2. Format scoring and choice generation.
3. Progress fields and partial-file cleanup behavior.
4. Any new yt-dlp flags that are compatible with Scripting's Python runner.

Do not port terminal UI, npm install flow, standalone binary management, or direct Node process lifecycle code.

## Scripting media-download skill

- Repository: https://github.com/ScriptingApp/skills/tree/main/media-download

Use this as the stronger runtime model for Scripting:

1. Keep remote titles and URLs out of shell syntax except through quoted command arguments.
2. Download into temporary job paths before promoting final files.
3. Let Python/yt-dlp acquire media and let Scripting/FFmpeg finalize media.
4. Verify final files where possible before inserting history or running post-download actions.
