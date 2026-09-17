import { HStack, Rectangle, Text, ZStack, useEffect, useObservable, useState } from "scripting"

const LETTERS = ["C", "A", "I", "S"]
const FONT_DESIGNS = ["default", "rounded", "serif", "monospaced"] as const
const FONT_WEIGHTS = ["semibold", "bold", "heavy", "black"] as const
const COLORS = ["systemBlue", "systemIndigo", "systemPurple", "systemPink", "systemTeal", "systemRed"] as const

function randomChoice<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]
}

export function LaunchSplash(props: { onFinished: () => void }) {
  const visible = useObservable(true)
  const [appearance] = useState(() => {
    const color = randomChoice(COLORS)
    const multicolor = Math.random() < 0.6
    return {
      design: randomChoice(FONT_DESIGNS),
      weight: randomChoice(FONT_WEIGHTS),
      colors: LETTERS.map(() => multicolor ? randomChoice(COLORS) : color),
    }
  })

  useEffect(() => {
    let cancelled = false
    const fadeTimer = setTimeout(() => {
      // Remove the material only after the native fade has actually finished.
      void withAnimation(Animation.easeOut(0.55), "removed", () => {
        visible.setValue(false)
      }).then(() => {
        if (!cancelled) props.onFinished()
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(fadeTimer)
    }
  }, [])

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={{ regions: "container", edges: "all" }}
      opacity={visible.value ? 1 : 0}
    >
      <Rectangle fill="thickMaterial" />
      <Rectangle fill={{ color: "systemBackground", opacity: 0.85 }} />
      <HStack spacing={0} accessibilityLabel="CAIS">
        {LETTERS.map((letter, index) => (
          <Text
            key={letter}
            font={44}
            fontDesign={appearance.design}
            fontWeight={appearance.weight}
            foregroundStyle={appearance.colors[index]}
            lineLimit={1}
          >
            {letter}
          </Text>
        ))}
      </HStack>
    </ZStack>
  )
}
