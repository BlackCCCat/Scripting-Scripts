import {
  Button,
  EmptyView,
  Group,
  HStack,
  Image,
  List,
  NavigationStack,
  ProgressView,
  ScrollViewReader,
  type ScrollViewProxy,
  Section,
  Spacer,
  Text,
  useColorScheme,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"

import { FollowingsFilterView } from "./FollowingsFilterView"
import { InlineVideoPlayerPage, stopActiveInlinePlayback } from "./InlineVideoPlayerPage"
import type {
  BiliAuthSession,
  BiliAuthorFilterRule,
  BiliFollowedAuthor,
  BiliLoginMode,
  BiliPlaybackMode,
  VideoDynamicItem,
} from "../types"

function statsText(playText: string, danmakuText: string): string {
  return `播放 ${playText}  ·  弹幕 ${danmakuText}`
}

function subtitleText(item: VideoDynamicItem): string {
  if (item.authorAction && item.publishedLabel) {
    return `${item.authorAction} · ${item.publishedLabel}`
  }
  if (item.authorAction) return item.authorAction
  return item.publishedLabel || "视频投稿"
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

  const openURL = (globalThis as any).openURL
  if (typeof openURL === "function") {
    const ok = await openURL(target)
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

function VideoDynamicCard(props: {
  item: VideoDynamicItem
  isLast: boolean
  shouldLoadMore: boolean
  onLoadMore: () => void
  externalUrl: string
  onOpenAuthorUrl?: () => void
  onOpenExternalUrl?: () => void
  onPress?: () => void
}) {
  const { item } = props
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"

  async function copyLink() {
    if (!props.externalUrl) return
    await copyToPasteboard(props.externalUrl)
  }

  async function shareLink() {
    if (!props.externalUrl) return
    await presentShareSheet(props.externalUrl)
  }

  const avatarContent = (
    <Image
      imageUrl={item.authorFace}
      resizable={true}
      scaleToFill={true}
      frame={{ width: 38, height: 38 }}
      clipShape={{ type: "rect", cornerRadius: 10 }}
      placeholder={<ProgressView progressViewStyle="circular" />}
    />
  )

  const headerContent = (
    <HStack
      spacing={10}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      contentShape="rect"
    >
      {avatarContent}
      <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text
          font="subheadline"
          foregroundStyle="#FB7299"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {item.authorName}
        </Text>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {subtitleText(item)}
        </Text>
      </VStack>
    </HStack>
  )

  const bodyContent = (
    <HStack
      spacing={10}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      contentShape="rect"
      contextMenu={{
        menuItems: <Group>
          <Button title="复制链接" systemImage="link" action={() => void copyLink()} />
          <Button title="分享链接" systemImage="square.and.arrow.up" action={() => void shareLink()} />
        </Group>,
      }}
    >
      <VStack spacing={14} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <ZStack
          frame={{ maxWidth: "infinity", height: 210 }}
          background={{ style: "tertiarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}
        >
          <Image
            imageUrl={item.cover}
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
              background={{
                style: "rgba(0,0,0,0.72)",
                shape: { type: "capsule", style: "continuous" },
              }}
            >
              {item.durationText || "--:--"}
            </Text>
          </VStack>
        </ZStack>

        <VStack spacing={6} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text
            font="headline"
            lineLimit={2}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {item.title}
          </Text>

          <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text
              font="caption"
              foregroundStyle={item.badgeColor as any}
              lineLimit={1}
              padding={{ top: 4, bottom: 4, leading: 8, trailing: 8 }}
              background={{
                style: item.badgeBackgroundColor as any,
                shape: { type: "capsule", style: "continuous" },
              }}
            >
              {item.badgeText}
            </Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
              {statsText(item.playText, item.danmakuText)}
            </Text>
            <Spacer />
          </HStack>
        </VStack>
      </VStack>
    </HStack>
  )

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
      <HStack spacing={10} frame={{ maxWidth: "infinity" as any }}>
        {props.onOpenAuthorUrl ? (
          <Button
            buttonStyle="plain"
            action={props.onOpenAuthorUrl}
            frame={{ maxWidth: "infinity" }}
          >
            {headerContent}
          </Button>
        ) : (
          headerContent
        )}
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {item.publishedLabel || "刚刚"}
        </Text>
      </HStack>

      {props.onPress ? (
        <Button
          buttonStyle="plain"
          action={props.onPress}
          frame={{ maxWidth: "infinity" }}
        >
          {bodyContent}
        </Button>
      ) : props.onOpenExternalUrl ? (
        <Button
          buttonStyle="plain"
          action={props.onOpenExternalUrl}
          frame={{ maxWidth: "infinity" }}
        >
          {bodyContent}
        </Button>
      ) : (
        bodyContent
      )}
    </VStack>
  )
}

export function DynamicTabView(props: {
  auth: BiliAuthSession | null
  loginMode: BiliLoginMode
  isLoggedIn: boolean
  isAuthChecking: boolean
  items: VideoDynamicItem[]
  totalItemCount: number
  isFilterActive: boolean
  followedAuthors: BiliFollowedAuthor[]
  followedAuthorsLoading: boolean
  followedAuthorsErrorMessage: string
  authorFilterRule: BiliAuthorFilterRule
  playbackMode: BiliPlaybackMode
  isLoading: boolean
  errorMessage: string
  lastUpdatedAt: number | null
  onExit: () => void
  onRefresh: () => Promise<void>
  onOpenSettings: () => void
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => Promise<void>
  onOpenFilter: () => Promise<void>
  onRetryFollowedAuthors: () => Promise<void>
  onUpdateAuthorFilterRule: (rule: BiliAuthorFilterRule) => Promise<void>
}) {
  const [filterPresented, setFilterPresented] = useState(false)
  const [playingItem, setPlayingItem] = useState<VideoDynamicItem | null>(null)
  const scrollProxyRef = useRef<ScrollViewProxy>()
  const summary = props.lastUpdatedAt
    ? `上次刷新 ${new Date(props.lastUpdatedAt).toLocaleString("zh-CN")}`
    : "下拉可以刷新关注动态"

  function openFilterPage() {
    setPlayingItem(null)
    setFilterPresented(true)
    void props.onOpenFilter()
  }

  function handleOpenItem(item: VideoDynamicItem) {
    if (props.playbackMode === "inline" && props.auth?.loginMethod === "cookie" && props.auth?.cookieHeader) {
      setFilterPresented(false)
      setPlayingItem(item)
      return
    }

    const target = resolveVideoUrl(item)
    void openExternalUrl(target)
  }

  async function handleManualRefresh() {
    const topAnchorKey = props.items[0]?.id || "dynamic-state-top"
    scrollProxyRef.current?.scrollTo(topAnchorKey, "top")
    await props.onRefresh()
  }

  const footerText = props.isFilterActive
    ? `${summary} · 已显示 ${props.items.length} / ${props.totalItemCount} 条`
    : `${summary} · 已加载 ${props.items.length} 条`

  return (
    <NavigationStack>
      <ScrollViewReader>
        {(scrollProxy) => {
          scrollProxyRef.current = scrollProxy

          return (
            <List
              navigationTitle="动态"
              navigationBarTitleDisplayMode="large"
              listStyle="plain"
              background="systemGroupedBackground"
              listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}
              listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
              refreshable={props.isLoggedIn ? props.onRefresh : undefined}
              navigationDestination={{
                isPresented: filterPresented || playingItem != null,
                onChanged: (value) => {
                  if (!value) {
                    void stopActiveInlinePlayback()
                    setFilterPresented(false)
                    setPlayingItem(null)
                  }
                },
                content: filterPresented ? (
                  <FollowingsFilterView
                    authors={props.followedAuthors}
                    loading={props.followedAuthorsLoading}
                    errorMessage={props.followedAuthorsErrorMessage}
                    filterRule={props.authorFilterRule}
                    onRetry={props.onRetryFollowedAuthors}
                    onChangeRule={props.onUpdateAuthorFilterRule}
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
                  ...(props.isLoggedIn ? [
                    <Button
                      key="refresh"
                      title=""
                      systemImage="arrow.clockwise"
                      action={() => { void handleManualRefresh() }}
                    />,
                  ] : []),
                ],
                topBarTrailing: props.isLoggedIn
                  ? (
                    <Button
                      title=""
                      systemImage={props.isFilterActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"}
                      action={openFilterPage}
                    />
                  )
                  : undefined,
              }}
            >
              {!props.isLoggedIn && !props.isAuthChecking ? (
                <Section listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}>
                  <VStack
                    key="dynamic-state-top"
                    spacing={12}
                    padding={{ top: 16, bottom: 16 }}
                    frame={{ maxWidth: "infinity", alignment: "center" as any }}
                    listRowBackground={<EmptyView />}
                    listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                  >
                    <Text font="title3">还没有登录哔哩哔哩</Text>
                    <Text font="subheadline" foregroundStyle="secondaryLabel">
                      登录后这里会显示你关注的 UP 主最新视频投稿。
                    </Text>
                    <Button
                      title="去设置登录"
                      systemImage="person.crop.circle.badge.plus"
                      action={props.onOpenSettings}
                    />
                  </VStack>
                </Section>
              ) : null}

              {props.isAuthChecking && props.totalItemCount === 0 ? (
                <Section listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}>
                  <VStack
                    key="dynamic-state-top"
                    spacing={10}
                    padding={{ top: 24, bottom: 24 }}
                    frame={{ maxWidth: "infinity", alignment: "center" as any }}
                    listRowBackground={<EmptyView />}
                    listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                  >
                    <ProgressView progressViewStyle="circular" />
                    <Text foregroundStyle="secondaryLabel">正在检测登录状态…</Text>
                  </VStack>
                </Section>
              ) : null}

              {props.isLoading && props.totalItemCount === 0 && !props.isAuthChecking ? (
                <Section listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}>
                  <VStack
                    key="dynamic-state-top"
                    spacing={10}
                    padding={{ top: 24, bottom: 24 }}
                    frame={{ maxWidth: "infinity", alignment: "center" as any }}
                    listRowBackground={<EmptyView />}
                    listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                  >
                    <ProgressView progressViewStyle="circular" />
                    <Text foregroundStyle="secondaryLabel">正在加载视频动态…</Text>
                  </VStack>
                </Section>
              ) : null}

              {props.errorMessage && props.totalItemCount === 0 && props.isLoggedIn ? (
                <Section listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}>
                  <VStack
                    key="dynamic-state-top"
                    spacing={10}
                    padding={{ top: 16, bottom: 16 }}
                    listRowBackground={<EmptyView />}
                    listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                  >
                    <Text font="headline">加载失败</Text>
                    <Text foregroundStyle="secondaryLabel">{props.errorMessage}</Text>
                    <Button title="重新加载" systemImage="arrow.clockwise" action={() => void props.onRefresh()} />
                  </VStack>
                </Section>
              ) : null}

              {props.items.length > 0 ? (
                props.items.map((item, index) => {
                  const externalUrl = resolveVideoUrl(item)
                  const authorUrl = resolveAuthorSpaceUrl(item)
                  const canInlinePlay = props.playbackMode === "inline" && props.auth?.loginMethod === "cookie" && Boolean(props.auth?.cookieHeader)

                  return (
                    <VideoDynamicCard
                      key={item.id}
                      item={item}
                      isLast={index === props.items.length - 1}
                      shouldLoadMore={props.hasMore && !props.isLoadingMore}
                      onLoadMore={() => { void props.onLoadMore() }}
                      externalUrl={externalUrl}
                      onOpenAuthorUrl={authorUrl ? () => { void openExternalUrl(authorUrl) } : undefined}
                      onOpenExternalUrl={externalUrl ? () => { void openExternalUrl(externalUrl) } : undefined}
                      onPress={canInlinePlay ? () => handleOpenItem(item) : undefined}
                    />
                  )
                })
              ) : null}

              {props.totalItemCount > 0 ? (
                <VStack
                  key={props.items.length === 0 ? "dynamic-state-top" : undefined}
                  spacing={8}
                  padding={{ top: 10, bottom: 22, leading: 14, trailing: 14 }}
                  frame={{ maxWidth: "infinity", alignment: "center" as any }}
                  listRowBackground={<EmptyView />}
                  listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                >
                  {props.isLoadingMore ? (
                    <>
                      <ProgressView progressViewStyle="circular" />
                      <Text font="caption" foregroundStyle="secondaryLabel">正在加载更多动态…</Text>
                    </>
                  ) : null}
                  {!props.hasMore ? (
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      已经到底了
                    </Text>
                  ) : null}
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {props.errorMessage || footerText}
                  </Text>
                </VStack>
              ) : null}

              {!props.isLoading && !props.errorMessage && props.isLoggedIn && props.totalItemCount === 0 ? (
                <Section listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}>
                  <VStack
                    key="dynamic-state-top"
                    spacing={10}
                    padding={{ top: 16, bottom: 16 }}
                    listRowBackground={<EmptyView />}
                    listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                  >
                    <Text font="headline">暂时没有视频投稿</Text>
                    <Text foregroundStyle="secondaryLabel">
                      当前关注动态里没有可展示的视频卡片，可以稍后下拉刷新。
                    </Text>
                  </VStack>
                </Section>
              ) : null}

              {!props.isLoading && !props.errorMessage && props.isLoggedIn && props.totalItemCount > 0 && props.items.length === 0 ? (
                <Section listSectionSeparator={{ visibility: "hidden", edges: "all" as any }}>
                  <VStack
                    key="dynamic-state-top"
                    spacing={10}
                    padding={{ top: 16, bottom: 16 }}
                    listRowBackground={<EmptyView />}
                    listRowSeparator={{ visibility: "hidden", edges: "all" as any }}
                  >
                    <Text font="headline">当前筛选下没有视频投稿</Text>
                    <Text foregroundStyle="secondaryLabel">
                      可以点右上角的过滤按钮调整 UP 主范围，或者切回“全部”查看完整动态流。
                    </Text>
                  </VStack>
                </Section>
              ) : null}
            </List>
          )
        }}
      </ScrollViewReader>
    </NavigationStack>
  )
}
