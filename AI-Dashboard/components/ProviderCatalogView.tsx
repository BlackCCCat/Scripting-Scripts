import { getDashboardLanguage, localize } from "../utils/localization"
import {
  Button,
  Capsule,
  DisclosureGroup,
  FlowLayout,
  HStack,
  Image,
  LabeledContent,
  List,
  NavigationStack,
  Picker,
  Section,
  Text,
  useMemo,
  useState,
  VirtualNode,
  VStack,
} from "scripting"
import {
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderMeta,
  ProviderRouteCategory,
  SubscriptionAccount,
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
import { AddAccountSheet } from "./AddAccountSheet"

const ALL_ROUTE_CATEGORIES: ProviderRouteCategory[] = [
  "direct_api",
  "gateway",
  "device_oauth",
  "google_oauth",
  "web_session",
]

export function ProviderCatalogView(props: {
  isDemoMode: boolean
  defaultSynchronizable: boolean
  isHomeScreen?: boolean
  zoomNamespace?: any
  tabSwitchMenu?: VirtualNode
  onQuickAddAccount: (provider: ProviderId) => void
  onAccountCreated?: (
    account: SubscriptionAccount,
    envelope: ProviderCredentialEnvelope
  ) => void
  onDismiss: () => void
}) {
  const {
    isDemoMode,
    isHomeScreen = false,
    zoomNamespace,
    tabSwitchMenu,
    onQuickAddAccount,
    onAccountCreated,
    onDismiss,
  } = props
  const [searchText, setSearchText] = useState<string>("")
  const [selectedCategory, setSelectedCategory] = useState<
    ProviderRouteCategory | "all"
  >("all")
  const [sortGroupingMode, setSortGroupingMode] = useState<
    "alphabet" | "category"
  >("alphabet")
  const [addingProvider, setAddingProvider] = useState<{
    provider: ProviderId
    nonce: number
  } | null>(null)

  const filtered = useMemo(
    () => searchProviders(searchText, selectedCategory),
    [searchText, selectedCategory, getDashboardLanguage()]
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

  const handleAdd = (provider: ProviderId) => {
    if (isHomeScreen) {
      setAddingProvider({ provider, nonce: Date.now() })
    } else {
      onQuickAddAccount(provider)
    }
  }

  const listContent = (
    <List
      navigationTitle={localize(`供应商目录 (${filtered.length})`)}
      listStyle="insetGroup"
      listSectionIndexVisibility="automatic"
      searchable={{
        value: searchText,
        onChanged: setSearchText,
        prompt: localize("搜索供应商、认证协议或 API 端点"),
      }}
      toolbar={{
        topBarLeading: isHomeScreen
          ? tabSwitchMenu
          : (
            <Button
              title={localize("退出")}
              systemImage="xmark"
              action={onDismiss}
            />
          ),
      }}
      navigationDestination={
        isHomeScreen
          ? {
              isPresented: Boolean(addingProvider),
              onChanged: (open) => {
                if (!open) setAddingProvider(null)
              },
              content: addingProvider ? (
                <AddAccountSheet
                  key={addingProvider.nonce}
                  initialProviderId={addingProvider.provider}
                  defaultSynchronizable={props.defaultSynchronizable}
                  startWithPicker={false}
                  embedded={true}
                  zoomNamespace={zoomNamespace}
                  navigationTransition={
                    zoomNamespace
                      ? {
                          type: "zoom",
                          sourceID: `catalog-add-${addingProvider.provider}`,
                          namespace: zoomNamespace,
                        }
                      : undefined
                  }
                  onCancel={() => setAddingProvider(null)}
                  onAccountCreated={(account, envelope) => {
                    setAddingProvider(null)
                    if (onAccountCreated) {
                      onAccountCreated(account, envelope)
                    } else {
                      onQuickAddAccount(account.provider)
                    }
                  }}
                />
              ) : (
                <Text> </Text>
              ),
            }
          : undefined
      }
    >
        <Section
          header={<Text>{localize("分类与排序")}</Text>}
          footer={
            <Text>
              {localize("所有供应商均采用客户端直连，不经过任何第三方中转后端")}</Text>
          }
        >
          <Picker
            title={localize("排序与分组")}
            value={sortGroupingMode}
            onChanged={(val: string) =>
              setSortGroupingMode(val as "alphabet" | "category")
            }
          >
            <Text tag="alphabet">{localize("首字母快速索引 (A-Z)")}</Text>
            <Text tag="category">{localize("接入路径分类")}</Text>
          </Picker>

          <Picker
            title={localize("接入路径筛选")}
            value={selectedCategory}
            onChanged={(val: string) =>
              setSelectedCategory(val as ProviderRouteCategory | "all")
            }
          >
            <Text tag="all">{localize(`全部供应商 (${PROVIDERS_CATALOG.length})`)}</Text>
            <Text tag="direct_api">{localize("直连 API 密钥 / 令牌 (39)")}</Text>
            <Text tag="gateway">{localize("自建与聚合网关 (5)")}</Text>
            <Text tag="device_oauth">{localize("OAuth 设备码与轮询 (7)")}</Text>
            <Text tag="google_oauth">{localize("Google 原生 OAuth (2)")}</Text>
            <Text tag="web_session">{localize("Web 会话与工作台 (25)")}</Text>
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
                    zoomSource={
                      zoomNamespace
                        ? {
                            id: `catalog-add-${item.id}`,
                            namespace: zoomNamespace,
                          }
                        : undefined
                    }
                    onAdd={() => handleAdd(item.id)}
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
                    <Text>{localize(`${routeCategoryTitle(group.category)} (${group.items.length})`)}</Text>
                  </HStack>
                }
              >
                {group.items.map((item) => (
                  <ProviderCatalogRow
                    key={item.id}
                    meta={item}
                    isDemoMode={isDemoMode}
                    zoomSource={
                      zoomNamespace
                        ? {
                            id: `catalog-add-${item.id}`,
                            namespace: zoomNamespace,
                          }
                        : undefined
                    }
                    onAdd={() => handleAdd(item.id)}
                  />
                ))}
              </Section>
            ))}
      </List>
  )

  if (isHomeScreen) {
    return listContent
  }

  return <NavigationStack>{listContent}</NavigationStack>
}

function ProviderCatalogRow(props: {
  meta: ProviderMeta
  isDemoMode: boolean
  zoomSource?: { id: string | number; namespace: any }
  onAdd: () => void
}) {
  const { meta, isDemoMode, zoomSource, onAdd } = props
  const isEnglish = getDashboardLanguage() === "en"
  const HeadingLayout = isEnglish ? FlowLayout : HStack

  return (
    <DisclosureGroup
      label={
        <HStack alignment="center" spacing={12}>
          <ProviderIconView provider={meta.id} size={38} />
          <VStack alignment="leading" spacing={3}>
            <HeadingLayout spacing={6}>
              <Text font={isEnglish ? "subheadline" : "headline"} lineLimit={isEnglish ? undefined : 1}>
                {localize(meta.displayName)}
              </Text>
              <Text
                font="caption2"
                fontWeight="medium"
                foregroundStyle="secondaryLabel"
                padding={{ horizontal: 6, vertical: 1 }}
                background={<Capsule fill="quaternarySystemFill" />}
                lineLimit={isEnglish ? undefined : 1}
              >
                {localize(loginMethodBadgeText(meta.loginMethod))}
              </Text>
            </HeadingLayout>
            <Text
              font="caption"
              foregroundStyle="secondaryLabel"
              lineLimit={isEnglish ? 2 : 1}
            >
              {localize(meta.endpointSummary)}
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
          title={localize("接入分类")}
          value={localize(routeCategoryTitle(meta.routeCategory))}
        />
        <LabeledContent title={localize("凭证类型")} value={localize(meta.credentialLabel)} />
        <LabeledContent title={localize("认证机制")} value={localize(meta.authSummary)} />
        <LabeledContent title={localize("直连端点")} value={localize(meta.endpointSummary)} />

        {meta.webSessionProfile ? (
          <LabeledContent
            title={localize("Cookie 白名单")}
            value={meta.webSessionProfile.cookieNames.join(", ")}
          />
        ) : null}

        <Button
          buttonStyle={adaptiveProminentButtonStyle()}
          frame={{ maxWidth: "infinity", alignment: "center" }}
          matchedTransitionSource={zoomSource}
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
              lineLimit={isEnglish ? undefined : 1}
              multilineTextAlignment="center"
            >
              {localize(isDemoMode
                ? `添加 ${meta.displayName} 演示卡片`
                : `添加 ${meta.displayName} 账号`)}
            </Text>
          </HStack>
        </Button>
      </VStack>
    </DisclosureGroup>
  )
}
