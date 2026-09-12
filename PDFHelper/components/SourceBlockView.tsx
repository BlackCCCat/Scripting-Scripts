import {
  Button,
  Circle,
  Divider,
  Group,
  type GridItem,
  HStack,
  Image,
  LazyVGrid,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"
import type { PageItem, PdfHelperDragPayload, SourceItem, WorkspaceId } from "../types"

const GRID_COLUMNS: GridItem[] = [
  { size: { type: "flexible" }, spacing: 8, alignment: "center" },
  { size: { type: "flexible" }, spacing: 8, alignment: "center" },
  { size: { type: "flexible" }, spacing: 8, alignment: "center" },
  { size: { type: "flexible" }, spacing: 8, alignment: "center" },
]

export const PDFHELPER_DRAG_TYPES: UTType[] = [
  "public.text",
  "public.plain-text",
  "public.utf8-plain-text",
]

export type SourceDropTarget = {
  sourceId?: string
  pageId?: string
}

function isPdfHelperDragPayload(value: any): value is PdfHelperDragPayload {
  return value?.app === "PDFHelper" &&
    (value.kind === "source" || value.kind === "page") &&
    (value.workspaceId === "primary" || value.workspaceId === "secondary") &&
    typeof value.sourceId === "string"
}

export function buildPdfHelperDragConfig(
  payload: PdfHelperDragPayload,
  title: string,
  subtitle: string | undefined,
  onDragStarted?: (payload: PdfHelperDragPayload) => void
) {
  return {
    data: () => {
      onDragStarted?.(payload)
      return ItemProvider.fromText(JSON.stringify(payload))
    },
    preview: (
      <HStack
        spacing={8}
        padding={{ vertical: 8, horizontal: 12 }}
        frame={{ width: 200, alignment: "leading" }}
        background="secondarySystemGroupedBackground"
        clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" } as any}
      >
        <Image systemName={payload.kind === "source" ? "doc.on.doc" : "doc.text"} />
        <VStack spacing={2} frame={{ width: 148, alignment: "leading" }}>
          <Text font="subheadline" lineLimit={1}>{title}</Text>
          {subtitle ? (
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {subtitle}
            </Text>
          ) : null}
        </VStack>
      </HStack>
    ),
  }
}

export function buildPdfHelperDropConfig(
  onDropPayload: ((payload: PdfHelperDragPayload, target: SourceDropTarget) => void) | undefined,
  target: SourceDropTarget = {},
  onHover?: (target: SourceDropTarget | null) => void
) {
  if (!onDropPayload) return undefined

  return {
    types: PDFHELPER_DRAG_TYPES,
    validateDrop: (info: DropInfo) => info.hasItemsConforming(PDFHELPER_DRAG_TYPES),
    dropEntered: () => {
      onHover?.(target)
    },
    dropExited: () => {
      onHover?.(null)
    },
    dropUpdated: () => "move" as const,
    performDrop: (info: DropInfo) => {
      onHover?.(null)
      const providers = info.itemProviders(PDFHELPER_DRAG_TYPES)
      if (providers.length === 0) return false

      for (const provider of providers) {
        provider.loadText().then((text) => {
          if (!text) return
          try {
            const payload = JSON.parse(text)
            if (isPdfHelperDragPayload(payload)) onDropPayload(payload, target)
          } catch {
          }
        })
      }
      return true
    },
  }
}

function SelectionMark(props: { selected: boolean; selectedOrder?: number; isGrid?: boolean }) {
  if (props.selected && typeof props.selectedOrder === "number") {
    return (
      <ZStack frame={{ width: 22, height: 22, alignment: "center" }}>
        <Circle fill="#2563EB" frame={{ width: 22, height: 22 }} />
        <Text font="caption2" foregroundStyle="white">{String(props.selectedOrder)}</Text>
      </ZStack>
    )
  }

  if (props.isGrid) {
    return (
      <ZStack frame={{ width: 22, height: 22, alignment: "center" }}>
        <Circle fill={props.selected ? "clear" : "rgba(0,0,0,0.25)"} frame={{ width: 18, height: 18 }} />
        <Image
          systemName={props.selected ? "checkmark.circle.fill" : "circle"}
          foregroundStyle={props.selected ? "#2563EB" : "white"}
        />
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

async function previewPageItem(page: PageItem) {
  try {
    if (page.kind === "image") {
      await (globalThis as any).QuickLook?.previewImage?.(page.image, true)
    } else if (page.pdfPath) {
      await (globalThis as any).QuickLook?.previewURLs?.([page.pdfPath], true)
    }
  } catch { }
}

function cardContextMenu(onPreview: () => void, onDelete: () => void, onSelect?: () => void) {
  return {
    menuItems: (
      <Group>
        {onSelect ? (
          <Button title="选择" systemImage="checkmark.circle" action={onSelect} />
        ) : null}
        <Button title="快速预览" systemImage="eye" action={onPreview} />
        <Button title="删除" systemImage="trash" role="destructive" action={onDelete} />
      </Group>
    ),
  }
}

function PdfPreview(props: { page: PageItem; compact?: boolean }) {
  if (props.page.kind === "image") return null
  const frame = props.compact ? { width: 68, height: 90 } : { width: 36, height: 48 }
  const cornerRadius = props.compact ? 8 : 6

  if (props.page.previewImage) {
    return (
      <Image
        image={props.page.previewImage}
        resizable
        scaleToFit
        frame={frame}
        clipShape={{ type: "rect", cornerRadius, style: "continuous" } as any}
      />
    )
  }
  if (props.page.previewFilePath) {
    return (
      <Image
        filePath={props.page.previewFilePath}
        resizable
        scaleToFit
        frame={frame}
        clipShape={{ type: "rect", cornerRadius, style: "continuous" } as any}
      />
    )
  }

  const pageLabel = props.page.kind === "pdf"
    ? `第 ${props.page.pageIndex + 1} 页`
    : `共 ${props.page.pageCount} 页`

  if (props.compact) {
    return (
      <ZStack frame={{ ...frame, alignment: "center" }}>
        <RoundedRectangle
          cornerRadius={cornerRadius}
          fill="tertiarySystemGroupedBackground"
          stroke="separator"
          frame={frame}
        />
        <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
          <Image
            systemName="doc.text.fill"
            font="title3"
            foregroundStyle="#EF4444"
          />
          <Text font="caption2" foregroundStyle="secondaryLabel">{pageLabel}</Text>
        </VStack>
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" as any }}>
          <Text
            font="caption2"
            fontWeight="bold"
            foregroundStyle="white"
            padding={{ horizontal: 4, vertical: 1 }}
            background="#EF4444"
            clipShape={{ type: "rect", cornerRadius: 4, style: "continuous" } as any}
            offset={{ x: -4, y: 4 }}
          >
            PDF
          </Text>
        </VStack>
      </ZStack>
    )
  }

  return (
    <ZStack frame={{ ...frame, alignment: "center" }}>
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill="tertiarySystemGroupedBackground"
        stroke="separator"
        frame={frame}
      />
      <Image
        systemName="doc.text.fill"
        font="subheadline"
        foregroundStyle="#EF4444"
      />
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" as any }}>
        <Text
          font="caption2"
          fontWeight="bold"
          foregroundStyle="white"
          padding={{ horizontal: 2 }}
          background="#EF4444"
          clipShape={{ type: "rect", cornerRadius: 3, style: "continuous" } as any}
          offset={{ x: -2, y: 2 }}
        >
          PDF
        </Text>
      </VStack>
    </ZStack>
  )
}

type SourceViewProps = {
  workspaceId: WorkspaceId
  source: SourceItem
  selectionEnabled: boolean
  activeDragPayload?: PdfHelperDragPayload | null
  onTogglePage: (sourceId: string, pageId: string) => void
  onDeletePage: (sourceId: string, pageId: string) => void
  onEnterSelectMode?: (sourceId: string, pageId: string) => void
  onDropPayload?: (payload: PdfHelperDragPayload, target: SourceDropTarget) => void
  onDragStarted?: (payload: PdfHelperDragPayload) => void
}

function SourceHeaderContent(props: SourceViewProps) {
  const selectedCount = props.source.pages.filter((page) => page.selected).length
  const title = props.selectionEnabled
    ? `${props.source.name}（已选 ${selectedCount}/${props.source.pages.length}）`
    : props.source.name

  return (
    <HStack spacing={7} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Image systemName={props.source.kind === "pdf" ? "doc.richtext" : "photo"} />
      <Text lineLimit={1}>{title}</Text>
    </HStack>
  )
}

function SourceHeader(props: SourceViewProps) {
  const target = { sourceId: props.source.id }
  const payload: PdfHelperDragPayload = {
    app: "PDFHelper",
    kind: "source",
    workspaceId: props.workspaceId,
    sourceId: props.source.id,
  }

  return (
    <Button
      buttonStyle="plain"
      action={() => {}}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      padding={{ leading: 4, trailing: 4, top: 2, bottom: 2 }}
      background="rgba(0,0,0,0.0001)"
      contentShape="rect"
      onDrag={buildPdfHelperDragConfig(payload, props.source.name, undefined, props.onDragStarted)}
      onDrop={buildPdfHelperDropConfig(props.onDropPayload, target)}
    >
      <SourceHeaderContent {...props} />
    </Button>
  )
}

function ListPageContent(props: SourceViewProps & { page: PageItem }) {
  if (props.page.kind === "image") {
    return (
      <VStack
        alignment="leading"
        spacing={6}
        padding={{ leading: 14, trailing: 14, top: 10, bottom: 10 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        background="rgba(0,0,0,0.0001)"
        contentShape="rect"
      >
        <Image image={props.page.image} resizable scaleToFit frame={{ maxWidth: "infinity", height: 150 }} />
        <HStack
          alignment="center"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          background="rgba(0,0,0,0.0001)"
          contentShape="rect"
        >
          <Text lineLimit={1}>{props.source.name}</Text>
          <Spacer />
          {props.selectionEnabled ? (
            <SelectionMark selected={props.page.selected} selectedOrder={props.page.selectedOrder} />
          ) : null}
        </HStack>
      </VStack>
    )
  }

  return (
    <HStack
      alignment="center"
      spacing={12}
      padding={{ leading: 14, trailing: 14, top: 10, bottom: 10 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background="rgba(0,0,0,0.0001)"
      contentShape="rect"
    >
      <PdfPreview page={props.page} />
      <VStack alignment="leading" spacing={3}>
        <Text lineLimit={1}>{props.page.title}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>{props.source.name}</Text>
      </VStack>
      <Spacer />
      {props.selectionEnabled ? (
        <SelectionMark selected={props.page.selected} selectedOrder={props.page.selectedOrder} />
      ) : null}
    </HStack>
  )
}

function ListPageRow(props: SourceViewProps & { page: PageItem }) {
  const onToggle = () => {
    if (props.selectionEnabled) props.onTogglePage(props.source.id, props.page.id)
  }
  const onPreview = () => void previewPageItem(props.page)
  const onDelete = () => props.onDeletePage(props.source.id, props.page.id)

  const payload: PdfHelperDragPayload = {
    app: "PDFHelper",
    kind: "page",
    workspaceId: props.workspaceId,
    sourceId: props.source.id,
    pageId: props.page.id,
  }
  const target = { sourceId: props.source.id, pageId: props.page.id }

  return (
    <Button
      key={props.page.id}
      buttonStyle="plain"
      action={onToggle}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background="rgba(0,0,0,0.0001)"
      contentShape="rect"
      contextMenu={cardContextMenu(onPreview, onDelete)}
      onDrag={buildPdfHelperDragConfig(payload, props.source.name, props.page.title, props.onDragStarted)}
      onDrop={buildPdfHelperDropConfig(props.onDropPayload, target)}
    >
      <ListPageContent {...props} />
    </Button>
  )
}

function GridPageContent(props: SourceViewProps & { page: PageItem }) {
  return (
    <VStack
      alignment="center"
      spacing={5}
      padding={6}
      frame={{ maxWidth: "infinity", minHeight: 134, alignment: "center" as any }}
      background="secondarySystemGroupedBackground"
      clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" } as any}
    >
      {props.page.kind === "image" ? (
        <HStack alignment="center" frame={{ maxWidth: "infinity", height: 90, alignment: "center" as any }}>
          <Spacer />
          <Image image={props.page.image} resizable scaleToFit frame={{ maxHeight: 90 }} />
          <Spacer />
        </HStack>
      ) : (
        <HStack alignment="center" frame={{ maxWidth: "infinity", height: 90, alignment: "center" as any }}>
          <Spacer />
          <PdfPreview page={props.page} compact />
          <Spacer />
        </HStack>
      )}
      <VStack alignment="center" spacing={2} frame={{ maxWidth: "infinity", alignment: "center" }}>
        <HStack alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }}>
          <Spacer />
          <Text font="caption2" lineLimit={1} multilineTextAlignment="center">{props.source.name}</Text>
          <Spacer />
        </HStack>
        <HStack alignment="center" frame={{ maxWidth: "infinity", alignment: "center" }}>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} multilineTextAlignment="center">{props.page.title}</Text>
          <Spacer />
        </HStack>
      </VStack>
    </VStack>
  )
}

function GridPageCard(props: SourceViewProps & {
  page: PageItem
  isHoverTarget?: boolean
  onHover?: (target: SourceDropTarget | null) => void
}) {
  const onPreview = () => void previewPageItem(props.page)
  const onDelete = () => props.onDeletePage(props.source.id, props.page.id)
  const onSelect = () => props.onEnterSelectMode?.(props.source.id, props.page.id)
  const payload: PdfHelperDragPayload = {
    app: "PDFHelper",
    kind: "page",
    workspaceId: props.workspaceId,
    sourceId: props.source.id,
    pageId: props.page.id,
  }
  const target = { sourceId: props.source.id, pageId: props.page.id }

  return (
    <Button
      key={props.page.id}
      buttonStyle="plain"
      action={() => {
        if (props.selectionEnabled) {
          props.onTogglePage(props.source.id, props.page.id)
        } else {
          void previewPageItem(props.page)
        }
      }}
      frame={{ maxWidth: "infinity", alignment: "center" as any }}
      contentShape="rect"
      contextMenu={cardContextMenu(onPreview, onDelete, onSelect)}
      onDrag={buildPdfHelperDragConfig(payload, props.source.name, props.page.title, props.onDragStarted)}
      onDrop={buildPdfHelperDropConfig(props.onDropPayload, target, props.onHover)}
    >
      <ZStack alignment="center" frame={{ maxWidth: "infinity", alignment: "center" as any }}>
        <GridPageContent {...props} />
        {props.selectionEnabled ? (
          <VStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" as any }}
            padding={4}
          >
            <SelectionMark selected={props.page.selected} selectedOrder={props.page.selectedOrder} isGrid />
          </VStack>
        ) : null}
        {props.page.selected ? (
          <RoundedRectangle
            cornerRadius={10}
            fill="rgba(37, 99, 235, 0.08)"
            stroke="#2563EB"
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}
        {props.isHoverTarget ? (
          <RoundedRectangle
            cornerRadius={14}
            fill="clear"
            stroke="#2563EB"
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
        ) : null}
        {props.isHoverTarget ? (
          <HStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
            <RoundedRectangle
              cornerRadius={2}
              fill="#2563EB"
              frame={{ width: 4, height: 104 }}
              offset={{ x: -2 }}
            />
            <Spacer />
          </HStack>
        ) : null}
      </ZStack>
    </Button>
  )
}

export function SourceBlockView(props: SourceViewProps) {
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <SourceHeader {...props} />
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        background="secondarySystemGroupedBackground"
        clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" } as any}
      >
        {props.source.pages.map((page, index) => (
          <VStack key={page.id} spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            {index > 0 ? <Divider padding={{ leading: 56 }} /> : null}
            <ListPageRow {...props} page={page} />
          </VStack>
        ))}
      </VStack>
    </VStack>
  )
}

export function WorkspaceListView(props: Omit<SourceViewProps, "source"> & { sources: SourceItem[] }) {
  return (
    <VStack spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {props.sources.map((source) => (
        <SourceBlockView key={source.id} {...props} source={source} />
      ))}
    </VStack>
  )
}

function SourceGridBlockView(props: SourceViewProps & {
  showHeader: boolean
  hoverTarget: SourceDropTarget | null
  activeDrag: PdfHelperDragPayload | null
  onHover: (target: SourceDropTarget | null) => void
}) {
  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {props.showHeader ? <SourceHeader {...props} /> : null}
      <LazyVGrid
        columns={GRID_COLUMNS}
        alignment="center"
        spacing={8}
        frame={{ maxWidth: "infinity", alignment: "center" }}
      >
        {props.source.pages.map((page) => (
          <GridPageCard
            key={page.id}
            {...props}
            page={page}
            isHoverTarget={props.hoverTarget?.pageId === page.id && props.activeDrag?.pageId !== page.id}
            onHover={props.onHover}
          />
        ))}
      </LazyVGrid>
    </VStack>
  )
}

type GridRun = {
  id: string
  sources: SourceItem[]
  showHeader: boolean
}

function makeGridRuns(sources: SourceItem[]): GridRun[] {
  const runs: GridRun[] = []
  for (const source of sources) {
    if (source.pages.length > 1) {
      runs.push({ id: source.id, sources: [source], showHeader: true })
      continue
    }

    const last = runs[runs.length - 1]
    if (last && !last.showHeader) {
      last.sources.push(source)
    } else {
      runs.push({ id: source.id, sources: [source], showHeader: false })
    }
  }
  return runs
}

export function WorkspaceGridView(props: Omit<SourceViewProps, "source"> & { sources: SourceItem[] }) {
  const [hoverTarget, setHoverTarget] = useState<SourceDropTarget | null>(null)
  const [localActiveDrag, setLocalActiveDrag] = useState<PdfHelperDragPayload | null>(null)

  const activeDrag = props.activeDragPayload ?? localActiveDrag

  const handleDragStarted = (payload: PdfHelperDragPayload) => {
    setLocalActiveDrag(payload)
    props.onDragStarted?.(payload)
  }

  const handleHover = (target: SourceDropTarget | null) => {
    setHoverTarget(target)
  }

  const handleDropPayload = (payload: PdfHelperDragPayload, target: SourceDropTarget) => {
    setHoverTarget(null)
    setLocalActiveDrag(null)
    props.onDropPayload?.(payload, target)
  }

  const gridProps = {
    ...props,
    activeDragPayload: activeDrag,
    onDragStarted: handleDragStarted,
    onDropPayload: handleDropPayload,
  }

  return (
    <VStack spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {makeGridRuns(props.sources).map((run) => (
        run.showHeader ? (
          <SourceGridBlockView
            key={run.id}
            {...gridProps}
            source={run.sources[0]}
            showHeader
            hoverTarget={hoverTarget}
            activeDrag={activeDrag}
            onHover={handleHover}
          />
        ) : (
          <LazyVGrid
            key={run.id}
            columns={GRID_COLUMNS}
            alignment="center"
            spacing={8}
            frame={{ maxWidth: "infinity", alignment: "center" }}
          >
            {run.sources.map((source) => {
              const page = source.pages[0]
              return (
                <GridPageCard
                  key={page.id}
                  {...gridProps}
                  source={source}
                  page={page}
                  isHoverTarget={hoverTarget?.pageId === page.id && activeDrag?.pageId !== page.id}
                  onHover={handleHover}
                />
              )
            })}
          </LazyVGrid>
        )
      ))}
    </VStack>
  )
}
