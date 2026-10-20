import {
  Divider,
  Image,
  Spacer,
  Text,
  VStack,
} from "scripting"
import { MediumAccountCard } from "./MediumWidgetView"
import type { WidgetRenderData } from "../types"

/**
 * 大号小组件视图
 * 统一采用 2 个中号卡片垂直拼接的原生极简布局
 * - 未填参数时：默认垂直拼接前 2 个账号；
 * - 填入参数时：优先将匹配的供应商（支持单供应商多账号自动合并成对）置顶拼接展示。
 */
export function LargeWidgetView(props: {
  data: WidgetRenderData
}) {
  const { data } = props
  const accounts = data.accounts

  if (!accounts || accounts.length === 0) {
    return (
      <VStack
        alignment="leading"
        spacing={8}
        padding={16}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Image
          systemName="chart.bar.doc.horizontal.fill"
          font={22}
          foregroundStyle="accentColor"
        />
        <Text font="headline" fontWeight="bold">
          AI 额度看板
        </Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="secondaryLabel">
          暂未配置监控账号，请在应用内添加供应商
        </Text>
      </VStack>
    )
  }

  // 仅配置 1 个账号时单独占满卡片
  if (accounts.length === 1) {
    return (
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        widgetURL="ai-dashboard://overview"
      >
        <MediumAccountCard
          account={accounts[0]}
          lastUpdatedAt={data.lastUpdatedAt}
          heightMode="normal"
          showUpdatedAt={true}
        />
      </VStack>
    )
  }

  // 拼接 2 个中号卡片（底部卡片显示小组件统一刷新时间）
  return (
    <VStack
      alignment="leading"
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      widgetURL="ai-dashboard://overview"
    >
      <MediumAccountCard
        account={accounts[0]}
        heightMode="normal"
        showUpdatedAt={false}
      />
      <Divider />
      <MediumAccountCard
        account={accounts[1]}
        lastUpdatedAt={data.lastUpdatedAt}
        heightMode="normal"
        showUpdatedAt={true}
      />
    </VStack>
  )
}
