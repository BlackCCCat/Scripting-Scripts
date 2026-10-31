import {
  Button,
  ContentUnavailableView,
  ForEach,
  HStack,
  List,
  NavigationStack,
  Section,
  Text,
  VStack,
  useEffect,
  useObservable,
  useState,
} from "scripting"
import { SubscriptionAccount } from "../models/types"
import { ProviderIconView } from "./ProviderIconView"

export type AccountOrderEditSheetProps = {
  accounts: SubscriptionAccount[]
  embedded?: boolean
  zoomNamespace?: any
  navigationTransition?: { type: "zoom"; sourceID: string | number; namespace: any }
  onMoveAccounts?: (indices: number[], newOffset: number) => void
  onReorderAccounts?: (reordered: SubscriptionAccount[]) => void
  onDeleteAccount: (accountId: string) => void
  onDismiss: () => void
  onCancel: () => void
}

/**
 * 账号拖动排序与删除弹窗
 * 使用 Scripting / SwiftUI 官方原生 API：
 * 1. List environments={{ editMode }} 激活原生 EditMode.active()；
 * 2. ForEach 绑定 data={accountsObservable} 与 editActions="all"；
 * 3. 订阅 accountsObservable 实现原生拖动松手后的即时数据同步与持久化，绝不回弹。
 */
export function AccountOrderEditSheet(props: AccountOrderEditSheetProps) {
  const {
    accounts: initialAccounts,
    onMoveAccounts,
    onReorderAccounts,
    onDeleteAccount,
    onDismiss,
    onCancel,
  } = props

  const accountsObservable = useObservable<SubscriptionAccount[]>(() => initialAccounts)
  const editMode = useObservable(() => EditMode.active())
  const [skipNextSync] = useState(() => ({ current: false }))

  useEffect(() => {
    accountsObservable.setValue(initialAccounts)
  }, [initialAccounts])

  // 原生 SwiftUI 在拖动完成时会自动更新 accountsObservable 并触发 subscribe
  useState(() => {
    accountsObservable.subscribe((nextAccounts) => {
      if (skipNextSync.current) {
        skipNextSync.current = false
        return
      }
      onReorderAccounts?.(nextAccounts)
    })
    return true
  })

  const handleMove = (indices: number[], newOffset: number) => {
    skipNextSync.current = true
    const current = [...accountsObservable.value]
    const moving = indices.map((i) => current[i]).filter(Boolean)
    if (moving.length === 0) return
    const rest = current.filter((_, i) => !indices.includes(i))
    const insertAt = Math.max(0, Math.min(rest.length, newOffset))
    rest.splice(insertAt, 0, ...moving)
    accountsObservable.setValue(rest)
    onReorderAccounts?.(rest)
    onMoveAccounts?.(indices, newOffset)
  }

  const handleDelete = (indices: number[]) => {
    skipNextSync.current = true
    const current = [...accountsObservable.value]
    const idsToDelete = indices.map((i) => current[i]?.id).filter(Boolean)
    const rest = current.filter((_, i) => !indices.includes(i))
    accountsObservable.setValue(rest)
    onReorderAccounts?.(rest)
    idsToDelete.forEach((id) => onDeleteAccount(id))
  }

  const content = (
    <List
      navigationTitle="编辑账号卡片"
      listStyle="insetGroup"
      navigationTransition={props.navigationTransition}
      environments={{
        editMode,
      }}
      toolbar={{
        topBarLeading: props.embedded ? undefined : (
          <Button
            title="取消"
            action={onCancel}
          />
        ),
        topBarTrailing: (
          <Button
            title="完成"
            fontWeight="semibold"
            action={onDismiss}
          />
        ),
      }}
    >
        {accountsObservable.value.length === 0 ? (
          <Section>
            <ContentUnavailableView
              title="暂无已添加的账号"
              systemImage="tray"
              description="请先在首页添加 AI 供应商账号"
            />
          </Section>
        ) : (
          <Section
            header={<Text>拖动排序与删除</Text>}
            footer={
              <Text>
                按住右侧三道杠滑块可上下拖动调整在首页的展示顺序；向左滑动或点击红圈可删除对应供应商账号。
              </Text>
            }
          >
            <ForEach
              data={accountsObservable}
              editActions="all"
              onMove={handleMove}
              onDelete={handleDelete}
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
                          title="删除"
                          systemImage="trash"
                          role="destructive"
                          tint="red"
                          action={() => {
                            skipNextSync.current = true
                            const rest = accountsObservable.value.filter((a) => a.id !== acc.id)
                            accountsObservable.setValue(rest)
                            onReorderAccounts?.(rest)
                            onDeleteAccount(acc.id)
                          }}
                        />,
                      ],
                    }}
                  >
                    <ProviderIconView provider={acc.provider} size={32} />
                    <VStack alignment="leading" spacing={2}>
                      <Text font="headline">{acc.displayName}</Text>
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
