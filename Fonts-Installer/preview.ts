import type { FontInfo } from "./font"

export type FontPreviewHTMLOptions = {
  embedded?: boolean
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function createFontPreviewHTML(
  info: FontInfo,
  fontData: Data,
  options: FontPreviewHTMLOptions = {},
): string {
  const mimeType = info.format === "OpenType" ? "font/otf" : "font/ttf"
  const fontURL = `data:${mimeType};base64,${fontData.toBase64String()}`
  const title = escapeHTML(info.fullName)
  const family = escapeHTML(info.familyName)
  const postScriptName = escapeHTML(info.postScriptName)
  const bodyPadding = options.embedded
    ? "18px 16px calc(env(safe-area-inset-bottom, 0px) + 18px)"
    : "calc(env(safe-area-inset-top, 0px) + 72px) 20px calc(env(safe-area-inset-bottom, 0px) + 44px)"

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <style>
    @font-face { font-family: "ImportedFont"; src: url("${fontURL}"); }
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { touch-action: pan-y; -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      padding: ${bodyPadding};
      background: #f6f7fb;
      color: #172033;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .heading { margin: 0 2px 22px; }
    .title { font-size: 26px; line-height: 1.2; font-weight: 700; overflow-wrap: anywhere; }
    .meta { color: #687086; font-size: 14px; line-height: 1.5; margin-top: 7px; }
    .specimen {
      font-family: "ImportedFont", sans-serif;
      background: white;
      border: 1px solid rgba(23,32,51,.09);
      border-radius: 22px;
      padding: 24px;
      box-shadow: 0 14px 40px rgba(32,45,80,.08);
    }
    .display { font-size: 58px; line-height: 1.05; margin-bottom: 26px; overflow-wrap: anywhere; }
    .sample { font-size: 28px; line-height: 1.45; margin: 18px 0; overflow-wrap: anywhere; }
    .glyphs { font-size: 20px; line-height: 1.7; letter-spacing: .03em; overflow-wrap: anywhere; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1020; color: #f5f7ff; }
      .meta { color: #b8c2d8; }
      .specimen { background: #171f31; border-color: rgba(245,247,255,.12); box-shadow: none; }
    }
  </style>
</head>
<body>
  <header class="heading">
    <div class="title">${title}</div>
    <div class="meta">${family} · ${postScriptName}</div>
  </header>
  <main class="specimen">
    <div class="display">字体预览 Aa</div>
    <div class="sample">天地玄黄，宇宙洪荒。<br>春风又绿江南岸。</div>
    <div class="sample">The quick brown fox jumps over the lazy dog.</div>
    <div class="glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789<br>.,:;!? @ # ¥ $ % &amp; ( ) [ ] { }</div>
  </main>
</body>
</html>`
}

export async function presentFontPreview(info: FontInfo, fontData: Data): Promise<void> {
  const webView = new WebViewController({ ephemeral: true })
  const html = createFontPreviewHTML(info, fontData)

  try {
    const loaded = await webView.loadHTML(html)
    if (!loaded) throw new Error("无法载入字体预览。")
    await webView.present({ fullscreen: false, navigationTitle: "字体预览" })
  } finally {
    webView.dispose()
  }
}
