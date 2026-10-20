import {
  Button,
  ContentUnavailableView,
  ForEach,
  HStack,
  Image,
  List,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
} from "scripting"
import { SubscriptionAccount } from "../models/types"
import { ProviderIconView } from "./ProviderIconView"

export type AccountOrderEditSheetProps = {
  accounts: SubscriptionAccount[]
  onMoveAccounts: (indices: number[], newOffset: number) => void
  onDeleteAccount: (accountId: string) => void
  onDismiss: () => void
  onCancel: () => void
}

export function AccountOrderEditSheet(props: AccountOrderEditSheetProps) {
  const { accounts, onMoveAccounts, onDeleteAccount, onDismiss, onCancel } =
    props

  return (
    <NavigationStack>
      <List
        navigationTitle="编辑账号卡片"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
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
        {accounts.length === 0 ? (
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
                长按右侧滑块可上下拖动调整在首页的展示顺序；向左滑动可删除对应供应商账号。
              </Text>
            }
          >
            <ForEach
              count={accounts.length}
              onMove={onMoveAccounts}
              onDelete={(indices) => {
                indices.forEach((idx) => {
                  const acc = accounts[idx]
                  if (acc) onDeleteAccount(acc.id)
                })
              }}
              itemBuilder={(idx) => {
                const acc = accounts[idx]
                if (!acc) return <VStack />
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
                          action={() => onDeleteAccount(acc.id)}
                        />,
                      ],
                    }}
                  >
                    <ProviderIconView provider={acc.provider} size={32} />
                    <VStack alignment="leading" spacing={2}>
                      <Text font="headline">{acc.displayName}</Text>
                    </VStack>
                    <Spacer />
                    <Image
                      systemName="line.3.horizontal"
                      font="subheadline"
                      foregroundStyle="tertiaryLabel"
                    />
                  </HStack>
                )
              }}
            />
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
