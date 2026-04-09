import {
  Form,
  NavigationStack,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting"

import { getBusinessDataStats } from "../utils"

type Stats = {
  path: string
  pickups: number
  pickedItems: number
  deletedItems: number
  homeDeletedItems: number
  previewDeletedItems: number
}

function DebugRow(props: {
  label: string
  value: string
}) {
  return (
    <VStack alignment="leading" spacing={4} padding={{ vertical: 6 }}>
      <Text font="caption" opacity={0.5}>{props.label}</Text>
      <Text font="body">{props.value}</Text>
    </VStack>
  )
}

export function DatabaseDebugPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const next = await getBusinessDataStats()
      if (!cancelled) {
        setStats(next)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <NavigationStack>
      <Form
        navigationTitle="数据库状态"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section header={<Text>SQLite</Text>}>
          <DebugRow
            label="数据库路径"
            value={stats?.path || "加载中..."}
          />
        </Section>

        <Section header={<Text>表统计</Text>}>
          <DebugRow
            label="pickups"
            value={stats ? String(stats.pickups) : "加载中..."}
          />
          <DebugRow
            label="picked_items"
            value={stats ? String(stats.pickedItems) : "加载中..."}
          />
          <DebugRow
            label="deleted_items"
            value={stats ? String(stats.deletedItems) : "加载中..."}
          />
        </Section>

        <Section header={<Text>删除作用域</Text>}>
          <DebugRow
            label="home"
            value={stats ? String(stats.homeDeletedItems) : "加载中..."}
          />
          <DebugRow
            label="preview"
            value={stats ? String(stats.previewDeletedItems) : "加载中..."}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
