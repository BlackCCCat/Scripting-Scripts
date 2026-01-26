// File: widget.tsx
import { Script, Text, VStack, Widget } from "scripting"

function MyWidget() {
  return (
    <VStack padding>
      <Text>万象方案更新</Text>
      <Text foregroundStyle={"secondaryLabel"}>点击运行脚本检查更新</Text>
    </VStack>
  )
}

async function run() {
  // ✅ 你的类型定义显示不接受 { element: ... }
  Widget.present(<MyWidget />)

  Script.exit()
}

run()