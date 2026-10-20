import {
  Button,
  Capsule,
  HStack,
  Image,
  ProgressView,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting"
import {
  AccountQuotaState,
  QuotaSnapshot,
  QuotaWindow,
  SubscriptionAccount,
} from "../models/types"
import {
  CodexResetStatus,
  formatCodexResetLocalTime,
  formatScheduledResetHeadline,
  hasVisibleCodexResetPreview,
} from "../services/codex_reset_feed"
import { getProviderMeta } from "../utils/providers_catalog"
import {
  formatFailureDescription,
  formatPeriodBadgeText,
  formatRelativeCountdown,
  formatShortDateTime,
  formatWalletAmount,
  formatWindowQuotaBreakdown,
  formatWindowRemainingFraction,
  formatWindowSubtitle,
} from "../utils/quota_formatting"
import {
  accountHealthSummary,
  adaptiveSecondaryButtonStyle,
  formatAccountRegionBadge,
  formatAccountTypeBadge,
  maskIdentity,
  remainingQuotaColor,
} from "../utils/theme"
import { ProviderIconView } from "./ProviderIconView"

export function AccountQuotaRow(props: {
  account: SubscriptionAccount
  state: AccountQuotaState
  protectAccountIdentity?: boolean
  codexResetStatus?: CodexResetStatus | null
  onRefresh: () => void
  onOpenDetail: () => void
}) {
  const {
    account,
    state,
    protectAccountIdentity = false,
    codexResetStatus,
    onRefresh,
    onOpenDetail,
  } = props
  const meta = getProviderMeta(account.provider)

  const snapshot: QuotaSnapshot | undefined =
    state.type === "loaded"
      ? state.snapshot
      : state.type === "loading"
        ? state.previous
        : state.type === "failed"
          ? state.previous
          : undefined

  const isLoading = state.type === "loading"
  const health = accountHealthSummary(snapshot)
  const accountTypeBadge = formatAccountTypeBadge(
    account.provider,
    snapshot?.providerPlanName,
    meta.loginMethod
  )
  const regionBadge = formatAccountRegionBadge(
    account.provider,
    account.region || snapshot?.region
  )

  const isWorkBuddyGlobal =
    account.provider === "workBuddy" &&
    (account.region === "global" || snapshot?.region === "global")
  const defaultProviderName = isWorkBuddyGlobal
    ? "Workbuddy AI"
    : meta.displayName
  const rawDisplayName = account.displayName?.trim() || ""
  const titleText = account.id.startsWith("demo-")
    ? defaultProviderName
    : rawDisplayName === "WorkBuddy" && isWorkBuddyGlobal
      ? "Workbuddy AI"
      : rawDisplayName || defaultProviderName

  const walletWindows = (snapshot?.windows ?? []).filter((w) =>
    Boolean(w.wallet)
  )
  const quotaWindows = (snapshot?.windows ?? []).filter((w) => !w.wallet)

  const identity = snapshot?.accountIdentity?.trim() || null
  const [maskOverride, setMaskOverride] = useState<boolean | null>(null)
  const isMasked =
    maskOverride !== null ? maskOverride : protectAccountIdentity
  const displayedIdentity = identity
    ? isMasked
      ? maskIdentity(identity)
      : identity
    : null

  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={{ vertical: 6 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {/* 卡片头部：品牌图标 + [供应商名称 + 区域胶囊 + 账户类型胶囊] + 次行仅展示钱包/余量状态 */}
      <HStack alignment="center" spacing={12}>
        <ProviderIconView
          provider={account.provider}
          size={42}
          dimmed={!account.isEnabled}
        />

        <VStack alignment="leading" spacing={4}>
          <HStack alignment="center" spacing={6}>
            <Text
              font="headline"
              fontWeight="semibold"
              foregroundStyle={account.isEnabled ? "label" : "secondaryLabel"}
              lineLimit={1}
            >
              {titleText}
            </Text>

            {regionBadge ? (
              <Text
                font="caption2"
                fontWeight="medium"
                foregroundStyle="secondaryLabel"
                padding={{ horizontal: 6, vertical: 1.5 }}
                background={<Capsule fill="quaternarySystemFill" />}
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
                layoutPriority={2}
              >
                {regionBadge}
              </Text>
            ) : null}

            <Text
              font="caption2"
              fontWeight="semibold"
              foregroundStyle="accentColor"
              padding={{ horizontal: 7, vertical: 2 }}
              background={<Capsule fill="tertiarySystemFill" />}
              lineLimit={1}
              fixedSize={{ horizontal: true, vertical: false }}
              layoutPriority={2}
            >
              {accountTypeBadge}
            </Text>
          </HStack>

          <HStack alignment="center" spacing={6}>
            <Text
              font="caption"
              fontWeight="medium"
              foregroundStyle={health.color}
              lineLimit={1}
            >
              {`● ${health.label}`}
            </Text>

            {snapshot?.codexResetCards?.availableCount !== undefined ? (
              <Text
                font="caption2"
                fontWeight="bold"
                foregroundStyle="systemIndigo"
                padding={{ horizontal: 6, vertical: 1 }}
                background={<Capsule fill="quaternarySystemFill" />}
                lineLimit={1}
              >
                {`🎟️ 重置卡 ${snapshot.codexResetCards.availableCount} 次`}
              </Text>
            ) : null}
          </HStack>
        </VStack>

        <Spacer />

        <HStack alignment="center" spacing={8}>
          {isLoading ? (
            <ProgressView
              progressViewStyle="circular"
              controlSize="small"
              frame={{ width: 28, height: 28 }}
            />
          ) : (
            <Button
              title="刷新"
              systemImage="arrow.clockwise"
              labelStyle="iconOnly"
              buttonStyle={adaptiveSecondaryButtonStyle()}
              buttonBorderShape="circle"
              controlSize="small"
              action={onRefresh}
            />
          )}
          <Button
            title="设置"
            systemImage="slider.horizontal.3"
            labelStyle="iconOnly"
            buttonStyle={adaptiveSecondaryButtonStyle()}
            buttonBorderShape="circle"
            controlSize="small"
            action={onOpenDetail}
          />
        </HStack>
      </HStack>

      {snapshot ? (
        <VStack
          alignment="leading"
          spacing={10}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {/* Codex 专用：官方/第三方重置预告横幅（有预告时显示，无预告时不显示） */}
          {account.provider === "codex" &&
          codexResetStatus &&
          hasVisibleCodexResetPreview(codexResetStatus) ? (
            <CodexResetNoticeView status={codexResetStatus} />
          ) : null}

          {/* 模块 A：API 钱包与多币种余额（每个币种独立占一行，避免并排拥挤） */}
          {walletWindows.length > 0 ? (
            <VStack
              alignment="leading"
              spacing={8}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {walletWindows.map((win) => (
                <WalletMetricTile
                  key={win.id}
                  provider={account.provider}
                  window={win}
                />
              ))}
            </VStack>
          ) : null}

          {/* 模块 B：周期订阅限流与配额进度条 */}
          {quotaWindows.length > 0 ? (
            <VStack
              alignment="leading"
              spacing={8}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {quotaWindows.map((win) => (
                <QuotaProgressCard key={win.id} window={win} />
              ))}
            </VStack>
          ) : null}

          {/* 刷新异常横幅（若上次刷新失败但保留了缓存快照） */}
          {state.type === "failed" ? (
            <HStack
              spacing={8}
              padding={{ horizontal: 10, vertical: 8 }}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              background={
                <RoundedRectangle
                  cornerRadius={10}
                  style="continuous"
                  fill="quaternarySystemFill"
                />
              }
            >
              <Image
                systemName="exclamationmark.triangle.fill"
                font="caption"
                foregroundStyle="systemOrange"
              />
              <Text font="caption" foregroundStyle="systemOrange">
                {formatFailureDescription(
                  state.failure,
                  account.provider,
                  state.detail
                )}
              </Text>
            </HStack>
          ) : null}

          {/* 卡片底部：账号信息 + 最后同步时间 */}
          <HStack alignment="center" spacing={6}>
            {identity && displayedIdentity ? (
              <Button
                buttonStyle="plain"
                action={() => {
                  setMaskOverride(!isMasked)
                  HapticFeedback.lightImpact()
                }}
              >
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="person.crop.circle"
                    font="caption2"
                    foregroundStyle="secondaryLabel"
                  />
                  <Text
                    font="caption2"
                    fontWeight="medium"
                    foregroundStyle="secondaryLabel"
                    lineLimit={1}
                  >
                    {displayedIdentity}
                  </Text>
                  <Image
                    systemName={isMasked ? "eye.slash" : "eye"}
                    font="caption2"
                    foregroundStyle="tertiaryLabel"
                  />
                </HStack>
              </Button>
            ) : null}
            <Spacer />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {`数据同步于 ${formatShortDateTime(snapshot.collectedAt) ?? "刚刚"}`}
            </Text>
          </HStack>
        </VStack>
      ) : state.type === "failed" ? (
        <VStack
          alignment="leading"
          spacing={8}
          padding={12}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          background={
            <RoundedRectangle
              cornerRadius={12}
              style="continuous"
              fill="quaternarySystemFill"
            />
          }
        >
          <Text font="subheadline" fontWeight="medium" foregroundStyle="systemRed">
            {formatFailureDescription(
              state.failure,
              account.provider,
              state.detail
            )}
          </Text>
          <HStack spacing={12}>
            <Button
              title="立即重试"
              systemImage="arrow.clockwise"
              buttonStyle="borderless"
              font="caption"
              action={onRefresh}
            />
            <Spacer />
            <Button
              title="检查凭证或重登"
              systemImage="key.fill"
              buttonStyle="borderless"
              font="caption"
              action={onOpenDetail}
            />
          </HStack>
        </VStack>
      ) : (
        <HStack
          padding={12}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          background={
            <RoundedRectangle
              cornerRadius={12}
              style="continuous"
              fill="quaternarySystemFill"
            />
          }
        >
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            {isLoading
              ? "正在直连供应商接口拉取实时配额…"
              : "尚无快照数据，点击右上角刷新按钮拉取"}
          </Text>
          <Spacer />
        </HStack>
      )}
    </VStack>
  )
}

function WalletMetricTile(props: {
  provider: SubscriptionAccount["provider"]
  window: QuotaWindow
}) {
  const { provider, window } = props
  const wallet = window.wallet
  if (!wallet) return null

  const hasBreakdown =
    wallet.toppedUp !== undefined || wallet.granted !== undefined

  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={12}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={
        <RoundedRectangle
          cornerRadius={12}
          style="continuous"
          fill="quaternarySystemFill"
        />
      }
    >
      <HStack alignment="center" spacing={8}>
        <ProviderIconView provider={provider} size={20} />
        <Text
          font="subheadline"
          fontWeight="medium"
          foregroundStyle="label"
          lineLimit={1}
        >
          {window.name}
        </Text>
        <Spacer />
        <Text
          font="title3"
          fontWeight="bold"
          monospacedDigit={true}
          foregroundStyle="label"
          lineLimit={1}
        >
          {formatWalletAmount(wallet.total, wallet)}
        </Text>
      </HStack>

      <HStack alignment="center" spacing={10}>
        {hasBreakdown ? (
          <HStack spacing={12}>
            {wallet.toppedUp !== undefined ? (
              <Text
                font="caption2"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
              >
                {`充值 ${formatWalletAmount(wallet.toppedUp, wallet)}`}
              </Text>
            ) : null}
            {wallet.granted !== undefined ? (
              <Text
                font="caption2"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
              >
                {`赠送 ${formatWalletAmount(wallet.granted, wallet)}`}
              </Text>
            ) : null}
          </HStack>
        ) : (
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {wallet.isMonetary ? "实时可用资金池" : "周期内可用计算点数"}
          </Text>
        )}

        <Spacer />

        <Text
          font="caption2"
          fontWeight="semibold"
          foregroundStyle={wallet.isMonetary ? "systemBlue" : "systemPurple"}
          padding={{ horizontal: 6, vertical: 1 }}
          background={<Capsule fill="tertiarySystemFill" />}
        >
          {wallet.isMonetary ? "可用余额" : "可用点数"}
        </Text>
      </HStack>
    </VStack>
  )
}

function QuotaProgressCard(props: { window: QuotaWindow }) {
  const { window } = props
  const remainingFraction = formatWindowRemainingFraction(window)
  const breakdown = formatWindowQuotaBreakdown(window)
  const countdown = formatRelativeCountdown(
    window.resetsAt || window.expiresAt,
    window.resetSemantics
  )
  const periodLabel = formatPeriodBadgeText(window)
  const subtitle = formatWindowSubtitle(window)
  const statusColor = remainingQuotaColor(
    breakdown.remainingPercent,
    window.isExhausted
  )

  return (
    <VStack
      alignment="leading"
      spacing={7}
      padding={12}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={
        <RoundedRectangle
          cornerRadius={12}
          style="continuous"
          fill="quaternarySystemFill"
        />
      }
    >
      {/* 第一行：周期标签 +（仅在有区分度的子套餐时显示的简短标题）+ 右侧重置倒计时 */}
      <HStack alignment="center" spacing={6}>
        <Text
          font="caption2"
          fontWeight="semibold"
          foregroundStyle="accentColor"
          padding={{ horizontal: 7, vertical: 2 }}
          background={<Capsule fill="tertiarySystemFill" />}
        >
          {periodLabel}
        </Text>
        {subtitle ? (
          <Text
            font="subheadline"
            fontWeight="medium"
            foregroundStyle="label"
            lineLimit={1}
          >
            {subtitle}
          </Text>
        ) : null}
        <Spacer />
        {countdown ? (
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {countdown}
          </Text>
        ) : null}
      </HStack>

      {/* 第二行：可视化剩余额度进度条（剩余越少越短，颜色由绿平滑过渡到红，耗尽时全灰） */}
      {remainingFraction !== null ? (
        <ProgressView
          value={remainingFraction}
          total={1}
          progressViewStyle="linear"
          tint={statusColor}
        />
      ) : null}

      {/* 第三行：左侧突出显示「剩余可用」，右侧明确显示「已用 / 总额」 */}
      <HStack alignment="center">
        <Text
          font="caption"
          fontWeight="semibold"
          monospacedDigit={true}
          foregroundStyle={window.isUnlimited ? "systemGreen" : statusColor}
        >
          {breakdown.primaryRemainingText}
        </Text>
        <Spacer />
        <Text
          font="caption"
          monospacedDigit={true}
          foregroundStyle="secondaryLabel"
        >
          {breakdown.secondaryUsedText}
        </Text>
      </HStack>
    </VStack>
  )
}

function CodexResetNoticeView(props: { status: CodexResetStatus }) {
  const { status } = props
  const scheduled = status.data.scheduledReset
  const watch = status.data.activeWatch

  if (scheduled) {
    const headline = formatScheduledResetHeadline(scheduled.scheduledFor)
    const localTimeText = scheduled.scheduledFor
      ? `${formatCodexResetLocalTime(scheduled.scheduledFor)} · 本地时间`
      : null

    return (
      <VStack
        alignment="leading"
        spacing={5}
        padding={{ horizontal: 10, vertical: 8 }}
        background={
          <RoundedRectangle
            cornerRadius={10}
            style="continuous"
            fill="quaternarySystemFill"
          />
        }
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <HStack spacing={6} alignment="center">
          <Image
            systemName="calendar.badge.clock"
            font="caption"
            foregroundStyle="systemOrange"
          />
          <Text font="caption" fontWeight="semibold" foregroundStyle="label">
            Codex 重置预告
          </Text>
          <Spacer />
          <Text
            font="caption2"
            fontWeight="bold"
            foregroundStyle="systemOrange"
            padding={{ horizontal: 6, vertical: 2 }}
            background={
              <RoundedRectangle
                cornerRadius={6}
                fill="systemOrange"
                opacity={0.16}
              />
            }
          >
            {headline}
          </Text>
        </HStack>

        <HStack spacing={6} alignment="center">
          {localTimeText ? (
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {localTimeText}
            </Text>
          ) : null}
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            第三方预告 · Codex Resets
          </Text>
        </HStack>
      </VStack>
    )
  }

  if (watch) {
    const chanceText =
      watch.resetChancePercent != null
        ? `预测概率 ${watch.resetChancePercent}%`
        : "AI 重置预测"
    return (
      <VStack
        alignment="leading"
        spacing={5}
        padding={{ horizontal: 10, vertical: 8 }}
        background={
          <RoundedRectangle
            cornerRadius={10}
            style="continuous"
            fill="quaternarySystemFill"
          />
        }
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <HStack spacing={6} alignment="center">
          <Image
            systemName="sparkles"
            font="caption"
            foregroundStyle="systemIndigo"
          />
          <Text font="caption" fontWeight="semibold" foregroundStyle="label">
            Codex 重置预测
          </Text>
          <Spacer />
          <Text
            font="caption2"
            fontWeight="bold"
            foregroundStyle="systemIndigo"
            padding={{ horizontal: 6, vertical: 2 }}
            background={
              <RoundedRectangle
                cornerRadius={6}
                fill="systemIndigo"
                opacity={0.16}
              />
            }
          >
            {chanceText}
          </Text>
        </HStack>

        <HStack spacing={6} alignment="center">
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {watch.forecastWindow}
          </Text>
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            有效至 {formatCodexResetLocalTime(watch.expiresAt)} · 非官方
          </Text>
        </HStack>
      </VStack>
    )
  }

  return null
}

