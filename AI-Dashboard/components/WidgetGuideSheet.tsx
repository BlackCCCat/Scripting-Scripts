import {
  Button,
  Device,
  Markdown,
  NavigationStack,
  ScrollView,
  type MarkdownProps,
  type PresentationDetent,
} from "scripting"

const WIDGET_GUIDE_MARKDOWN = `
# 桌面小组件使用指南

欢迎使用 AI 额度看板桌面小组件！小组件原生支持 iOS / iPadOS 系统的 **小号 (Small)**、**中号 (Medium)**、**大号 (Large)** 以及 iPad 专属的 **超大号 (Extra Large)** 四种尺寸，让您无需打开应用即可随时洞察所有 AI 供应商的额度水位与限流重置倒计时。

---

## 快速上手：如何在桌面添加与编辑

1. **添加小组件**：返回 iPhone/iPad 桌面，长按空白处进入抖动编辑模式，点击左上角「\`+\`」号。
2. **选择 Scripting**：在组件库中搜索并轻点「\`Scripting\`」，选择「AI Dashboard」脚本。
3. **选择所需尺寸**：左右滑动选择您心仪的尺寸（小/中/大/特大），点击「添加小组件」。
4. **编辑入参（可选）**：长按已添加到桌面的小组件，在弹出菜单中点击「**编辑小组件**」，在「**参数 (Parameter)**」输入框中填入目标供应商名称或留空。

---

## 参数配置规则 (Parameter)

### 1. 留空（不传参数）
- **默认行为**：严格按照您在应用内「AI 额度看板」中设定的账号排列顺序（可在看板左上角点击「编辑」按钮自由拖拽排序）自动提取展示前 N 个账号。
  - **小号**：展示排在第 1 位的账号；
  - **中号**：展示排在第 1 位的账号（或自动合并的前 2 个单配额账号）；
  - **大号**：垂直拼接展示排名前 2 位的账号卡片；
  - **超大号**：垂直拼接展示排名前 3 位的账号卡片。

### 2. 传入参数（指定供应商）
- **支持的内容**：
  - **供应商 ID**：如 \`deepseek\`、\`codex\`、\`claude\`、\`workbuddy\`、\`antigravity\`、\`volcengine\`、\`minimax\`、\`newapi\` 等。
  - **供应商名称/别名**：如 \`OpenAI\`、\`ChatGPT\`、\`Anthropic\`、\`Gemini\`、\`方舟\`、\`百炼\` 等（英文不区分大小写）。
- **多参数写法**：
  - 支持使用 **逗号**（\`,\` 或 \`，\`）或 **空格** 分隔多个供应商。
  - **大号小组件**：支持传入 2 个参数（如 \`deepseek, codex\` 或 \`claude minimax\`），分别展示对应的中号卡片。
  - **超大号小组件**：支持传入 3 个参数（如 \`deepseek, codex, claude\`），分别展示对应的 3 个中号卡片。

---

## 各种尺寸小组件规格详解

### 1. 小号小组件 (System Small, 1x1)
- **多配额/主模型供应商（如 Codex、Antigravity、Claude 等）**：
  - 核心展示 82pt 宽幅**环形仪表盘**，动态呈现剩余额度占比与具体点数/积分（例如 \`640/1000 积分\`）。
  - 下方显示主模型重置倒计时、重置卡余量或钱包余额。
- **单配额多账号供应商（如 WorkBuddy）**：
  - 自动检测并合并该供应商的**前 2 个账号**，采用紧凑双进度条呈现，顶部展示账号脱敏身份，直观对比双号剩余积分。
- **纯钱包/按量计费供应商（如 DeepSeek、SiliconFlow）**：
  - 居中突出展示可用余额总额（¥/\\$），附带充值金、赠送金与健康状态标记。

### 2. 中号小组件 (System Medium, 2x1)
- **标准卡片视图**：
  - 顶部左侧展示供应商图标、名称、地域节点胶囊及当前订阅套餐类型；
  - 右侧显示当前账号身份（隐私遮罩）、重置卡次数或状态徽章；
  - 中部完整展示多模型限流窗口进度条（例如 5 小时限流、周配额）、具体点数与剩余百分比；
  - 右下角展示小组件最近一次数据同步更新时间。
- **单配额多账号合并**：
  - 针对同一供应商仅有一个配额项的账号（如 WorkBuddy），中号小组件自动合并展示**前 2 个账号**的双进度条卡片。

### 3. 大号小组件 (System Large, 2x2)
- **设计布局**：采用 **2 个中号卡片垂直拼接** 的原生极简结构，规整对称、信息密度极高。
- **两参数指定**：当在小组件参数中填入 2 个供应商（如 \`deepseek, codex\`）时，分别将两者渲染为独立的中号卡片垂直拼接。
- **未填参数**：默认自动将看板中排序排在前 2 位的账号拼接展示。
- **单参数多账号（如填入 \`workbuddy\`）**：
  - 自动聚合提取该供应商在看板中的**前 4 个账号**，两两合并为 2 个双账号中号卡片垂直拼接展示！

### 4. 超大号小组件 (Extra Large / Extra Large Portrait - iPad 专属)
- **设计布局**：针对 iPadOS 宽屏深度适配，采用 **3 个中号卡片垂直拼接**，各卡片高度、进度条宽度与字体字号严格对齐标准中号组件。
- **三参数指定**：在小组件参数中填入 3 个供应商（如 \`deepseek, codex, claude\`），分别渲染 3 个供应商的中号卡片。
- **未填参数**：默认自动拼接看板中排名前 3 位的账号。
- **单参数多账号（如填入 \`workbuddy\`）**：
  - 自动聚合提取该供应商在看板中的**前 6 个账号**，两两合并为 3 个双账号中号卡片垂直拼接展示！

---

## 高级特性与实用技巧

### 1. 同一供应商多账号排序（小组件序号）
- 若您拥有多个同一平台的账号（如 4 个以上 WorkBuddy 账号）：
- 在看板点击该账号卡片 -> 点击右上角「设置」进入账号详情编辑页；
- 在「**小组件序号 (可选)**」中填入自定义数字序号（例如 1、2、3、4…）；
- 小组件合并时将严格**按序号由小到大排序**优先合并（小号/中号合并前 2 个，大号合并前 4 个，超大号合并前 6 个）。

### 2. 小组件账号隐私保护
- 在「设置」页面中，开启「**小组件账号隐私保护**」开关；
- 当小组件渲染账号信息时，所有邮箱、用户名等敏感标识均会自动进行星号脱敏（如 \`d***r@gmail.com\`），即使锁屏或公开桌面也无需担心泄露。

### 3. 用量标识适配透明模式
- 在「设置」-「桌面小组件」中开启「**用量标识适配透明模式**」；
- 默认情况下各供应商标题后以圆点颜色区分用量等级（绿/黄/橙/红/灰）；开启该开关后，在透明桌面或无色底图下，用量状态将通过圆点尺寸大小进行直观区分（大圆点代表余量充足、中圆点代表适中、小圆点代表偏低、微点代表告急、空心圆点代表耗尽），无需色彩对比即可一眼确认额度健康。

### 4. 小组件刷新机制与后台调度
- **iOS 系统调度**：小组件受 Apple WidgetKit 能源管理策略与网络预算限制，系统会根据电量与使用频率智能调度后台轮询；
- **自定义刷新间隔**：可在「设置」-「桌面小组件」中选择刷新间隔（支持 15 分钟、30 分钟、1 小时、2 小时、6 小时，默认推荐 30 分钟）；
- **实时瞬时同步**：无论后台定时策略为何，每当您在应用内**添加新账号**、**修改排序**、**下拉刷新看板**或**退出应用**时，系统都会立即向所有桌面小组件广播最新额度快照！
`

export function WidgetGuideSheet(props: {
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
  onDismiss: () => void
}) {
  const useGlassPresentation =
    Number.parseInt(Device.systemVersion, 10) >= 26

  return (
    <NavigationStack
      presentationBackground={useGlassPresentation ? "clear" : undefined}
    >
      <ScrollView
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle="小组件使用说明"
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={props.detents ?? ["large"]}
        presentationBackground={useGlassPresentation ? "clear" : undefined}
        padding={{ top: 20, leading: 18, bottom: 20, trailing: 18 }}
        toolbar={{
          topBarTrailing: (
            <Button
              title="完成"
              action={props.onDismiss}
            />
          ),
        }}
      >
        <Markdown
          content={WIDGET_GUIDE_MARKDOWN.trim()}
          theme={props.theme ?? "basic"}
          useDefaultHighlighterTheme={true}
          scrollable={false}
          background="clear"
        />
      </ScrollView>
    </NavigationStack>
  )
}
