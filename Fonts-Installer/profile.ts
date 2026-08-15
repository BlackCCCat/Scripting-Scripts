import type { FontInfo } from "./font"

export type InstallResult = {
  opened: boolean
  profileName: string
}

const PROFILE_MIME_TYPE = "application/x-apple-aspen-config"
const DELIVERY_TIMEOUT_MS = 15_000
const RESPONSE_FLUSH_GRACE_MS = 800

function escapeXML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function identifierPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || UUID.string().toLowerCase()
}

export function createFontProfile(info: FontInfo, fontData: Data): string {
  const profileUUID = UUID.string().toUpperCase()
  const fontUUID = UUID.string().toUpperCase()
  const identifier = identifierPart(info.postScriptName)
  const displayName = `Font: ${info.fullName}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>Font</key>
      <data>${fontData.toBase64String()}</data>
      <key>Name</key>
      <string>${escapeXML(info.fullName)}</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXML(info.fullName)}</string>
      <key>PayloadIdentifier</key>
      <string>com.blackcccat.fonts-installer.font.${identifier}</string>
      <key>PayloadType</key>
      <string>com.apple.font</string>
      <key>PayloadUUID</key>
      <string>${fontUUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Makes the selected font available to supported iOS applications.</string>
  <key>PayloadDisplayName</key>
  <string>${escapeXML(displayName)}</string>
  <key>PayloadIdentifier</key>
  <string>com.blackcccat.fonts-installer.profile.${identifier}.${profileUUID.toLowerCase()}</string>
  <key>PayloadOrganization</key>
  <string>Fonts Installer</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUUID}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function openFontInstaller(info: FontInfo, fontData: Data): Promise<InstallResult> {
  const profile = createFontProfile(info, fontData)
  const profileData = Data.fromRawString(profile, "utf-8")
  if (!profileData) throw new Error("无法生成字体配置描述文件。")

  if (typeof HttpServer !== "function") {
    throw new Error("当前 Scripting 版本不支持本地描述文件服务，请更新 Scripting 后重试。")
  }

  const server = new HttpServer()
  const route = `/${UUID.string().replace(/-/g, "").toLowerCase()}.mobileconfig`
  const downloadName = `font-${identifierPart(info.postScriptName)}.mobileconfig`
  let started = false
  let markDelivered: () => void = () => {}
  let deliveryTimeout: number | null = null
  const delivered = new Promise<void>((resolve, reject) => {
    deliveryTimeout = setTimeout(() => reject(new Error("Safari 未能读取字体描述文件，请重试。")), DELIVERY_TIMEOUT_MS)
    markDelivered = () => {
      if (deliveryTimeout != null) clearTimeout(deliveryTimeout)
      deliveryTimeout = null
      resolve()
    }
  })

  server.listenAddressIPv4 = "127.0.0.1"
  server.registerAsyncHandler(route, async () => {
    setTimeout(markDelivered, 250)
    return HttpResponse.raw(200, "OK", {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": String(profileData.size),
        "Content-Type": PROFILE_MIME_TYPE,
        "X-Content-Type-Options": "nosniff",
      },
      body: profileData,
    })
  })

  try {
    const startError = server.start({ port: 0, forceIPv4: true })
    if (startError || server.port == null) {
      throw new Error(`无法启动本地描述文件服务${startError ? `：${startError}` : "。"}`)
    }
    started = true

    const url = `http://127.0.0.1:${server.port}${route}`
    const opened = await Safari.openURL(url)
    if (!opened) throw new Error("系统未能打开字体描述文件下载页面。")

    await delivered
    await wait(RESPONSE_FLUSH_GRACE_MS)
    return { opened, profileName: `Font: ${info.fullName}` }
  } finally {
    if (deliveryTimeout != null) clearTimeout(deliveryTimeout)
    if (started) server.stop()
  }
}
