import {
  Button,
  DisclosureGroup,
  ForEach,
  HStack,
  List,
  NavigationStack,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"

import { EmptyPickupBlock, MetricTile, PickupRow } from "./common"
import type { PickupInfo } from "../types"
import { getHomePickupInfo, loadConfig } from "../utils"

export function HomePage(props: {
  reloadToken: number
  onRefresh: () => void | Promise<void>
  onPicked: (code: string) => void | Promise<void>
  onUnpicked: (code: string) => void | Promise<void>
  onDelete: (code: string) => void | Promise<void>
}) {
  const cfg = loadConfig()
  const [allItems, setAllItems] = useState<PickupInfo[]>([])
  const [showRefreshToast, setShowRefreshToast] = useState(false)
  const [pickedExpanded, setPickedExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const items = await getHomePickupInfo(cfg)
      if (!cancelled) {
        setAllItems(items)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [props.reloadToken])

  const pendingItems = allItems.filter((item) => !item.picked)
  const pickedItems = allItems.filter((item) => item.picked)
  const shownPendingItems = pendingItems.slice(0, Math.max(cfg.widgetShowCount, 3))

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
              action={async () => {
                await props.onRefresh()
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
              count={shownPendingItems.length}
              itemBuilder={(index) => {
                const item = shownPendingItems[index]
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
                for (const index of indices) {
                  const item = shownPendingItems[index]
                  if (item) void props.onDelete(item.code)
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
            <DisclosureGroup
              title={`最近已处理 (${pickedItems.length})`}
              isExpanded={pickedExpanded}
              onChanged={setPickedExpanded}
            >
              <ForEach
                count={pickedItems.length}
                itemBuilder={(index) => {
                  const item = pickedItems[index]
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
                  for (const index of indices) {
                    const item = pickedItems[index]
                    if (item) void props.onDelete(item.code)
                  }
                }}
              />
            </DisclosureGroup>
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
