import { useDashboardMetricAnimation } from "../utils/dashboard_metric_animation"
import {
  Button, Capsule, Circle, EmptyView, HStack, List, NavigationStack, RoundedRectangle,
  Section, Spacer, Text, useRef, useState, VStack,
} from "scripting"
import { getCodexResetCredits, type CodexResetCards } from "../utils/codex_reset_cards"
import { getDashboardLanguage, localize } from "../utils/localization"
import { formatFailureDescription, formatRelativeCountdown } from "../utils/quota_formatting"
import { QuotaQueryError } from "../providers/_shared/http"

export type RedeemCodexResetCard = (
  creditID: string
) => Promise<"reset" | "nothing_to_reset" | "no_credit" | "already_redeemed">

const day = 24 * 60 * 60 * 1000
const redeemMessages = {
  reset: "已使用重置卡并重置额度",
  nothing_to_reset: "当前没有可重置的额度，这张卡仍可使用",
  no_credit: "这张重置卡已不可用",
  already_redeemed: "这张重置卡已使用",
} as const

function expirationColor(remainingMs: number) {
  if (remainingMs <= day) return "systemRed"
  if (remainingMs <= 3 * day) return "systemOrange"
  if (remainingMs <= 7 * day) return "systemYellow"
  return "systemGreen"
}

export function CodexResetCardsSheet(props: {
  cards: CodexResetCards
  onRedeem?: RedeemCodexResetCard
  onDismiss: () => void
}) {
  const { cards, onRedeem, onDismiss } = props
  const [isUsingCard, setIsUsingCard] = useState(false)
  const busy = useRef(false)
  const [unavailableIDs, setUnavailableIDs] = useState<ReadonlySet<string>>(() => new Set())
  const now = Date.now()
  const dateFormat = new Intl.DateTimeFormat(getDashboardLanguage(), {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const credits = getCodexResetCredits(cards)
    .map((credit) => ({
      ...credit,
      timestamp: credit.expiresAt ? Date.parse(credit.expiresAt) : NaN,
    }))
    .sort((first, second) => (Number.isFinite(first.timestamp) ? first.timestamp : Infinity) -
      (Number.isFinite(second.timestamp) ? second.timestamp : Infinity))
    .slice(0, cards.availableCount)
  const missing = cards.availableCount - credits.length

  const useCredit = async (creditID: string, expirationText: string) => {
    if (!onRedeem || busy.current || unavailableIDs.has(creditID)) return
    busy.current = true
    setIsUsingCard(true)
    try {
      const selectedCard = localize(`所选重置卡：${expirationText}`)
      if (!await Dialog.confirm({
        title: localize("使用这张重置卡？"),
        message: selectedCard,
        confirmLabel: localize("继续"),
        cancelLabel: localize("取消"),
      })) return
      if (!await Dialog.confirm({
        title: localize("确认使用重置卡"),
        message: `${selectedCard}\n${localize("使用后将消耗这张卡并重置符合条件的 Codex 额度。此操作无法撤销。")}`,
        confirmLabel: localize("确认使用"),
        cancelLabel: localize("取消"),
      })) return

      const outcome = await onRedeem(creditID)
      if (outcome !== "nothing_to_reset") {
        setUnavailableIDs((previous) => new Set([...previous, creditID]))
      }
      await Dialog.alert({ message: localize(redeemMessages[outcome]), buttonLabel: localize("完成") })
    } catch (error) {
      const message = error instanceof QuotaQueryError
        ? error.code === "network" || error.code === "unreadableResponse"
          ? localize("未能确认使用结果，请刷新后查看重置卡状态")
          : formatFailureDescription(error.code, "codex")
        : error instanceof Error ? error.message : localize("未能确认使用结果，请刷新后查看重置卡状态")
      await Dialog.alert({
        message,
        buttonLabel: localize("完成"),
      })
    } finally {
      busy.current = false
      setIsUsingCard(false)
    }
  }

  return (
    <NavigationStack presentationDetents={["medium", "large"]} interactiveDismissDisabled={isUsingCard}>
      <List
        listStyle="plain"
        contentMargins={{ edges: "horizontal", insets: 16, placement: "scrollContent" }}
        listSectionSeparator="hidden"
        navigationTitle={localize("Codex 重置卡")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: <Button title={localize("完成")} disabled={isUsingCard} action={onDismiss} />,
        }}
      >
        {cards.availableCount === 0 ? (
          <Section>
            <Text foregroundStyle="secondaryLabel" listRowSeparator="hidden">
              {localize("暂无可用重置卡")}
            </Text>
          </Section>
        ) : (
          <Section>
            {credits.map(({ id, expiresAt, timestamp }, index) => {
              const remainingMs = timestamp - now
              const hasDate = Number.isFinite(timestamp)
              const color = expiresAt === null ? "systemGreen" : hasDate ? expirationColor(remainingMs) : "systemGray"
              const expirationText = expiresAt === null
                ? localize("长期有效")
                : hasDate ? dateFormat.format(timestamp) : localize("到期时间未知")
              const canUse = onRedeem && id && (!hasDate || remainingMs > 0)
              return (
                <HStack
                  key={id ?? `${expiresAt}-${index}`}
                  alignment="center"
                  spacing={10}
                  listRowInsets={{ top: 4, bottom: 4, leading: 0, trailing: 0 }}
                  listRowSeparator="hidden"
                  listRowBackground={<EmptyView />}
                  padding={12}
                  background={<RoundedRectangle cornerRadius={12} fill={color} opacity={0.16} />}
                >
                  <Circle fill={color} frame={{ width: 9, height: 9 }} accessibilityHidden={true} />
                  <VStack alignment="leading" spacing={3}>
                    <Text font="headline" fixedSize={{ horizontal: false, vertical: true }}>{expirationText}</Text>
                    {hasDate && expiresAt ? (
                      <Text font="subheadline" foregroundStyle="secondaryLabel">
                        {localize(remainingMs <= 0
                          ? "已到期"
                          : formatRelativeCountdown(expiresAt, "nonResettingAllowance"))}
                      </Text>
                    ) : null}
                  </VStack>
                  <Spacer minLength={0} />
                  {canUse ? (
                    <Button
                      title={localize("使用")}
                      buttonStyle="bordered"
                      disabled={isUsingCard || unavailableIDs.has(id)}
                      action={() => useCredit(id, expirationText)}
                    />
                  ) : null}
                </HStack>
              )
            })}
            {missing > 0 ? (
              <Text foregroundStyle="secondaryLabel">
                {localize(`${missing} 张重置卡暂无到期明细`)}
              </Text>
            ) : null}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

export function CodexResetCardsBadge(props: {
  availableCount: number
  isEnglish: boolean
  onOpen: () => void
}) {
  const { availableCount, isEnglish, onOpen } = props
  const metrics = useDashboardMetricAnimation({ count: availableCount })
  const count = Math.round(metrics.value("count"))
  const countText = localize(`🎟️ 重置卡 ${count} 次`)

  return (
    <Button
      {...metrics.lifecycle}
      buttonStyle="plain"
      accessibilityLabel={localize(`🎟️ 重置卡 ${availableCount} 次`)}
      accessibilityHint={localize("查看重置卡到期时间")}
      action={onOpen}
    >
      <Text
        font="caption2"
        fontWeight="bold"
        foregroundStyle="systemIndigo"
        padding={{ horizontal: 6, vertical: 1 }}
        background={<Capsule fill="quaternarySystemFill" />}
        fixedSize={isEnglish ? { horizontal: false, vertical: true } : undefined}
        lineLimit={isEnglish ? undefined : 1}
        {...metrics.rollingText("count", countText)}
      >
        {countText}
      </Text>
    </Button>
  )
}
