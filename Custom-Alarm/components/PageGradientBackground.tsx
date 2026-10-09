import { Device, Rectangle, TimelineCanvas, useColorScheme } from "scripting"

export function PageGradientBackground() {
  const colorScheme = useColorScheme()
  const supportsAnimatedBackground = Number.parseInt(Device.systemVersion, 10) >= 26

  if (!supportsAnimatedBackground) {
    return (
      <Rectangle
        fill={{
          light: { colors: ["#FBF8F3", "#EAF4F2", "#EDF3F8"], startPoint: "topLeading", endPoint: "bottomTrailing" },
          dark: { colors: ["#14232A", "#1B2B35", "#111D29"], startPoint: "topLeading", endPoint: "bottomTrailing" },
        }}
        ignoresSafeArea
        allowsHitTesting={false}
      />
    )
  }

  return (
    <TimelineCanvas
      schedule={{ minimumInterval: 1 / 12 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea
      allowsHitTesting={false}
      draw={(ctx, size, time) => {
        const dark = colorScheme === "dark"
        const radius = Math.max(size.width, size.height) * 0.85
        ctx.fillStyle = dark ? "#111D29" : "#FBF9F5"
        ctx.fillRect(0, 0, size.width, size.height)

        const warmX = size.width * (0.2 + 0.18 * Math.sin(time / 13))
        const warmY = size.height * (0.25 + 0.12 * Math.cos(time / 17))
        const warm = ctx.createRadialGradient(warmX, warmY, 0, warmX, warmY, radius)
        warm.addColorStop(0, dark ? "rgba(184,102,66,0.37)" : "rgba(255,185,129,0.43)")
        warm.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = warm
        ctx.fillRect(0, 0, size.width, size.height)

        const coolX = size.width * (0.8 + 0.16 * Math.cos(time / 19))
        const coolY = size.height * (0.7 + 0.13 * Math.sin(time / 15))
        const cool = ctx.createRadialGradient(coolX, coolY, 0, coolX, coolY, radius)
        cool.addColorStop(0, dark ? "rgba(41,119,132,0.32)" : "rgba(132,197,207,0.33)")
        cool.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = cool
        ctx.fillRect(0, 0, size.width, size.height)
      }}
    />
  )
}
