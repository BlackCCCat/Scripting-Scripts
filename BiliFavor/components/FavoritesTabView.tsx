import {
  Button,
  EmptyView,
  Group,
  HStack,
  Image,
  List,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  useColorScheme,
  useState,
  VStack,
  ZStack,
} from "scripting"

import { FavoriteAuthorsManagerView } from "./FavoriteAuthorsManagerView"
import { InlineVideoPlayerPage } from "./InlineVideoPlayerPage"
import type {
  BiliAuthSession,
  BiliFavoriteAuthor,
  BiliPlaybackMode,
  VideoDynamicItem,
} from "../types"

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
  isLast: boolean
  shouldLoadMore: boolean
  onLoadMore: () => void
  onOpenAuthor: () => void
  onOpenVideo: () => void
  onPlayInline?: () => void
}) {
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"
  const videoUrl = resolveVideoUrl(props.item)

  return (
    <VStack
      spacing={14}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      background={{ style: cardFill, shape: { type: "rect", cornerRadius: 24 } }}
      shadow={{
        color: colorScheme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.08)",
        radius: 14,
        y: 6,
      }}
      listRowBackground={<EmptyView />}
      listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
      listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
      onAppear={props.isLast && props.shouldLoadMore ? props.onLoadMore : undefined}
    >
      <Button buttonStyle="plain" action={props.onOpenAuthor} frame={{ maxWidth: "infinity" }}>
        <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Image
            imageUrl={props.item.authorFace}
            resizable={true}
            scaleToFill={true}
            frame={{ width: 38, height: 38 }}
            clipShape={{ type: "rect", cornerRadius: 10 }}
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
              {props.item.authorAction || "投稿了视频"}
            </Text>
          </VStack>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {props.item.publishedLabel || "刚刚"}
          </Text>
        </HStack>
      </Button>

      <Button
        buttonStyle="plain"
        action={props.onPlayInline ?? props.onOpenVideo}
        frame={{ maxWidth: "infinity" }}
      >
        <HStack
          spacing={10}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          contentShape="rect"
          contextMenu={{
            menuItems: <Group>
              <Button title="复制链接" systemImage="link" action={() => { void copyToPasteboard(videoUrl) }} />
              <Button title="分享链接" systemImage="square.and.arrow.up" action={() => { void presentShareSheet(videoUrl) }} />
            </Group>,
          }}
        >
          <VStack spacing={14} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
            <ZStack
              frame={{ maxWidth: "infinity", height: 210 }}
              background={{ style: "tertiarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}
            >
              <Image
                imageUrl={props.item.cover}
                resizable={true}
                scaleToFill={true}
                frame={{ maxWidth: "infinity", height: 210 }}
                clipShape={{ type: "rect", cornerRadius: 14 }}
                placeholder={<ProgressView progressViewStyle="circular" />}
              />
              <VStack
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
                padding={8}
              >
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
      </Button>
    </VStack>
  )
}

export function FavoritesTabView(props: {
  auth: BiliAuthSession | null
  favoriteAuthors: BiliFavoriteAuthor[]
  items: VideoDynamicItem[]
  playbackMode: BiliPlaybackMode
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

  return (
    <NavigationStack>
      <List
        navigationTitle="收藏"
        navigationBarTitleDisplayMode="large"
        listStyle="plain"
        background="systemGroupedBackground"
        listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
        listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
        refreshable={props.favoriteAuthors.length > 0 ? props.onRefresh : undefined}
        navigationDestination={{
          isPresented: managerPresented || playingItem != null,
          onChanged: (value) => {
            if (!value) {
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
            playingItem && props.auth ? <InlineVideoPlayerPage auth={props.auth} item={playingItem} /> : <VStack />
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

        {props.items.map((item) => {
          const canInlinePlay = props.playbackMode === "inline" && props.auth?.loginMethod === "cookie" && Boolean(props.auth?.cookieHeader)
          return (
            <FavoriteVideoCard
              key={item.id}
              item={item}
              isLast={item.id === props.items[props.items.length - 1]?.id}
              shouldLoadMore={props.hasMore && !props.isLoadingMore}
              onLoadMore={() => { void props.onLoadMore() }}
              onOpenAuthor={() => { void openExternalUrl(resolveAuthorSpaceUrl(item)) }}
              onOpenVideo={() => { void openExternalUrl(resolveVideoUrl(item)) }}
              onPlayInline={canInlinePlay ? () => setPlayingItem(item) : undefined}
            />
          )
        })}

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
      </List>
    </NavigationStack>
  )
}
