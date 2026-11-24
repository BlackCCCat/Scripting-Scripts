import { localize } from "../utils/localization"
import {
  Button,
  ContentUnavailableView,
  ForEach,
  HStack,
  List,
  NavigationStack,
  Section,
  Text,
  useEffect,
  useObservable,
  useRef,
  VStack,
} from "scripting"
import { SubscriptionAccount } from "../models/types"
import { localizeAccountName } from "../utils/providers_catalog"
import { ProviderIconView } from "./ProviderIconView"

export type AccountOrderEditSheetProps = {
  accounts: SubscriptionAccount[]
  embedded?: boolean
  navigationTransition?: { type: "zoom"; sourceID: string | number; namespace: any }
  onReorderAccounts: (reordered: SubscriptionAccount[]) => void
  onDeleteAccount: (accountId: string) => void
  onDismiss: () => void
  onCancel: () => void
}

export function AccountOrderEditSheet(props: AccountOrderEditSheetProps) {
  const {
    accounts,
    onReorderAccounts,
    onDeleteAccount,
    onDismiss,
    onCancel,
  } = props

  const accountsObservable = useObservable<SubscriptionAccount[]>(() => accounts)
  const editMode = useObservable(() => EditMode.active())
  const listOrder = useRef(accounts)
  const actions = useRef({ onReorderAccounts, onDeleteAccount })
  actions.current = { onReorderAccounts, onDeleteAccount }

  useEffect(() => {
    const listener = (next: SubscriptionAccount[]) => {
      const previous = listOrder.current
      if (next.length === previous.length && next.every((account, i) => account.id === previous[i].id)) return
      listOrder.current = next

      if (next.length < previous.length) {
        const remainingIds = new Set(next.map((account) => account.id))
        for (const account of previous) {
          if (!remainingIds.has(account.id)) actions.current.onDeleteAccount(account.id)
        }
        return
      }
      actions.current.onReorderAccounts(next)
    }
    accountsObservable.subscribe(listener)
    return () => accountsObservable.unsubscribe(listener)
  }, [accountsObservable])

  useEffect(() => {
    // Record the parent order before updating the native binding so it can't echo back as an edit.
    const previous = listOrder.current
    listOrder.current = accounts
    if (accounts.length === previous.length && accounts.every((account, i) => account === previous[i])) return
    accountsObservable.setValue(accounts)
  }, [accounts, accountsObservable])

  const content = (
    <List
      tint="systemIndigo"
      navigationTitle={localize("编辑账号卡片")}
      listStyle="insetGroup"
      navigationTransition={props.navigationTransition}
      environments={{
        editMode,
      }}
      toolbar={{
        topBarLeading: props.embedded ? undefined : (
          <Button
            title={localize("取消")}
            action={onCancel}
          />
        ),
        topBarTrailing: (
          <Button
            title={localize("完成")}
            fontWeight="semibold"
            action={onDismiss}
          />
        ),
      }}
    >
        {accountsObservable.value.length === 0 ? (
          <Section>
            <ContentUnavailableView
              title={localize("暂无已添加的账号")}
              systemImage="tray"
              description={localize("请先在首页添加 AI 供应商账号")}
            />
          </Section>
        ) : (
          <Section
            header={<Text>{localize("拖动排序与删除")}</Text>}
            footer={
              <Text>
                {localize("按住右侧三道杠滑块可上下拖动调整在首页的展示顺序；向左滑动或点击红圈可删除对应供应商账号。")}</Text>
            }
          >
            <ForEach
              data={accountsObservable}
              editActions="all"
              builder={(acc) => {
                return (
                  <HStack
                    key={acc.id}
                    alignment="center"
                    spacing={12}
                    padding={{ vertical: 4 }}
                    trailingSwipeActions={{
                      allowsFullSwipe: true,
                      actions: [
                        <Button
                          title={localize("删除")}
                          systemImage="trash"
                          role="destructive"
                          tint="red"
                          action={() => onDeleteAccount(acc.id)}
                        />,
                      ],
                    }}
                  >
                    <ProviderIconView provider={acc.provider} size={32} />
                    <VStack alignment="leading" spacing={2}>
                      <Text font="headline">{localizeAccountName(acc.provider, acc.displayName)}</Text>
                    </VStack>
                  </HStack>
                )
              }}
            />
          </Section>
        )}
      </List>
  )

  if (props.embedded) {
    return content
  }

  return <NavigationStack>{content}</NavigationStack>
}
