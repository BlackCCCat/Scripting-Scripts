import {
  Button,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
  useMemo,
  useState,
  VStack,
  ZStack,
} from "scripting"

import type { BiliAuthorFilterRule, BiliFollowedAuthor } from "../types"

function isAuthorEnabled(
  rule: BiliAuthorFilterRule,
  mid: string,
  allMids: string[]
): boolean {
  if (rule.mode === "all") return allMids.includes(mid)
  return rule.mids.includes(mid)
}

function toggleAuthor(
  rule: BiliAuthorFilterRule,
  mid: string,
  allMids: string[]
): BiliAuthorFilterRule {
  const baseline = rule.mode === "all" ? [...allMids] : [...rule.mids]
  const next = new Set(baseline)

  if (next.has(mid)) {
    next.delete(mid)
  } else {
    next.add(mid)
  }

  return {
    mode: "custom",
    mids: [...next],
  }
}

function FollowedAuthorRow(props: {
  author: BiliFollowedAuthor
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <Button
      buttonStyle="plain"
      action={props.onToggle}
      frame={{ maxWidth: "infinity" }}
    >
      <HStack
        spacing={12}
        padding={{ top: 8, bottom: 8 }}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        contentShape="rect"
      >
        {props.author.face ? (
          <Image
            imageUrl={props.author.face}
            resizable={true}
            scaleToFill={true}
            frame={{ width: 42, height: 42 }}
            clipShape={{ type: "rect", cornerRadius: 12 }}
            placeholder={<ProgressView progressViewStyle="circular" />}
          />
        ) : (
          <ZStack
            frame={{ width: 42, height: 42 }}
            background={{ style: "#FBCFE8", shape: { type: "rect", cornerRadius: 12 } }}
          >
            <Text font="headline" foregroundStyle="#9D174D">
              {props.author.uname.slice(0, 1) || "B"}
            </Text>
          </ZStack>
        )}

        <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <HStack spacing={6}>
            <Text
              font="subheadline"
              foregroundStyle="#FB7299"
              lineLimit={1}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            >
              {props.author.uname}
            </Text>
            {props.author.special ? (
              <Text
                font="caption2"
                foregroundStyle="#FB7299"
                padding={{ top: 2, bottom: 2, leading: 6, trailing: 6 }}
                background={{ style: "#FCE7F3", shape: { type: "capsule", style: "continuous" } }}
              >
                特别关注
              </Text>
            ) : null}
          </HStack>
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {props.author.sign || `UID ${props.author.mid}`}
          </Text>
        </VStack>

        <Spacer />
        <Image
          systemName={props.enabled ? "checkmark.circle.fill" : "circle"}
          foregroundStyle={props.enabled ? "#FB7299" : "tertiaryLabel"}
        />
      </HStack>
    </Button>
  )
}

export function FollowingsFilterView(props: {
  authors: BiliFollowedAuthor[]
  loading: boolean
  errorMessage: string
  filterRule: BiliAuthorFilterRule
  onRetry: () => Promise<void>
  onChangeRule: (rule: BiliAuthorFilterRule) => Promise<void>
}) {
  const [query, setQuery] = useState("")
  const allMids = useMemo(() => props.authors.map((item) => item.mid), [props.authors])
  const filteredAuthors = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return props.authors
    return props.authors.filter((item) =>
      item.uname.toLowerCase().includes(keyword) ||
      item.mid.toLowerCase().includes(keyword) ||
      item.sign.toLowerCase().includes(keyword)
    )
  }, [props.authors, query])
  const selectedCount = props.filterRule.mode === "all" ? allMids.length : props.filterRule.mids.length

  return (
    <List
      navigationTitle="筛选 UP 主"
      navigationBarTitleDisplayMode="inline"
      searchable={{
        value: query,
        onChanged: setQuery,
        prompt: "搜索昵称、UID 或签名",
        placement: "navigationBarDrawer",
      }}
      toolbar={{
        topBarTrailing: [
          <Button
            key="all"
            title="全部"
            disabled={props.filterRule.mode === "all"}
            action={() => {
              void props.onChangeRule({
                mode: "all",
                mids: [],
              })
            }}
          />,
          <Button
            key="none"
            title="清空"
            disabled={props.filterRule.mode === "custom" && props.filterRule.mids.length === 0}
            action={() => {
              void props.onChangeRule({
                mode: "custom",
                mids: [],
              })
            }}
          />,
        ],
      }}
    >
      {props.loading && props.authors.length === 0 ? (
        <Section>
          <VStack
            spacing={10}
            padding={{ top: 24, bottom: 24 }}
            frame={{ maxWidth: "infinity", alignment: "center" as any }}
          >
            <ProgressView progressViewStyle="circular" />
            <Text foregroundStyle="secondaryLabel">正在同步关注列表…</Text>
          </VStack>
        </Section>
      ) : null}

      {props.errorMessage && props.authors.length === 0 ? (
        <Section>
          <VStack spacing={10} padding={{ top: 18, bottom: 18 }}>
            <Text font="headline">获取关注列表失败</Text>
            <Text foregroundStyle="secondaryLabel">{props.errorMessage}</Text>
            <Button title="重新加载" systemImage="arrow.clockwise" action={() => void props.onRetry()} />
          </VStack>
        </Section>
      ) : null}

      {filteredAuthors.length > 0 ? (
        <Section footer={<Text>当前会显示 {selectedCount} / {allMids.length} 位 UP 主的视频投稿。</Text>}>
          {filteredAuthors.map((author) => (
            <FollowedAuthorRow
              key={author.mid}
              author={author}
              enabled={isAuthorEnabled(props.filterRule, author.mid, allMids)}
              onToggle={() => {
                void props.onChangeRule(toggleAuthor(props.filterRule, author.mid, allMids))
              }}
            />
          ))}
        </Section>
      ) : null}

      {!props.loading && !props.errorMessage && props.authors.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">暂时没有拿到关注列表。</Text>
        </Section>
      ) : null}

      {!props.loading && props.authors.length > 0 && filteredAuthors.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">没有匹配的关注用户。</Text>
        </Section>
      ) : null}
    </List>
  )
}
