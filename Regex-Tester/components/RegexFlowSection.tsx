import { HStack, RoundedRectangle, ScrollView, Text, VStack, ZStack } from "scripting"
import { buildPatternPreviewStyledText } from "../utils/pattern_highlight"
import { type FlowNode } from "../utils/flow"

function TokenBox(props: { text: string; modifier?: string }) {
  return (
    <VStack spacing={6} frame={{ alignment: "center" as any }}>
      <VStack
        padding={{ top: 12, bottom: 12, leading: 16, trailing: 16 }}
        frame={{ alignment: "center" as any }}
        background={{
          style: "secondarySystemBackground",
          shape: { type: "rect", cornerRadius: 16 },
        }}
      >
        <Text styledText={buildPatternPreviewStyledText(props.text)} />
      </VStack>
      {props.modifier ? <Text foregroundStyle="#3B82F6">{props.modifier}</Text> : null}
    </VStack>
  )
}

function FlowSequenceRow(props: { nodes: FlowNode[] }) {
  if (!props.nodes.length) return <TokenBox text="空" />
  return (
    <HStack spacing={10} frame={{ alignment: "topLeading" as any }}>
      {props.nodes.map((node, index) => (
        <HStack key={`${node.kind}-${index}`} spacing={10} frame={{ alignment: "topLeading" as any }}>
          {index > 0 ? <Text foregroundStyle="secondaryLabel">→</Text> : null}
          <FlowNodeView node={node} />
        </HStack>
      ))}
    </HStack>
  )
}

function ContainerBox(props: { label: string; branches: FlowNode[][]; modifier?: string }) {
  return (
    <VStack spacing={10} frame={{ alignment: "topLeading" as any }}>
      <ZStack frame={{ alignment: "topLeading" as any }}>
        <RoundedRectangle
          cornerRadius={22}
          fill="systemBackground"
          stroke={{ shapeStyle: "#BFDBFE", strokeStyle: { lineWidth: 1.5 } }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
        <VStack
          spacing={10}
          padding={16}
          frame={{ alignment: "topLeading" as any }}
        >
          <Text font="caption" foregroundStyle="#3B82F6">{props.label}</Text>
          {props.branches.map((branch, idx) => (
            <VStack key={`branch-${idx}`} spacing={10} frame={{ alignment: "topLeading" as any }}>
              <FlowSequenceRow nodes={branch} />
              {idx < props.branches.length - 1 ? <Text foregroundStyle="secondaryLabel">或</Text> : null}
            </VStack>
          ))}
        </VStack>
      </ZStack>
      {props.modifier ? <Text foregroundStyle="#3B82F6">{props.modifier}</Text> : null}
    </VStack>
  )
}

function FlowNodeView(props: { node: FlowNode }) {
  if (props.node.kind === "token") {
    return <TokenBox text={props.node.token} modifier={props.node.modifier} />
  }
  return <ContainerBox label={props.node.label} branches={props.node.branches} modifier={props.node.modifier} />
}

export function RegexFlowSection(props: { tree: FlowNode[] }) {
  const tree = props.tree ?? []

  if (!tree.length) {
    return (
      <VStack
        padding={16}
        frame={{ maxWidth: "infinity", minHeight: 240, alignment: "center" as any }}
        background={{
          style: "secondarySystemBackground",
          shape: { type: "rect", cornerRadius: 22 },
        }}
      >
        <Text foregroundStyle="secondaryLabel">当前表达式暂时无法拆解为流程步骤</Text>
      </VStack>
    )
  }

  return (
    <ScrollView axes="horizontal" frame={{ maxWidth: "infinity" }}>
      <HStack
        spacing={12}
        padding={{ top: 4, bottom: 4, leading: 2, trailing: 12 }}
        frame={{ alignment: "topLeading" as any }}
      >
        <TokenBox text="开始" />
        <Text foregroundStyle="secondaryLabel">→</Text>
        <FlowSequenceRow nodes={tree} />
      </HStack>
    </ScrollView>
  )
}
