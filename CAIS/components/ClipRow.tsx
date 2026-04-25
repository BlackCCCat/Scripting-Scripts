import { HStack, Image, Spacer, Text, VStack } from "scripting"
import type { ClipItem } from "../types"
import { formatDateTime, summarizeContent } from "../utils/common"

function iconName(kind: ClipItem["kind"]): string {
  if (kind === "image") return "photo"
  if (kind === "url") return "link"
  return "doc.text"
}

function kindLabel(kind: ClipItem["kind"]): string {
  if (kind === "image") return "图片"
  if (kind === "url") return "链接"
  return "文本"
}

export function ClipRow(props: {
  item: ClipItem
}) {
  const item = props.item
  return (
    <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      <Image
        systemName={iconName(item.kind)}
        frame={{ width: 28 }}
        foregroundStyle={item.pinned ? "systemOrange" : "systemBlue"}
      />
      <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={5}>
        <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="headline" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {item.title}
          </Text>
          <Spacer />
          {item.favorite ? <Image systemName="star.fill" foregroundStyle="systemYellow" /> : null}
          {item.pinned ? <Image systemName="pin.fill" foregroundStyle="systemOrange" /> : null}
        </HStack>
        {item.kind === "image" && item.imagePath ? (
          <Image
            filePath={item.imagePath}
            resizable
            scaleToFit
            frame={{ width: 96, height: 64, alignment: "leading" as any }}
            clipShape={{ type: "rect", cornerRadius: 8 } as any}
          />
        ) : (
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            lineLimit={2}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {item.kind === "image" ? "图片已保存" : summarizeContent(item.content)}
          </Text>
        )}
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="caption" foregroundStyle="tertiaryLabel">{kindLabel(item.kind)}</Text>
          <Text font="caption" foregroundStyle="tertiaryLabel">{formatDateTime(item.updatedAt)}</Text>
        </HStack>
      </VStack>
    </HStack>
  )
}
