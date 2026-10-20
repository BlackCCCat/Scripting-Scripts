import {
  Button,
  Capsule,
  DisclosureGroup,
  HStack,
  Image,
  LabeledContent,
  List,
  NavigationStack,
  Picker,
  Section,
  Text,
  VStack,
  useMemo,
  useState,
} from "scripting"
import {
  ProviderId,
  ProviderMeta,
  ProviderRouteCategory,
} from "../models/types"
import {
  PROVIDERS_CATALOG,
  groupProvidersAlphabetically,
  searchProviders,
} from "../utils/providers_catalog"
import {
  adaptiveProminentButtonStyle,
  loginMethodBadgeText,
  routeCategorySymbol,
  routeCategoryTitle,
} from "../utils/theme"
import { ProviderIconView } from "./ProviderIconView"

const ALL_ROUTE_CATEGORIES: ProviderRouteCategory[] = [
  "direct_api",
  "gateway",
  "device_oauth",
  "google_oauth",
  "web_session",
]

export function ProviderCatalogView(props: {
  isDemoMode: boolean
  onQuickAddAccount: (provider: ProviderId) => void
  onDismiss: () => void
}) {
  const { isDemoMode, onQuickAddAccount, onDismiss } = props
  const [searchText, setSearchText] = useState<string>("")
  const [selectedCategory, setSelectedCategory] = useState<
    ProviderRouteCategory | "all"
  >("all")
  const [sortGroupingMode, setSortGroupingMode] = useState<
    "alphabet" | "category"
  >("alphabet")

  const filtered = useMemo(
    () => searchProviders(searchText, selectedCategory),
    [searchText, selectedCategory]
  )

  const groupedAlphabetical = useMemo(
    () => groupProvidersAlphabetically(filtered),
    [filtered]
  )

  const groupedByRoute = useMemo(() => {
    const categories =
      selectedCategory === "all" ? ALL_ROUTE_CATEGORIES : [selectedCategory]
    return categories
      .map((cat) => ({
        category: cat,
        items: filtered.filter((item) => item.routeCategory === cat),
      }))
      .filter((group) => group.items.length > 0)
  }, [filtered, selectedCategory])

  return (
    <NavigationStack>
      <List
        navigationTitle={`供应商目录 (${filtered.length})`}
        listStyle="insetGroup"
        listSectionIndexVisibility="automatic"
        searchable={{
          value: searchText,
          onChanged: setSearchText,
          prompt: "搜索供应商、认证协议或 API 端点",
        }}
        toolbar={{
          topBarLeading: (
            <Button
              title="退出"
              systemImage="xmark"
              action={onDismiss}
            />
          ),
        }}
      >
        <Section
          header={<Text>分类与排序</Text>}
          footer={
            <Text>
              所有供应商均采用客户端直连，不经过任何第三方中转后端
            </Text>
          }
        >
          <Picker
            title="排序与分组"
            value={sortGroupingMode}
            onChanged={(val: string) =>
              setSortGroupingMode(val as "alphabet" | "category")
            }
          >
            <Text tag="alphabet">首字母快速索引 (A-Z)</Text>
            <Text tag="category">接入路径分类</Text>
          </Picker>

          <Picker
            title="接入路径筛选"
            value={selectedCategory}
            onChanged={(val: string) =>
              setSelectedCategory(val as ProviderRouteCategory | "all")
            }
          >
            <Text tag="all">{`全部供应商 (${PROVIDERS_CATALOG.length})`}</Text>
            <Text tag="direct_api">直连 API 密钥 / 令牌 (39)</Text>
            <Text tag="gateway">自建与聚合网关 (5)</Text>
            <Text tag="device_oauth">OAuth 设备码与轮询 (7)</Text>
            <Text tag="google_oauth">Google 原生 OAuth (2)</Text>
            <Text tag="web_session">Web 会话与工作台 (25)</Text>
          </Picker>
        </Section>

        {sortGroupingMode === "alphabet"
          ? groupedAlphabetical.map((group) => (
              <Section
                key={group.letter}
                header={<Text>{group.letter}</Text>}
                sectionIndexLabel={group.letter}
              >
                {group.items.map((item) => (
                  <ProviderCatalogRow
                    key={item.id}
                    meta={item}
                    isDemoMode={isDemoMode}
                    onAdd={() => onQuickAddAccount(item.id)}
                  />
                ))}
              </Section>
            ))
          : groupedByRoute.map((group) => (
              <Section
                key={group.category}
                header={
                  <HStack spacing={6}>
                    <Image
                      systemName={routeCategorySymbol(group.category)}
                      font="caption"
                      foregroundStyle="accentColor"
                    />
                    <Text>{`${routeCategoryTitle(group.category)} (${group.items.length})`}</Text>
                  </HStack>
                }
              >
                {group.items.map((item) => (
                  <ProviderCatalogRow
                    key={item.id}
                    meta={item}
                    isDemoMode={isDemoMode}
                    onAdd={() => onQuickAddAccount(item.id)}
                  />
                ))}
              </Section>
            ))}
      </List>
    </NavigationStack>
  )
}

function ProviderCatalogRow(props: {
  meta: ProviderMeta
  isDemoMode: boolean
  onAdd: () => void
}) {
  const { meta, isDemoMode, onAdd } = props

  return (
    <DisclosureGroup
      label={
        <HStack alignment="center" spacing={12}>
          <ProviderIconView provider={meta.id} size={38} />
          <VStack alignment="leading" spacing={3}>
            <HStack spacing={6} alignment="center">
              <Text font="headline" lineLimit={1}>
                {meta.displayName}
              </Text>
              <Text
                font="caption2"
                fontWeight="medium"
                foregroundStyle="secondaryLabel"
                padding={{ horizontal: 6, vertical: 1 }}
                background={<Capsule fill="quaternarySystemFill" />}
                lineLimit={1}
              >
                {loginMethodBadgeText(meta.loginMethod)}
              </Text>
            </HStack>
            <Text
              font="caption"
              foregroundStyle="secondaryLabel"
              lineLimit={1}
            >
              {meta.endpointSummary}
            </Text>
          </VStack>
        </HStack>
      }
    >
      <VStack
        alignment="leading"
        spacing={10}
        padding={{ top: 8, bottom: 4 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <LabeledContent
          title="接入分类"
          value={routeCategoryTitle(meta.routeCategory)}
        />
        <LabeledContent title="凭证类型" value={meta.credentialLabel} />
        <LabeledContent title="认证机制" value={meta.authSummary} />
        <LabeledContent title="直连端点" value={meta.endpointSummary} />

        {meta.webSessionProfile ? (
          <LabeledContent
            title="Cookie 白名单"
            value={meta.webSessionProfile.cookieNames.join(", ")}
          />
        ) : null}

        <Button
          buttonStyle={adaptiveProminentButtonStyle()}
          frame={{ maxWidth: "infinity", alignment: "center" }}
          action={onAdd}
        >
          <HStack
            frame={{ maxWidth: "infinity", alignment: "center" }}
            alignment="center"
            spacing={6}
            padding={{ vertical: 2 }}
          >
            <Image systemName="plus.circle.fill" font="subheadline" />
            <Text
              font="subheadline"
              fontWeight="semibold"
              lineLimit={1}
              multilineTextAlignment="center"
            >
              {isDemoMode
                ? `添加 ${meta.displayName} 演示卡片`
                : `添加 ${meta.displayName} 账号`}
            </Text>
          </HStack>
        </Button>
      </VStack>
    </DisclosureGroup>
  )
}
