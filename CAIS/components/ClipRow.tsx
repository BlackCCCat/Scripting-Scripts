import { GeometryReader, HStack, Image, Spacer, Text, VStack, ZStack, useColorScheme, useMemo, useRef, useState } from "scripting"
import type { ClipItem, LinkPreview } from "../types"
import { clipTitle, formatDateTime, summarizeContent } from "../utils/common"
import { imageListPreviewPath } from "../storage/image_store"
import { displayFavoriteFieldsContent, displayFavoriteItemTitle, favoriteDelimiterForItem, isFieldFavorite, privateRulesForItem, type PrivateFieldRule } from "../utils/favorite_fields"
import { linkPreviewFresh, requestLinkPreview } from "../services/link_preview"
import { previewableWebUrl } from "../utils/link_preview"

const IMAGE_PREVIEW_HEIGHT = 180
const failedLinkIcons = new Set<string>()

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
  displayTimestamp?: number
  favoriteView?: boolean
  privateKeywords: PrivateFieldRule[]
  favoriteFieldDelimiter: string
}) {
  const item = props.item
  const [preview, setPreview] = useState<LinkPreview | undefined>(item.linkPreview)
  const [iconFailed, setIconFailed] = useState(false)
  const currentPreview = preview ?? item.linkPreview
  const visible = useRef(false)
  const webUrl = item.kind === "url" ? previewableWebUrl(item.content) : null
  const defaultTitle = item.title === clipTitle(item.kind, item.content)
  const fieldDelimiter = favoriteDelimiterForItem(item, props.favoriteFieldDelimiter)
  const privateRules = privateRulesForItem(item, props.privateKeywords)
  const pinned = props.favoriteView ? item.favoritePinned : item.pinned
  const displayedAt = props.displayTimestamp ?? item.updatedAt
  const timestampText = useMemo(() => formatDateTime(displayedAt), [displayedAt])
  const displayContent = isFieldFavorite(item)
    ? displayFavoriteFieldsContent(item.content, fieldDelimiter, privateRules)
    : item.content
  return (
    <>
      {item.kind === "url" && currentPreview?.iconUrl && !iconFailed && !failedLinkIcons.has(currentPreview.iconUrl) ? (
        <Image
          imageUrl={currentPreview.iconUrl}
          placeholder={<Image systemName="link" foregroundStyle={pinned ? "systemOrange" : "systemBlue"} />}
          onError={() => {
            if (currentPreview.iconUrl) failedLinkIcons.add(currentPreview.iconUrl)
            setIconFailed(true)
          }}
          resizable
          scaleToFit
          frame={{ width: 28, height: 28, alignment: "center" as any }}
        />
      ) : (
        <Image
          systemName={iconName(item)}
          frame={{ width: 28, maxHeight: "infinity", alignment: "center" as any }}
          foregroundStyle={pinned ? "systemOrange" : "systemBlue"}
        />
      )}
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        spacing={5}
        onAppear={() => {
          visible.current = true
          if (!webUrl || linkPreviewFresh(currentPreview)) return
          void requestLinkPreview(item.content).then((result) => {
            if (visible.current) setPreview(result ?? { title: "", summary: "", fetchedAt: 0 })
          })
        }}
        onDisappear={() => { visible.current = false }}
      >
        <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="headline" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {item.kind === "url" && defaultTitle
              ? currentPreview?.title || webUrl?.hostname || "链接"
              : displayFavoriteItemTitle(item, fieldDelimiter, privateRules)}
          </Text>
          <Spacer />
          {item.favorite ? <Image systemName="star.fill" foregroundStyle="systemYellow" /> : null}
          {pinned ? <Image systemName="pin.fill" foregroundStyle="systemOrange" /> : null}
        </HStack>
        {props.previewPath ? (
          <ZStack
            frame={{ maxWidth: "infinity", height: IMAGE_PREVIEW_HEIGHT }}
            clipShape={{ type: "rect", cornerRadius: 10 } as any}
            clipped
          >
            <GeometryReader frame={{ maxWidth: "infinity", height: IMAGE_PREVIEW_HEIGHT }}>
              {(proxy) => <Image
                filePath={props.previewPath!}
                resizable
                scaleToFill
                frame={{ width: proxy.size.width, height: IMAGE_PREVIEW_HEIGHT, alignment: "center" as any }}
                clipped
              />}
            </GeometryReader>
          </ZStack>
        ) : item.kind === "url" ? (
          <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              {item.content}
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={props.lineLimit} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">
              {currentPreview?.summary || (currentPreview?.title
                ? "网页未提供摘要"
                : currentPreview?.fetchedAt === 0
                  ? "稍后重试网页预览"
                  : currentPreview
                    ? "网页预览不可用"
                    : webUrl ? "正在获取网页信息" : "此链接不支持网页预览")}
            </Text>
          </VStack>
        ) : (
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            lineLimit={props.lineLimit}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {item.kind === "image" ? "图片已保存" : summarizeContent(displayContent, Math.max(140, props.lineLimit * 90))}
          </Text>
        )}
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="caption" foregroundStyle="tertiaryLabel">{kindLabel(item)}</Text>
          <Text font="caption" foregroundStyle="tertiaryLabel">
            {timestampText}
          </Text>
        </HStack>
      </VStack>
    </>
  )
}

export function NonGlassClipRow(props: {
  item: ClipItem
  privateKeywords: PrivateFieldRule[]
  favoriteFieldDelimiter: string
  contentLineLimit: number
  displayTimestamp?: number
  favoriteView?: boolean
  onTap?: () => void
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
      contentShape={{ kind: "interaction", shape: { type: "rect", cornerRadius: 18 } } as any}
      onTapGesture={props.onTap}
      background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
      shadow={{
        color: colorScheme === "dark" ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.07)",
        radius: 10,
        y: 4,
      }}
    >
      <ClipRowContent key={item.contentHash} item={item} lineLimit={lineLimit} previewPath={previewPath} displayTimestamp={props.displayTimestamp} favoriteView={props.favoriteView} privateKeywords={props.privateKeywords} favoriteFieldDelimiter={props.favoriteFieldDelimiter} />
    </HStack>
  )
}

export function ClipRow(props: {
  item: ClipItem
  privateKeywords: PrivateFieldRule[]
  favoriteFieldDelimiter: string
  contentLineLimit: number
  displayTimestamp?: number
  favoriteView?: boolean
  onTap?: () => void
}) {
  const item = props.item
  const lineLimit = Math.max(1, props.contentLineLimit)
  const previewPath = item.kind === "image" ? imageListPreviewPath(item.imagePath) : undefined
  return (
    <HStack
      spacing={12}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      contentShape={{ kind: "interaction", shape: { type: "rect", cornerRadius: 18 } } as any}
      onTapGesture={props.onTap}
      glassEffect={{ type: "rect", cornerRadius: 18 } as any}
    >
      <ClipRowContent key={item.contentHash} item={item} lineLimit={lineLimit} previewPath={previewPath} displayTimestamp={props.displayTimestamp} favoriteView={props.favoriteView} privateKeywords={props.privateKeywords} favoriteFieldDelimiter={props.favoriteFieldDelimiter} />
    </HStack>
  )
}
