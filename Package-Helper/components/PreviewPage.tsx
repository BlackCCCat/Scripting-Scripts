import {
  Button,
  ForEach,
  List,
  NavigationStack,
  Section,
  Text,
} from "scripting"
import { EmptyPickupBlock, PickupRow } from "./common"
import { getAllPickupInfo, handleAnyData, loadConfig, safeRefreshWidget } from "../utils"

export function PreviewPage(props: {
  onChanged: () => void
  onDelete: (code: string) => void
}) {
  const cfg = loadConfig()
  const previewItems = getAllPickupInfo(cfg).slice(0, cfg.widgetShowCount)

  return (
    <NavigationStack>
      <List
        navigationTitle="预览"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
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
        <Section header={<Text>解析预览</Text>}>
          {previewItems.length === 0 ? (
            <EmptyPickupBlock
              title="暂无可预览内容"
              subtitle="添加短信后，这里会展示当前解析出来的包裹结果。"
            />
          ) : (
            <ForEach
              count={previewItems.length}
              itemBuilder={(index) => {
                const item = previewItems[index]
                return (
                  <PickupRow
                    key={`preview-${item.code}-${index}`}
                    item={item}
                    showDate={cfg.showDate}
                    checked={!!item.picked}
                  />
                )
              }}
              onDelete={(indices) => {
                for (const index of indices) {
                  const item = previewItems[index]
                  if (item) props.onDelete(item.code)
                }
              }}
            />
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
