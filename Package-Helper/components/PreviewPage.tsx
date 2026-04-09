import {
  Button,
  ForEach,
  List,
  NavigationStack,
  Section,
  Text,
} from "scripting"
import { EmptyPickupBlock, PickupRow } from "./common"
import { clearPreviewResults, getPreviewPickupInfo, handleAnyData, loadConfig, safeRefreshWidget } from "../utils"

export function PreviewPage(props: {
  onChanged: () => void
  onDelete: (code: string) => void
  onClear: () => void
}) {
  const cfg = loadConfig()
  const previewItems = getPreviewPickupInfo(cfg)

  const groupedItems = [
    {
      title: "今天",
      items: previewItems.filter((item) => {
        const value = item.date || item.importedAt
        if (!value) return false
        const date = new Date(value)
        const now = new Date()
        return date.toDateString() === now.toDateString()
      }),
    },
    {
      title: "近3天",
      items: previewItems.filter((item) => {
        const value = item.date || item.importedAt
        if (!value) return false
        const time = new Date(value).getTime()
        if (!Number.isFinite(time)) return false
        const now = Date.now()
        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)
        return time < startOfToday.getTime() && time >= now - 3 * 24 * 60 * 60 * 1000
      }),
    },
    {
      title: "近7天",
      items: previewItems.filter((item) => {
        const value = item.date || item.importedAt
        if (!value) return false
        const time = new Date(value).getTime()
        if (!Number.isFinite(time)) return false
        const now = Date.now()
        return time < now - 3 * 24 * 60 * 60 * 1000 && time >= now - 7 * 24 * 60 * 60 * 1000
      }),
    },
    {
      title: "更早",
      items: previewItems.filter((item) => {
        const value = item.date || item.importedAt
        if (!value) return true
        const time = new Date(value).getTime()
        if (!Number.isFinite(time)) return true
        return time < Date.now() - 7 * 24 * 60 * 60 * 1000
      }),
    },
  ].filter((group) => group.items.length > 0)

  return (
    <NavigationStack>
      <List
        navigationTitle="预览"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
            <Button
              title="清空"
              action={async () => {
                const ok = await Dialog.confirm({
                  title: "清空解析结果",
                  message: "这只会清空预览页中的解析结果，不会影响主页包裹。",
                  confirmLabel: "清空",
                })
                if (!ok) return
                clearPreviewResults()
                props.onClear()
              }}
            />
          ),
          topBarTrailing: (
            <Button
              title=""
              systemImage="plus"
              action={async () => {
                const text = await Dialog.prompt({
                  title: "添加短信",
                  message: "粘贴一条短信内容",
                  placeholder: "例如：菜鸟驿站提醒您，取件码 1234",
                  cancelLabel: "取消",
                  confirmLabel: "确定",
                })

                if (!text?.trim()) return

                const count = handleAnyData(text.trim())
                safeRefreshWidget()
                props.onChanged()

                await Dialog.alert({
                  title: count > 0 ? "导入完成" : "没有新增内容",
                  message: count > 0 ? `成功导入 ${count} 条短信内容。` : "没有识别到新的取件码，或这条短信已在当前列表中。",
                  buttonLabel: "知道了",
                })
              }}
            />
          ),
        }}
      >
        {groupedItems.length === 0 ? (
          <Section header={<Text>解析预览</Text>}>
            <EmptyPickupBlock
              title="暂无可预览内容"
              subtitle="添加短信后，这里会展示当前解析出来的包裹结果。"
            />
          </Section>
        ) : groupedItems.map((group) => (
          <Section key={group.title} header={<Text>{group.title}</Text>}>
            <ForEach
              count={group.items.length}
              itemBuilder={(index) => {
                const item = group.items[index]
                return (
                  <PickupRow
                    key={`preview-${group.title}-${item.code}-${index}`}
                    item={item}
                    showDate={cfg.showDate}
                    checked={!!item.picked}
                  />
                )
              }}
              onDelete={(indices) => {
                for (const index of indices) {
                  const item = group.items[index]
                  if (item) props.onDelete(item.code)
                }
              }}
            />
          </Section>
        ))}
      </List>
    </NavigationStack>
  )
}
