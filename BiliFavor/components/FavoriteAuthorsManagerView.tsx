import {
  Button,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"

import type { BiliFavoriteAuthor } from "../types"

function FavoriteAuthorRow(props: {
  author: BiliFavoriteAuthor
  selected: boolean
  onToggle: () => void
}) {
  return (
    <Button buttonStyle="plain" action={props.onToggle} frame={{ maxWidth: "infinity" }}>
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
          <Text
            font="subheadline"
            foregroundStyle="#FB7299"
            lineLimit={1}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {props.author.uname}
          </Text>
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            UID {props.author.mid}
            {props.author.officialVerifyDesc ? ` · ${props.author.officialVerifyDesc}` : ""}
          </Text>
          {props.author.sign ? (
            <Text
              font="caption2"
              foregroundStyle="tertiaryLabel"
              lineLimit={1}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            >
              {props.author.sign}
            </Text>
          ) : null}
        </VStack>

        <Spacer />
        <Image
          systemName={props.selected ? "checkmark.circle.fill" : "plus.circle"}
          foregroundStyle={props.selected ? "#FB7299" : "tertiaryLabel"}
        />
      </HStack>
    </Button>
  )
}

export function FavoriteAuthorsManagerView(props: {
  favoriteAuthors: BiliFavoriteAuthor[]
  onSearchAuthors: (keyword: string) => Promise<BiliFavoriteAuthor[]>
  onAddAuthor: (author: BiliFavoriteAuthor) => Promise<void>
  onRemoveAuthor: (mid: string) => Promise<void>
  onImportAuthors: () => Promise<void>
  onExportAuthors: () => Promise<void>
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<BiliFavoriteAuthor[]>([])
  const [searching, setSearching] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const searchTimerRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const favoriteMidSet = useMemo(
    () => new Set(props.favoriteAuthors.map((item) => item.mid)),
    [props.favoriteAuthors]
  )

  function clearSearchTimer() {
    if (searchTimerRef.current != null) {
      clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
  }

  useEffect(() => {
    const trimmed = query.trim()
    clearSearchTimer()

    if (!trimmed) {
      setResults([])
      setSearching(false)
      setErrorMessage("")
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    searchTimerRef.current = setTimeout(() => {
      void (async () => {
        setSearching(true)
        setErrorMessage("")
        try {
          const nextResults = await props.onSearchAuthors(trimmed)
          if (requestIdRef.current !== requestId) return
          setResults(nextResults)
        } catch (error: any) {
          if (requestIdRef.current !== requestId) return
          setErrorMessage(String(error?.message ?? error ?? "搜索失败"))
        } finally {
          if (requestIdRef.current === requestId) {
            setSearching(false)
          }
        }
      })()
    }, 280) as any

    return clearSearchTimer
  }, [props.onSearchAuthors, query])

  return (
    <List
      navigationTitle="收藏 UP"
      navigationBarTitleDisplayMode="inline"
      searchable={{
        value: query,
        onChanged: setQuery,
        prompt: "搜索昵称或 UID",
        placement: "navigationBarDrawerAlwaysDisplay",
      }}
      toolbar={{
        topBarTrailing: [
          <Button
            key="import"
            title="导入"
            systemImage="square.and.arrow.down"
            action={() => { void props.onImportAuthors() }}
          />,
          <Button
            key="export"
            title="导出"
            systemImage="square.and.arrow.up"
            action={() => { void props.onExportAuthors() }}
          />,
        ],
      }}
    >
      <Section footer={<Text>当前已收藏 {props.favoriteAuthors.length} 位 UP 主。</Text>}>
        {props.favoriteAuthors.length > 0 ? props.favoriteAuthors.map((author) => (
          <FavoriteAuthorRow
            key={author.mid}
            author={author}
            selected={true}
            onToggle={() => { void props.onRemoveAuthor(author.mid) }}
          />
        )) : (
          <Text foregroundStyle="secondaryLabel">还没有收藏 UP 主。</Text>
        )}
      </Section>

      {query.trim() ? (
        <Section header={<Text>搜索结果</Text>}>
          {searching ? (
            <VStack
              spacing={10}
              padding={{ top: 18, bottom: 18 }}
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              <ProgressView progressViewStyle="circular" />
              <Text foregroundStyle="secondaryLabel">正在搜索…</Text>
            </VStack>
          ) : null}

          {!searching && errorMessage ? (
            <Text foregroundStyle="secondaryLabel">{errorMessage}</Text>
          ) : null}

          {!searching && !errorMessage && results.length > 0 ? results.map((author) => (
            <FavoriteAuthorRow
              key={author.mid}
              author={author}
              selected={favoriteMidSet.has(author.mid)}
              onToggle={() => {
                if (favoriteMidSet.has(author.mid)) {
                  void props.onRemoveAuthor(author.mid)
                } else {
                  void props.onAddAuthor(author)
                }
              }}
            />
          )) : null}

          {!searching && !errorMessage && results.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">没有找到匹配的 UP 主。</Text>
          ) : null}
        </Section>
      ) : (
        <Section footer={<Text>支持按昵称或 UID 搜索，并可导入导出 JSON。</Text>} />
      )}
    </List>
  )
}
