import {
  Button,
  ForEach,
  HStack,
  List,
  NavigationStack,
  Section,
  Text,
  useState,
  VStack,
} from "scripting"

import { EmptyPickupBlock, MetricTile, PickupRow } from "./common"
import { getAllPickupInfo, loadConfig } from "../utils"

export function HomePage(props: {
  onRefresh: () => void
  onPicked: (code: string) => void
  onUnpicked: (code: string) => void
  onDelete: (code: string) => void
}) {
  const cfg = loadConfig()
  const allItems = getAllPickupInfo(cfg)
  const pendingItems = allItems.filter((item) => !item.picked)
  const pickedItems = allItems.filter((item) => item.picked)
  const [showRefreshToast, setShowRefreshToast] = useState(false)

  return (
    <NavigationStack>
      <List
        navigationTitle="主页"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toast={{
          isPresented: showRefreshToast,
          onChanged: setShowRefreshToast,
          message: "已刷新",
          duration: 1.5,
          position: "bottom",
        }}
        toolbar={{
          topBarTrailing: (
            <Button
              title=""
              systemImage="arrow.clockwise"
              action={() => {
                props.onRefresh()
                setShowRefreshToast(true)
              }}
            />
          ),
        }}
      >
        <Section header={<Text>概览</Text>}>
          <VStack spacing={10}>
            <HStack spacing={10}>
              <MetricTile
                label="待取件"
                value={String(pendingItems.length)}
                detail="需要优先处理"
                tint="#0A84FF"
              />
              <MetricTile
                label="已处理"
                value={String(pickedItems.length)}
                detail="最近 1 小时内"
                tint="#34C759"
              />
            </HStack>
            <HStack spacing={10}>
              <MetricTile
                label="短信库"
                value={String(allItems.length)}
                detail="当前解析条目"
                tint="#FF9F0A"
              />
              <MetricTile
                label="组件条数"
                value={String(cfg.widgetShowCount)}
                detail="当前组件显示数量"
                tint="#AF52DE"
              />
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>待处理包裹</Text>}>
          {pendingItems.length === 0 ? (
            <EmptyPickupBlock
              title="没有待取件包裹"
              subtitle="导入短信后，这里会优先展示待处理内容。"
            />
          ) : (
            <ForEach
              count={pendingItems.slice(0, Math.max(cfg.widgetShowCount, 3)).length}
              itemBuilder={(index) => {
                const item = pendingItems.slice(0, Math.max(cfg.widgetShowCount, 3))[index]
                return (
                  <PickupRow
                    key={`pending-${item.code}-${index}`}
                    item={item}
                    showDate={cfg.showDate}
                    checked={false}
                    onToggle={props.onPicked}
                  />
                )
              }}
              onDelete={(indices) => {
                const shownItems = pendingItems.slice(0, Math.max(cfg.widgetShowCount, 3))
                for (const index of indices) {
                  const item = shownItems[index]
                  if (item) props.onDelete(item.code)
                }
              }}
            />
          )}
        </Section>

        <Section header={<Text>最近已处理</Text>}>
          {pickedItems.length === 0 ? (
            <EmptyPickupBlock
              title="还没有已处理记录"
              subtitle="标记已取件后，会在这里保留最近状态。"
            />
          ) : (
            <ForEach
              count={pickedItems.slice(0, 3).length}
              itemBuilder={(index) => {
                const item = pickedItems.slice(0, 3)[index]
                return (
                  <PickupRow
                    key={`picked-${item.code}-${index}`}
                    item={item}
                    showDate={cfg.showDate}
                    checked
                    onToggle={props.onUnpicked}
                  />
                )
              }}
              onDelete={(indices) => {
                const shownItems = pickedItems.slice(0, 3)
                for (const index of indices) {
                  const item = shownItems[index]
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
