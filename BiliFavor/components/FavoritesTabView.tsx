import {
  Button,
  EmptyView,
  Group,
  HStack,
  Image,
  LazyVGrid,
  List,
  NavigationStack,
  ProgressView,
  ScrollView,
  Section,
  Text,
  useState,
  VStack,
  ZStack,
} from "scripting"

import { FavoriteAuthorsManagerView } from "./FavoriteAuthorsManagerView"
import { InlineVideoPlayerPage, stopActiveInlinePlayback } from "./InlineVideoPlayerPage"
import { CompactVideoCoverImage, VideoCardBackground, VideoCoverImage, useVideoCoverArtwork } from "./VideoCoverArtwork"
import type {
  BiliAuthSession,
  BiliCardLayoutMode,
  BiliFavoriteAuthor,
  BiliPlaybackMode,
  VideoDynamicItem,
} from "../types"

const DOUBLE_CARD_COLUMNS = [
  { size: { type: "flexible" as const, min: 0, max: 192 }, spacing: 12 },
  { size: { type: "flexible" as const, min: 0, max: 192 } },
]

function compactMetaText(item: VideoDynamicItem): string {
  return `播放 ${item.playText} · ${item.publishedLabel || "刚刚"}`
}

async function openExternalUrl(url: string): Promise<void> {
  const target = String(url ?? "").trim()
  if (!target) return

  const runtimeSafari = (globalThis as any).Safari
  if (runtimeSafari?.openURL) {
    const ok = await runtimeSafari.openURL(target)
    if (ok) return
  }
  if (runtimeSafari?.open) {
    const ok = await runtimeSafari.open(target)
    if (ok !== false) return
  }
  if (runtimeSafari?.present) {
    await runtimeSafari.present(target, true)
  }
}

async function copyToPasteboard(value: string): Promise<void> {
  const target = String(value ?? "").trim()
  if (!target) return
  const runtimePasteboard = (globalThis as any).Pasteboard
  if (runtimePasteboard?.setString) {
    await runtimePasteboard.setString(target)
  }
}

async function presentShareSheet(value: string): Promise<void> {
  const target = String(value ?? "").trim()
  if (!target) return
  const runtimeShareSheet = (globalThis as any).ShareSheet
  if (runtimeShareSheet?.present) {
    await runtimeShareSheet.present([target])
    return
  }
  await copyToPasteboard(target)
}

function resolveVideoUrl(item: VideoDynamicItem): string {
  const jumpUrl = String(item.jumpUrl ?? "").trim()
  if (jumpUrl) return jumpUrl
  const bvid = String(item.bvid ?? "").trim()
  if (bvid) return `https://www.bilibili.com/video/${bvid}`
  const aid = String(item.aid ?? "").trim()
  if (aid) return `https://www.bilibili.com/video/av${aid}`
  return ""
}

function resolveAuthorSpaceUrl(item: VideoDynamicItem): string {
  const mid = String(item.authorMid ?? "").trim()
  return mid ? `https://space.bilibili.com/${mid}/` : ""
}

function FavoriteVideoCard(props: {
  item: VideoDynamicItem
  onOpenAuthor: () => void
  onOpenVideo: () => void
  onPlayInline?: () => void
  alternatePlaybackTitle: string
  alternatePlaybackSystemImage: string
  onAlternatePlayback: () => void
  compact?: boolean
  embedded?: boolean
  onAppear?: () => void
}) {
  const artwork = useVideoCoverArtwork(props.item.cover)
  const videoUrl = resolveVideoUrl(props.item)
  const compact = Boolean(props.compact)
  const cardCornerRadius = compact ? 16 : 18
  const compactCardHeight = 202
  const cardShape = { type: "rect" as const, cornerRadius: cardCornerRadius, style: "continuous" as const }
  const avatarSize = compact ? 22 : 38
  const avatarRadius = compact ? 8 : 10
  const compactCoverHeight = 108

  const compactAuthorRow = (
    <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      <Image
        imageUrl={props.item.authorFace}
        resizable={true}
        scaleToFill={true}
        frame={{ width: avatarSize, height: avatarSize }}
        clipShape={{ type: "rect", cornerRadius: avatarRadius }}
        placeholder={<ProgressView progressViewStyle="circular" />}
      />
      <Text
        font="caption2"
        foregroundStyle="#FB7299"
        lineLimit={1}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      >
        {props.item.authorName}
      </Text>
      <Text
        font="caption2"
        foregroundStyle="#FB7299"
        lineLimit={1}
        padding={{ top: 3, bottom: 3, leading: 6, trailing: 6 }}
        background={{ style: "rgba(251,114,153,0.14)", shape: { type: "capsule", style: "continuous" } }}
      >
        收藏 UP
      </Text>
    </HStack>
  )

  const cardContextMenu = {
    menuItems: <Group>
      <Button
        title={props.alternatePlaybackTitle}
        systemImage={props.alternatePlaybackSystemImage}
        action={props.onAlternatePlayback}
      />
      <Button title="复制链接" systemImage="link" action={() => { void copyToPasteboard(videoUrl) }} />
      <Button title="分享链接" systemImage="square.and.arrow.up" action={() => { void presentShareSheet(videoUrl) }} />
    </Group>,
  }

  const cardBody = (
    <ZStack
      frame={compact
        ? { maxWidth: "infinity", height: compactCardHeight, alignment: "leading" as any }
        : { maxWidth: "infinity", alignment: "leading" as any }}
      contentShape={cardShape}
      clipShape={cardShape}
      contextMenu={compact && props.embedded ? undefined : cardContextMenu}
    >
      <VideoCardBackground dominantColor={artwork.dominantColor} cornerRadius={cardCornerRadius} />

      {compact ? (
        <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}>
          <VStack
            frame={{ maxWidth: "infinity" }}
            onTapGesture={props.onPlayInline ?? props.onOpenVideo}
          >
            <ZStack frame={{ maxWidth: "infinity", height: compactCoverHeight }}>
                <CompactVideoCoverImage
                  artwork={artwork}
                  coverUrl={props.item.cover}
                  height={compactCoverHeight}
                />
              <VStack
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
                padding={6}
              >
                <Text
                  font="caption2"
                  foregroundStyle="white"
                  padding={{ top: 3, bottom: 3, leading: 6, trailing: 6 }}
                  background={{ style: "rgba(0,0,0,0.72)", shape: { type: "capsule", style: "continuous" } }}
                >
                  {props.item.durationText || "--:--"}
                </Text>
              </VStack>
            </ZStack>
          </VStack>

          <VStack
            spacing={6}
            padding={{ top: 8, bottom: 10, leading: 8, trailing: 8 }}
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
          >
            <Text
              font="footnote"
              lineLimit={2}
              frame={{ maxWidth: "infinity", minHeight: 34, alignment: "topLeading" as any }}
            >
              {props.item.title}
            </Text>

            <HStack
              spacing={0}
              frame={{ maxWidth: "infinity" }}
              onTapGesture={props.onOpenAuthor}
            >
              {compactAuthorRow}
            </HStack>

            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              lineLimit={1}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            >
              {compactMetaText(props.item)}
            </Text>
          </VStack>
        </VStack>
      ) : (
        <VStack
          spacing={14}
          padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
        >
          <HStack
            spacing={0}
            frame={{ maxWidth: "infinity" }}
            onTapGesture={props.onOpenAuthor}
          >
            <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Image
                imageUrl={props.item.authorFace}
                resizable={true}
                scaleToFill={true}
                frame={{ width: avatarSize, height: avatarSize }}
                clipShape={{ type: "rect", cornerRadius: avatarRadius }}
                placeholder={<ProgressView progressViewStyle="circular" />}
              />
              <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                <Text
                  font="subheadline"
                  foregroundStyle="#FB7299"
                  lineLimit={1}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                >
                  {props.item.authorName}
                </Text>
                <Text
                  font="caption"
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                >
                  {`${props.item.authorAction || "投稿了视频"} · ${props.item.publishedLabel || "刚刚"}`}
                </Text>
              </VStack>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                {props.item.publishedLabel || "刚刚"}
              </Text>
            </HStack>
          </HStack>

          <VStack
            frame={{ maxWidth: "infinity" }}
            onTapGesture={props.onPlayInline ?? props.onOpenVideo}
          >
            <HStack spacing={0} frame={{ maxWidth: "infinity", alignment: "top" as any }}>
              <VStack spacing={14} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
              <ZStack
                frame={{ maxWidth: "infinity" }}
                aspectRatio={{ value: 16 / 9, contentMode: "fit" }}
                >
                  <VideoCoverImage
                    artwork={artwork}
                    coverUrl={props.item.cover}
                    cornerRadius={14}
                  />
                  <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }} padding={8}>
                    <Text
                      font="caption2"
                      foregroundStyle="white"
                      padding={{ top: 4, bottom: 4, leading: 8, trailing: 8 }}
                      background={{ style: "rgba(0,0,0,0.72)", shape: { type: "capsule", style: "continuous" } }}
                    >
                      {props.item.durationText || "--:--"}
                    </Text>
                  </VStack>
                </ZStack>

                <VStack spacing={6} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                  <Text
                    font="headline"
                    lineLimit={2}
                    frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  >
                    {props.item.title}
                  </Text>

                  <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    <Text
                      font="caption"
                      foregroundStyle="white"
                      lineLimit={1}
                      padding={{ top: 4, bottom: 4, leading: 8, trailing: 8 }}
                      background={{ style: "#FB7299", shape: { type: "capsule", style: "continuous" } }}
                    >
                      收藏 UP
                    </Text>
                    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                      播放 {props.item.playText}
                    </Text>
                  </HStack>
                </VStack>
              </VStack>
            </HStack>
          </VStack>
        </VStack>
      )}
    </ZStack>
  )

  if (props.embedded) {
    return (
      <VStack
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        contentShape={cardShape}
        clipShape={cardShape}
        contextMenu={compact ? cardContextMenu : undefined}
        onAppear={props.onAppear}
      >
        {cardBody}
      </VStack>
    )
  }

  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      listRowInsets={{ top: 0, bottom: 0, leading: 8, trailing: 8 }}
      listRowBackground={<EmptyView />}
      listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
      listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
      onAppear={props.onAppear}
    >
      {cardBody}
    </VStack>
  )
}

export function FavoritesTabView(props: {
  auth: BiliAuthSession | null
  favoriteAuthors: BiliFavoriteAuthor[]
  items: VideoDynamicItem[]
  playbackMode: BiliPlaybackMode
  cardLayoutMode: BiliCardLayoutMode
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  errorMessage: string
  lastUpdatedAt: number | null
  onExit: () => void
  onRefresh: () => Promise<void>
  onLoadMore: () => Promise<void>
  onSearchAuthors: (keyword: string) => Promise<BiliFavoriteAuthor[]>
  onAddAuthor: (author: BiliFavoriteAuthor) => Promise<void>
  onRemoveAuthor: (mid: string) => Promise<void>
  onImportAuthors: () => Promise<void>
  onExportAuthors: () => Promise<void>
}) {
  const [managerPresented, setManagerPresented] = useState(false)
  const [playingItem, setPlayingItem] = useState<VideoDynamicItem | null>(null)
  const summary = props.lastUpdatedAt
    ? `上次刷新 ${new Date(props.lastUpdatedAt).toLocaleString("zh-CN")}`
    : "下拉可以刷新收藏内容"
  const FeedContainer = props.cardLayoutMode === "double" ? ScrollView : List
  const alternatePlaybackTitle = props.playbackMode === "external" ? "应用内播放" : "跳转播放"
  const alternatePlaybackSystemImage = props.playbackMode === "external" ? "play.rectangle" : "safari"

  function handleAlternatePlayback(item: VideoDynamicItem) {
    if (props.playbackMode === "external") {
      setManagerPresented(false)
      setPlayingItem(item)
      return
    }

    void openExternalUrl(resolveVideoUrl(item))
  }

  return (
    <NavigationStack>
      <FeedContainer
        navigationTitle="收藏"
        navigationBarTitleDisplayMode="large"
        listRowSpacing={6}
        listSectionSpacing="compact"
        listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
        listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
        refreshable={props.favoriteAuthors.length > 0 ? props.onRefresh : undefined}
        navigationDestination={{
          isPresented: managerPresented || playingItem != null,
          onChanged: (value) => {
            if (!value) {
              void stopActiveInlinePlayback()
              setManagerPresented(false)
              setPlayingItem(null)
            }
          },
          content: managerPresented ? (
            <FavoriteAuthorsManagerView
              favoriteAuthors={props.favoriteAuthors}
              onSearchAuthors={props.onSearchAuthors}
              onAddAuthor={props.onAddAuthor}
              onRemoveAuthor={props.onRemoveAuthor}
              onImportAuthors={props.onImportAuthors}
              onExportAuthors={props.onExportAuthors}
            />
          ) : (
            playingItem ? <InlineVideoPlayerPage auth={props.auth} item={playingItem} /> : <VStack />
          ),
        }}
        toolbar={{
          topBarLeading: [
            <Button
              key="close"
              title=""
              systemImage="xmark"
              action={props.onExit}
            />,
            ...(props.favoriteAuthors.length > 0 ? [
              <Button
                key="refresh"
                title=""
                systemImage="arrow.clockwise"
                action={() => { void props.onRefresh() }}
              />,
            ] : []),
          ],
          topBarTrailing: (
            <Button
              title=""
              systemImage="heart.circle"
              action={() => {
                setPlayingItem(null)
                setManagerPresented(true)
              }}
            />
          ),
        }}
      >
        {props.favoriteAuthors.length === 0 ? (
          <Section>
            <VStack
              spacing={12}
              padding={{ top: 20, bottom: 20 }}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              listRowBackground={<EmptyView />}
              listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
            >
              <Text font="title3" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>还没有收藏 UP 主</Text>
              <Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                可以按昵称或 UID 搜索后加入收藏。
              </Text>
              <Button
                title="管理收藏"
                systemImage="heart.circle"
                action={() => setManagerPresented(true)}
              />
            </VStack>
          </Section>
        ) : null}

        {props.isLoading && props.favoriteAuthors.length > 0 && props.items.length === 0 ? (
          <Section>
            <VStack
              spacing={10}
              padding={{ top: 24, bottom: 24 }}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              listRowBackground={<EmptyView />}
              listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
            >
              <ProgressView progressViewStyle="circular" />
              <Text foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>正在加载收藏视频…</Text>
            </VStack>
          </Section>
        ) : null}

        {props.errorMessage && props.items.length === 0 && props.favoriteAuthors.length > 0 ? (
          <Section>
            <VStack
              spacing={10}
              padding={{ top: 16, bottom: 16 }}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              listRowBackground={<EmptyView />}
              listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
            >
              <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>加载失败</Text>
              <Text foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{props.errorMessage}</Text>
              <Button title="重新加载" systemImage="arrow.clockwise" action={() => { void props.onRefresh() }} />
            </VStack>
          </Section>
        ) : null}

        {props.items.length > 0 && props.cardLayoutMode === "double" ? (
          <LazyVGrid
            columns={DOUBLE_CARD_COLUMNS}
            alignment="center"
            spacing={6}
            frame={{ maxWidth: "infinity", alignment: "center" as any }}
          >
            {props.items.map((item, index) => {
              const canInlinePlay = props.playbackMode === "inline" && props.auth?.loginMethod === "cookie" && Boolean(props.auth?.cookieHeader)
              const isLastItem = index === props.items.length - 1

              return (
                <FavoriteVideoCard
                  key={item.id}
                  embedded={true}
                  compact={true}
                  item={item}
                  onOpenAuthor={() => { void openExternalUrl(resolveAuthorSpaceUrl(item)) }}
                  onOpenVideo={() => { void openExternalUrl(resolveVideoUrl(item)) }}
                  onPlayInline={canInlinePlay ? () => setPlayingItem(item) : undefined}
                  alternatePlaybackTitle={alternatePlaybackTitle}
                  alternatePlaybackSystemImage={alternatePlaybackSystemImage}
                  onAlternatePlayback={() => handleAlternatePlayback(item)}
                  onAppear={isLastItem && props.hasMore && !props.isLoadingMore ? () => { void props.onLoadMore() } : undefined}
                />
              )
            })}
          </LazyVGrid>
        ) : props.items.length > 0 ? (
          props.items.map((item, index) => {
            const canInlinePlay = props.playbackMode === "inline" && props.auth?.loginMethod === "cookie" && Boolean(props.auth?.cookieHeader)
            const isLastItem = index === props.items.length - 1

            return (
              <FavoriteVideoCard
                key={item.id}
                item={item}
                onOpenAuthor={() => { void openExternalUrl(resolveAuthorSpaceUrl(item)) }}
                onOpenVideo={() => { void openExternalUrl(resolveVideoUrl(item)) }}
                onPlayInline={canInlinePlay ? () => setPlayingItem(item) : undefined}
                alternatePlaybackTitle={alternatePlaybackTitle}
                alternatePlaybackSystemImage={alternatePlaybackSystemImage}
                onAlternatePlayback={() => handleAlternatePlayback(item)}
                onAppear={isLastItem && props.hasMore && !props.isLoadingMore ? () => { void props.onLoadMore() } : undefined}
              />
            )
          })
        ) : null}

        {props.favoriteAuthors.length > 0 && props.items.length > 0 ? (
          <VStack
            spacing={8}
            padding={{ top: 10, bottom: 22, leading: 14, trailing: 14 }}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            listRowBackground={<EmptyView />}
            listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
          >
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              {summary} · 已收藏 {props.favoriteAuthors.length} 位 UP 主
            </Text>
            {props.isLoadingMore ? (
              <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                正在加载更早的视频…
              </Text>
            ) : null}
          </VStack>
        ) : null}

        {!props.isLoading && !props.errorMessage && props.favoriteAuthors.length > 0 && props.items.length === 0 ? (
          <Section>
            <VStack
              spacing={10}
              padding={{ top: 16, bottom: 16 }}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              listRowBackground={<EmptyView />}
              listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
            >
              <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>暂时没有可显示的视频</Text>
              <Text foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                这些收藏 UP 最近没有公开视频投稿，或者接口暂时没有返回结果。
              </Text>
            </VStack>
          </Section>
        ) : null}
      </FeedContainer>
    </NavigationStack>
  )
}
