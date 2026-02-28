import {
  Button,
  Circle,
  HStack,
  Image,
  Label,
  RoundedRectangle,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import type { PageItem, SourceItem } from "../types"

function SelectionMark(props: { selected: boolean; selectedOrder?: number }) {
  if (props.selected && typeof props.selectedOrder === "number") {
    return (
      <ZStack frame={{ width: 22, height: 22, alignment: "center" }}>
        <Circle fill="#2563EB" frame={{ width: 22, height: 22 }} />
        <Text font="caption2" foregroundStyle="white">{String(props.selectedOrder)}</Text>
      </ZStack>
    )
  }

  return (
    <Image
      systemName={props.selected ? "checkmark.circle.fill" : "circle"}
      foregroundStyle={props.selected ? "#2563EB" : "secondaryLabel"}
    />
  )
}

function rowSwipeDelete(onDelete: () => void) {
  return {
    allowsFullSwipe: true,
    actions: [
      <Button
        title="删除"
        role="destructive"
        action={onDelete}
      />,
    ],
  }
}

function PdfPreview(props: { page: PageItem }) {
  if (props.page.kind === "image") return null

  if (props.page.previewImage) {
    return (
      <Image
        image={props.page.previewImage}
        resizable={true}
        scaleToFit={true}
        frame={{ width: 88, height: 122 }}
      />
    )
  }

  if (props.page.previewFilePath) {
    return (
      <Image
        filePath={props.page.previewFilePath}
        resizable={true}
        scaleToFit={true}
        frame={{ width: 88, height: 122 }}
      />
    )
  }

  return (
    <ZStack frame={{ width: 88, height: 122, alignment: "center" }}>
      <RoundedRectangle
        cornerRadius={8}
        fill={"secondarySystemGroupedBackground"}
        stroke={"separator"}
        frame={{ width: 88, height: 122 }}
      />
      <Image systemName="doc.richtext" foregroundStyle="secondaryLabel" />
    </ZStack>
  )
}

function ImageRow(props: {
  source: SourceItem
  page: PageItem
  onTogglePage: (sourceId: string, pageId: string) => void
  onDeletePage: (sourceId: string, pageId: string) => void
}) {
  if (props.page.kind !== "image") return null
  const onToggle = () => props.onTogglePage(props.source.id, props.page.id)

  return (
    <VStack
      key={props.page.id}
      spacing={8}
      padding={{ top: 8, bottom: 8 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={"rgba(0,0,0,0.001)"}
      onTapGesture={onToggle}
      trailingSwipeActions={rowSwipeDelete(() => props.onDeletePage(props.source.id, props.page.id))}
    >
      <Image
        image={props.page.image}
        resizable={true}
        scaleToFit={true}
        frame={{ maxWidth: "infinity", height: 210 }}
      />
      <HStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text>{props.page.title}</Text>
        <Spacer />
        <SelectionMark selected={props.page.selected} selectedOrder={props.page.selectedOrder} />
      </HStack>
    </VStack>
  )
}

function PdfRow(props: {
  source: SourceItem
  page: PageItem
  onTogglePage: (sourceId: string, pageId: string) => void
  onDeletePage: (sourceId: string, pageId: string) => void
}) {
  if (props.page.kind !== "pdf") return null
  const onToggle = () => props.onTogglePage(props.source.id, props.page.id)

  return (
    <HStack
      key={props.page.id}
      spacing={10}
      padding={{ top: 8, bottom: 8 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={"rgba(0,0,0,0.001)"}
      onTapGesture={onToggle}
      trailingSwipeActions={rowSwipeDelete(() => props.onDeletePage(props.source.id, props.page.id))}
    >
      <PdfPreview page={props.page} />
      <VStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text>{props.page.title}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          {props.source.name}
        </Text>
      </VStack>
      <SelectionMark selected={props.page.selected} selectedOrder={props.page.selectedOrder} />
    </HStack>
  )
}

function PdfWholeRow(props: {
  source: SourceItem
  page: PageItem
  onTogglePage: (sourceId: string, pageId: string) => void
  onDeletePage: (sourceId: string, pageId: string) => void
}) {
  if (props.page.kind !== "pdf-whole") return null
  const onToggle = () => props.onTogglePage(props.source.id, props.page.id)

  return (
    <HStack
      key={props.page.id}
      spacing={10}
      padding={{ top: 8, bottom: 8 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={"rgba(0,0,0,0.001)"}
      onTapGesture={onToggle}
      trailingSwipeActions={rowSwipeDelete(() => props.onDeletePage(props.source.id, props.page.id))}
    >
      <PdfPreview page={props.page} />
      <VStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text>{props.page.title}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          {props.source.name}
        </Text>
      </VStack>
      <SelectionMark selected={props.page.selected} selectedOrder={props.page.selectedOrder} />
    </HStack>
  )
}

export function SourceBlockView(props: {
  source: SourceItem
  onTogglePage: (sourceId: string, pageId: string) => void
  onDeletePage: (sourceId: string, pageId: string) => void
}) {
  const selectedCount = props.source.pages.filter((page) => page.selected).length

  return (
    <Section
      header={(
        <Label
          title={`${props.source.name}（已选 ${selectedCount}/${props.source.pages.length}）`}
          systemImage={props.source.kind === "pdf" ? "doc.richtext" : "photo"}
        />
      )}
    >
      {props.source.pages.map((page) =>
        page.kind === "image" ? (
          <ImageRow
            key={page.id}
            source={props.source}
            page={page}
            onTogglePage={props.onTogglePage}
            onDeletePage={props.onDeletePage}
          />
        ) : page.kind === "pdf-whole" ? (
          <PdfWholeRow
            key={page.id}
            source={props.source}
            page={page}
            onTogglePage={props.onTogglePage}
            onDeletePage={props.onDeletePage}
          />
        ) : (
          <PdfRow
            key={page.id}
            source={props.source}
            page={page}
            onTogglePage={props.onTogglePage}
            onDeletePage={props.onDeletePage}
          />
        )
      )}
    </Section>
  )
}
