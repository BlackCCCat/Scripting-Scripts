import { HStack, Image, Spacer, Text, VStack, useColorScheme } from "scripting"
import type { ClipItem } from "../types"
import { formatDateTime, summarizeContent } from "../utils/common"
import { imageListPreviewPath } from "../storage/image_store"

const IMAGE_PREVIEW_HEIGHT = 180

function iconName(item: ClipItem): string {
  if (item.favoriteFormat === "fields") return "list.bullet.rectangle"
  if (item.kind === "image") return "photo"
  if (item.kind === "url") return "link"
  return "doc.text"
}

function kindLabel(item: ClipItem): string {
  if (item.favoriteFormat === "fields") return "字段收藏"
  if (item.kind === "image") return "图片"
  if (item.kind === "url") return "链接"
  return "文本"
}

function ClipRowContent(props: {
  item: ClipItem
  lineLimit: number
  previewPath?: string
}) {
  const item = props.item
  return (
    <>
      <Image
        systemName={iconName(item)}
        frame={{ width: 28, maxHeight: "infinity", alignment: "center" as any }}
        foregroundStyle={item.pinned ? "systemOrange" : "systemBlue"}
      />
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        spacing={5}
      >
        <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="headline" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {item.title}
          </Text>
          <Spacer />
          {item.favorite ? <Image systemName="star.fill" foregroundStyle="systemYellow" /> : null}
          {item.pinned ? <Image systemName="pin.fill" foregroundStyle="systemOrange" /> : null}
        </HStack>
        {props.previewPath ? (
          <Image
            filePath={props.previewPath}
            resizable
            scaleToFill
            frame={{ maxWidth: "infinity", height: IMAGE_PREVIEW_HEIGHT, alignment: "center" as any }}
            clipShape={{ type: "rect", cornerRadius: 10 } as any}
            clipped
          />
        ) : (
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            lineLimit={props.lineLimit}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {item.kind === "image" ? "图片已保存" : summarizeContent(item.content, Math.max(140, props.lineLimit * 90))}
          </Text>
        )}
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="caption" foregroundStyle="tertiaryLabel">{kindLabel(item)}</Text>
          <Text font="caption" foregroundStyle="tertiaryLabel">{formatDateTime(item.updatedAt)}</Text>
        </HStack>
      </VStack>
    </>
  )
}

export function NonGlassClipRow(props: {
  item: ClipItem
  contentLineLimit: number
}) {
  const item = props.item
  const lineLimit = Math.max(1, props.contentLineLimit)
  const previewPath = item.kind === "image" ? imageListPreviewPath(item.imagePath) : undefined
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"

  return (
    <HStack
      spacing={12}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
      shadow={{
        color: colorScheme === "dark" ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.07)",
        radius: 10,
        y: 4,
      }}
    >
      <ClipRowContent item={item} lineLimit={lineLimit} previewPath={previewPath} />
    </HStack>
  )
}

export function ClipRow(props: {
  item: ClipItem
  contentLineLimit: number
}) {
  const item = props.item
  const lineLimit = Math.max(1, props.contentLineLimit)
  const previewPath = item.kind === "image" ? imageListPreviewPath(item.imagePath) : undefined

  return (
    <HStack
      spacing={12}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      glassEffect={{ type: "rect", cornerRadius: 18 } as any}
    >
      <ClipRowContent item={item} lineLimit={lineLimit} previewPath={previewPath} />
    </HStack>
  )
}
