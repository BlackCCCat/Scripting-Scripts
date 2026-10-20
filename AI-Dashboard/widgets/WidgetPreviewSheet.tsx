import {
  Button,
  Device,
  HStack,
  NavigationStack,
  Picker,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  Widget,
  useMemo,
  useState,
} from "scripting"
import type { WidgetFamily } from "scripting"
import { loadWidgetRenderData } from "./data_source"
import { WidgetRootView } from "./WidgetRootView"

export function WidgetPreviewSheet(props: {
  onDismiss: () => void
}) {
  const { onDismiss } = props
  const [selectedFamily, setSelectedFamily] =
    useState<WidgetFamily>("systemMedium")
  const [previewMode, setPreviewMode] = useState<"auto" | "demo">("auto")
  const [walletOverride, setWalletOverride] = useState<string | null>(null)

  // 默认优先加载真实账号与快照数据；可切换为模拟演示数据对比
  const data = useMemo(() => {
    const res = loadWidgetRenderData(previewMode === "demo")
    if (walletOverride) {
      const idx = res.accounts.findIndex((a) => a.id === walletOverride)
      if (idx !== -1) {
        const [target] = res.accounts.splice(idx, 1)
        res.accounts.push(target)
      }
    }
    return res
  }, [previewMode, walletOverride])

  const useGlassPresentation =
    Number.parseInt(Device.systemVersion, 10) >= 26

  const frameForFamily = (family: WidgetFamily) => {
    switch (family) {
      case "systemSmall":
        return { width: 160, height: 160 }
      case "systemMedium":
        return { width: 340, height: 160 }
      case "systemLarge":
        return { width: 340, height: 350 }
      case "systemExtraLarge":
      case "systemExtraLargePortrait":
        // 设为 345 宽，确保在 iPhone 屏幕与 iPad 预览中均 100% 完整显示不超边
        return { width: 345, height: 360 }
      default:
        return { width: 340, height: 160 }
    }
  }

  const frame = frameForFamily(selectedFamily)

  return (
    <NavigationStack
      presentationBackground={useGlassPresentation ? "clear" : undefined}
    >
      <ScrollView
        navigationTitle="小组件效果预览"
        navigationBarTitleDisplayMode="inline"
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: (
            <Button
              title="关闭"
              action={onDismiss}
            />
          ),
          topBarTrailing: (
            <Button
              title="系统预览"
              systemImage="arrow.up.forward.app"
              action={() => {
                void Widget.preview({ family: selectedFamily })
              }}
            />
          ),
        }}
      >
        <VStack alignment="center" spacing={16} padding={20}>
          <Picker
            title="小组件尺寸"
            value={selectedFamily}
            onChanged={(val: string) => setSelectedFamily(val as WidgetFamily)}
          >
            <Text tag="systemSmall">小尺寸 (Small)</Text>
            <Text tag="systemMedium">中尺寸 (Medium)</Text>
            <Text tag="systemLarge">大尺寸 (Large)</Text>
            <Text tag="systemExtraLarge">特大尺寸 (Extra Large)</Text>
          </Picker>

          <Picker
            title="数据来源"
            value={previewMode}
            pickerStyle="segmented"
            onChanged={(val: string) => setPreviewMode(val as "auto" | "demo")}
          >
            <Text tag="auto">优先真实数据</Text>
            <Text tag="demo">模拟演示数据</Text>
          </Picker>

          <Text font="caption" foregroundStyle="secondaryLabel">
            {previewMode === "auto"
              ? `已加载应用内配置数据 (${data.totalAccountsCount} 个账号在线)`
              : "正在展示高保真模拟多模型配额与钱包卡包"}
          </Text>

          {/* 拟态桌面小组件外框 */}
          <VStack
            alignment="leading"
            frame={{ width: frame.width, height: frame.height }}
            background={
              <RoundedRectangle
                cornerRadius={24}
                style="continuous"
                fill="secondarySystemBackground"
              />
            }
            clipShape={{ type: "rect", cornerRadius: 24, style: "continuous" }}
          >
            <WidgetRootView
              data={data}
              family={selectedFamily}
              onSelectWalletProvider={(id) => setWalletOverride(id)}
            />
          </VStack>

          <VStack alignment="leading" spacing={8} padding={{ top: 12 }}>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              • 真实桌面上长按小组件选择「编辑」，在「参数」中填入供应商标识（支持逗号分隔多个，如 codex, workbuddy）。
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              • 大号小组件统一采用 2 个中号卡片垂直拼接布局；未填参数默认拼接前两个，填入参数如 workbuddy 或 codex, workbuddy 则优先展示对应供应商（同供应商多账号如 WorkBuddy 会按序号自动合并展示 4 个账号）。
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              • 超大号小组件统一采用 3 个中号卡片垂直拼接布局；未填参数默认拼接前三个，填入参数则优先展示对应供应商（同供应商多账号如 WorkBuddy 会按序号自动合并展示 6 个账号）。
            </Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              • 同一供应商多个单配额账号（如 WorkBuddy）：小号与中号合并前 2 个，大号合并前 4 个，超大号合并前 6 个，标题显示脱敏账号信息并合并进度条。
            </Text>
          </VStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
