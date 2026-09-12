import {
  Button,
  GeometryReader,
  Group,
  HStack,
  Image,
  Menu,
  NavigationStack,
  Path,
  ProgressView,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useMemo,
  useState,
} from "scripting"
import type {
  PdfHelperDragPayload,
  SourceItem,
  WorkspaceId,
  WorkspaceDisplayMode,
  WorkspaceLayoutDirection,
  WorkspaceState,
} from "../types"
import { useMarkdownReleaseNotesSheet } from "./ReleaseNotesSheet"
import { chooseFileImportChoices, chooseImportWorkspaceAssignments } from "./ImportWorkspacePicker"
import {
  buildPdfHelperDropConfig,
  WorkspaceGridView,
  WorkspaceListView,
} from "./SourceBlockView"
import {
  chooseImportInitialDirectory,
  importFileCandidates,
  pickFileImportCandidates,
  pickSourcesFromFiles,
  pickSourcesFromPhotos,
} from "../utils/importer"
import { buildOutputFileName } from "../utils/id"
import { convertSelectedImagesToPdf, getSelectedPages, mergeSelectedPagesToPdf } from "../utils/pdf_ops"
import { moveDraggedItem, resolveDraggedItem } from "../utils/workspace_ops"

const DUAL_ENABLED_KEY = "PDFHelper.workspace.dualEnabled"
const DUAL_RATIO_KEY = "PDFHelper.workspace.dualRatio"
const DUAL_LAYOUT_KEY = "PDFHelper.workspace.dualLayout"
const DISPLAY_MODE_KEY = "PDFHelper.workspace.displayMode"

function isUserCancelled(error: any): boolean {
  const message = String(error?.message ?? error ?? "").toLowerCase()
  return message.includes("cancel")
}

function clampRatio(value: number): number {
  if (typeof value !== "number" || isNaN(value)) return 0.5
  return Math.max(0.1, Math.min(0.9, value))
}

function readStoredRatio(): number {
  return clampRatio(Storage.get<number>(DUAL_RATIO_KEY) ?? 0.5)
}

function readStoredLayout(): WorkspaceLayoutDirection {
  const value = Storage.get<string>(DUAL_LAYOUT_KEY)
  return value === "vertical" ? "vertical" : "horizontal"
}

function readStoredDisplayMode(): WorkspaceDisplayMode {
  return Storage.get<string>(DISPLAY_MODE_KEY) === "grid" ? "grid" : "list"
}

async function saveExportedPdf(data: Data, fileName: string) {
  const result = await DocumentPicker.exportFiles({
    files: [{ data, name: fileName }],
  })

  if (result.length > 0) {
    await Dialog.alert({
      title: "保存成功",
      message: `已保存：${result[0]}`,
    })
  }
}

async function buildPreviewFilePath(data: Data, fileName: string): Promise<string> {
  const previewPath = Path.join(FileManager.temporaryDirectory, fileName)
  await FileManager.writeAsData(previewPath, data)
  return previewPath
}

async function previewExportedPdf(data: Data, fileName: string) {
  const previewPath = await buildPreviewFilePath(data, fileName)
  try {
    await QuickLook.previewURLs([previewPath], true)
  } finally {
    try {
      await FileManager.remove(previewPath)
    } catch {
    }
  }
}

async function presentExportActionSheet(data: Data, fileName: string, summary: string) {
  const action = await Dialog.actionSheet({
    title: summary,
    message: "请选择后续操作",
    cancelButton: false,
    actions: [
      { label: "保存" },
      { label: "预览" },
      { label: "取消", destructive: true },
    ],
  })

  if (action === 0) {
    await saveExportedPdf(data, fileName)
    return
  }

  if (action === 1) {
    await previewExportedPdf(data, fileName)
  }
}

function getMaxSelectedOrder(sources: SourceItem[]): number {
  let max = 0
  for (const source of sources) {
    for (const page of source.pages) {
      if (page.selected && typeof page.selectedOrder === "number" && page.selectedOrder > max) {
        max = page.selectedOrder
      }
    }
  }
  return max
}

function compactSelectionOrders(sources: SourceItem[]): SourceItem[] {
  const selectedRows: Array<{ sourceId: string; pageId: string; order: number }> = []

  for (const source of sources) {
    for (const page of source.pages) {
      if (!page.selected) continue
      selectedRows.push({
        sourceId: source.id,
        pageId: page.id,
        order: typeof page.selectedOrder === "number" ? page.selectedOrder : Number.MAX_SAFE_INTEGER,
      })
    }
  }

  selectedRows.sort((a, b) => a.order - b.order)
  const orderMap = new Map<string, number>()
  selectedRows.forEach((row, index) => {
    orderMap.set(`${row.sourceId}::${row.pageId}`, index + 1)
  })

  return sources.map((source) => ({
    ...source,
    pages: source.pages.map((page) =>
      page.selected
        ? { ...page, selectedOrder: orderMap.get(`${source.id}::${page.id}`) }
        : { ...page, selectedOrder: undefined }
    ),
  }))
}

function getImportedPdfSources(sources: SourceItem[]): SourceItem[] {
  return sources.filter((source) => source.kind === "pdf")
}

function getImportedPdfFilePaths(sources: SourceItem[]): string[] {
  const paths = new Set<string>()
  for (const source of sources) {
    if (source.kind !== "pdf") continue
    if (source.originalPath) {
      paths.add(source.originalPath)
    }
    for (const page of source.pages) {
      if (page.kind === "pdf" || page.kind === "pdf-whole") {
        paths.add(page.pdfPath)
      }
    }
  }
  return [...paths]
}

function removeSourcesByPdfPaths(sources: SourceItem[], pdfPaths: Set<string>): SourceItem[] {
  return compactSelectionOrders(
    sources.filter((source) => {
      if (source.kind !== "pdf") return true
      if (source.originalPath && pdfPaths.has(source.originalPath)) return false
      return !source.pages.some((page) =>
        (page.kind === "pdf" || page.kind === "pdf-whole") && pdfPaths.has(page.pdfPath)
      )
    })
  )
}

function workspaceTitle(id: WorkspaceId): string {
  return id === "primary" ? "工作区 1" : "工作区 2"
}

function createInitialWorkspaces(): WorkspaceState[] {
  return [
    { id: "primary", title: workspaceTitle("primary"), sources: [] },
    { id: "secondary", title: workspaceTitle("secondary"), sources: [] },
  ]
}

function getWorkspaceStats(sources: SourceItem[]) {
  const allPages = sources.flatMap((source) => source.pages)
  const selectedPages = getSelectedPages(sources)
  const selectedImageCount = selectedPages.filter((page) => page.kind === "image").length
  const totalImageCount = allPages.filter((page) => page.kind === "image").length
  let selectedTotalPageCount = 0
  for (const page of selectedPages) {
    selectedTotalPageCount += page.kind === "pdf-whole" ? page.pageCount : 1
  }
  let totalPageCount = 0
  for (const page of allPages) {
    totalPageCount += page.kind === "pdf-whole" ? page.pageCount : 1
  }
  return {
    allPages,
    selectedPages,
    selectedImageCount,
    selectedTotalPageCount,
    totalImageCount,
    totalPageCount,
  }
}

function selectAllPagesByVisualOrder(sources: SourceItem[]): SourceItem[] {
  let order = 1
  return sources.map((source) => ({
    ...source,
    pages: source.pages.map((page) => ({
      ...page,
      selected: true,
      selectedOrder: order++,
    })),
  }))
}

function BottomActionButton(props: {
  title: string
  systemImage: string
  disabled: boolean
  destructive?: boolean
  contextMenu?: any
  action: () => void
}) {
  const background = props.disabled ? "#5B6472" : props.destructive ? "#DC2626" : "#0A66D8"

  return (
    <Button
      buttonStyle="plain"
      disabled={props.disabled}
      action={props.action}
      frame={{ maxWidth: "infinity", minHeight: 46 }}
      contextMenu={props.contextMenu}
    >
      <HStack
        spacing={6}
        frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" as any }}
        background={background}
        clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" } as any}
        contentShape="rect"
      >
        <Image systemName={props.systemImage} foregroundStyle="white" imageScale="medium" />
        <Text font="headline" fontWeight="semibold" foregroundStyle="white" lineLimit={1}>
          {props.title}
        </Text>
      </HStack>
    </Button>
  )
}

function WorkspacePanel(props: {
  workspace: WorkspaceState
  displayMode: WorkspaceDisplayMode
  selectionEnabled: boolean
  showEmptyState: boolean
  activeDragPayload?: PdfHelperDragPayload | null
  onDragStarted?: (payload: PdfHelperDragPayload) => void
  onTogglePage: (workspaceId: WorkspaceId, sourceId: string, pageId: string) => void
  onDeletePage: (workspaceId: WorkspaceId, sourceId: string, pageId: string) => void
  onDropPayload: (payload: PdfHelperDragPayload, targetWorkspaceId: WorkspaceId, target?: { sourceId?: string; pageId?: string }) => void
}) {
  const workspaceDrop = buildPdfHelperDropConfig((payload) => {
    props.onDropPayload(payload, props.workspace.id)
  })
  const orderKey = props.workspace.sources
    .map((source) => `${source.id}:${source.pages.map((page) => page.id).join(",")}`)
    .join("|")
  const emptyState = (
    <VStack
      spacing={8}
      padding={24}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
      background="rgba(0,0,0,0.0001)"
      contentShape="rect"
      onDrop={workspaceDrop}
    >
      <Text>点右上角「+」添加文件或照片</Text>
      <Text foregroundStyle="secondaryLabel">
        {props.workspace.id === "secondary"
          ? "可从工作区 1 拖拽文件或页面至此处，或点右上角「+」添加。图片将显示整图；PDF 可按页导入或作为整体导入"
          : "可从另一工作区拖拽文件或页面至此处，或点右上角「+」添加。图片将显示整图；PDF 可按页导入或作为整体导入"}
      </Text>
    </VStack>
  )

  if (props.displayMode === "grid") {
    return (
      <ZStack
        alignment="top"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="systemGroupedBackground"
        contentShape="rect"
        onDrop={workspaceDrop}
      >
        {props.workspace.sources.length > 0 ? (
          <ScrollView
            background="systemGroupedBackground"
            contentMargins={{ edges: "top", insets: 12, placement: "scrollContent" }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            ignoresSafeArea={{ edges: "bottom" }}
            animation={{ animation: Animation.default(), value: orderKey }}
            contentShape="rect"
            onDrop={workspaceDrop}
          >
            <VStack
              spacing={16}
              padding={{ top: 12, bottom: 116, leading: 12, trailing: 12 }}
              frame={{ maxWidth: "infinity", minHeight: 300, alignment: "leading" }}
              contentShape="rect"
              onDrop={workspaceDrop}
            >
              <WorkspaceGridView
                workspaceId={props.workspace.id}
                sources={props.workspace.sources}
                selectionEnabled={props.selectionEnabled}
                activeDragPayload={props.activeDragPayload}
                onDragStarted={props.onDragStarted}
                onTogglePage={(sourceId, pageId) => props.onTogglePage(props.workspace.id, sourceId, pageId)}
                onDeletePage={(sourceId, pageId) => props.onDeletePage(props.workspace.id, sourceId, pageId)}
                onDropPayload={(payload, target) => props.onDropPayload(payload, props.workspace.id, target)}
              />
            </VStack>
          </ScrollView>
        ) : (
          props.showEmptyState ? emptyState : null
        )}
      </ZStack>
    )
  }

  return (
    <ZStack
      alignment="top"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="systemGroupedBackground"
      contentShape="rect"
      onDrop={workspaceDrop}
    >
      {props.workspace.sources.length > 0 ? (
        <ScrollView
          background="systemGroupedBackground"
          contentMargins={{ edges: "top", insets: 12, placement: "scrollContent" }}
          animation={{ animation: Animation.default(), value: orderKey }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          ignoresSafeArea={{ edges: "bottom" }}
          contentShape="rect"
          onDrop={workspaceDrop}
        >
          <VStack
            spacing={16}
            padding={{ top: 12, bottom: 116, leading: 16, trailing: 16 }}
            frame={{ maxWidth: "infinity", minHeight: 300, alignment: "leading" }}
            contentShape="rect"
            onDrop={workspaceDrop}
          >
            <WorkspaceListView
              workspaceId={props.workspace.id}
              sources={props.workspace.sources}
              selectionEnabled={props.selectionEnabled}
              onTogglePage={(sourceId, pageId) => props.onTogglePage(props.workspace.id, sourceId, pageId)}
              onDeletePage={(sourceId, pageId) => props.onDeletePage(props.workspace.id, sourceId, pageId)}
              onDropPayload={(payload, target) => props.onDropPayload(payload, props.workspace.id, target)}
            />
            <VStack
              frame={{ maxWidth: "infinity", minHeight: 160 }}
              background="rgba(0,0,0,0.0001)"
              contentShape="rect"
              onDrop={workspaceDrop}
            />
          </VStack>
        </ScrollView>
      ) : (
        props.showEmptyState ? emptyState : null
      )}
    </ZStack>
  )
}

function WorkspaceDivider(props: {
  layoutDir: WorkspaceLayoutDirection
  totalW: number
  totalH: number
  ratio: number
  onDragEnd: (ratio: number) => void
  onToggleLayout: () => void
}) {
  const [dragOffset, setDragOffset] = useState(0)
  const splitCenterX = props.totalW * props.ratio - props.totalW / 2
  const splitCenterY = props.totalH * props.ratio - props.totalH / 2
  const previewOffset = props.layoutDir === "horizontal"
    ? { x: splitCenterX + dragOffset, y: 0 }
    : { x: 0, y: splitCenterY + dragOffset }

  const handleDragChanged = (details: { translation: { width: number; height: number } }) => {
    setDragOffset(props.layoutDir === "horizontal" ? details.translation.width : details.translation.height)
  }

  const handleDragEnded = () => {
    const total = props.layoutDir === "horizontal" ? props.totalW : props.totalH
    if (total > 0) {
      props.onDragEnd(clampRatio(props.ratio + dragOffset / total))
    }
    setDragOffset(0)
  }

  return (
    <VStack
      frame={props.layoutDir === "horizontal" ? { width: 35, height: 150 } : { width: 120, height: 35 }}
      background="rgba(0,0,0,0.0001)"
      contentShape="rect"
      offset={previewOffset}
      onTapGesture={props.onToggleLayout}
      onDragGesture={{
        minDistance: 10,
        coordinateSpace: "global",
        onChanged: handleDragChanged,
        onEnded: handleDragEnded,
      }}
    >
      <VStack
        frame={props.layoutDir === "horizontal" ? { width: 4, height: 130 } : { width: 100, height: 4 }}
        background="rgba(128,128,128,0.25)"
        clipShape="capsule"
      />
    </VStack>
  )
}

export function PDFHelperView() {
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "changelog.md",
    storageKey: "pdfhelper:release-notes:last-seen-hash",
    title: "更新说明",
  })
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>(createInitialWorkspaces)
  const [dualEnabled, setDualEnabled] = useState<boolean>(() => Storage.get<boolean>(DUAL_ENABLED_KEY) === true)
  const [layoutDir, setLayoutDir] = useState<WorkspaceLayoutDirection>(readStoredLayout)
  const [displayMode, setDisplayMode] = useState<WorkspaceDisplayMode>(readStoredDisplayMode)
  const [ratio, setRatio] = useState<number>(readStoredRatio)
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  const [processing, setProcessing] = useState<boolean>(false)
  const [activeDrag, setActiveDrag] = useState<PdfHelperDragPayload | null>(null)

  const visibleWorkspaces = useMemo(
    () => dualEnabled ? workspaces : workspaces.filter((workspace) => workspace.id === "primary"),
    [dualEnabled, workspaces]
  )
  const visibleStats = useMemo(
    () => visibleWorkspaces.map((workspace) => ({ workspaceId: workspace.id, ...getWorkspaceStats(workspace.sources) })),
    [visibleWorkspaces]
  )
  const selectedPages = useMemo(
    () => visibleStats.flatMap((stats) => stats.selectedPages),
    [visibleStats]
  )
  const importedPdfSources = useMemo(
    () => visibleWorkspaces.flatMap((workspace) => getImportedPdfSources(workspace.sources)),
    [visibleWorkspaces]
  )
  const importedPdfFilePaths = useMemo(
    () => getImportedPdfFilePaths(visibleWorkspaces.flatMap((workspace) => workspace.sources)),
    [visibleWorkspaces]
  )
  const selectedImageCount = useMemo(
    () => visibleStats.reduce((count, stats) => count + stats.selectedImageCount, 0),
    [visibleStats]
  )
  const selectedTotalPageCount = useMemo(
    () => visibleStats.reduce((count, stats) => count + stats.selectedTotalPageCount, 0),
    [visibleStats]
  )
  const totalItemCount = useMemo(
    () => visibleStats.reduce((count, stats) => count + stats.allPages.length, 0),
    [visibleStats]
  )
  const totalPageCount = useMemo(
    () => visibleStats.reduce((count, stats) => count + stats.totalPageCount, 0),
    [visibleStats]
  )
  const totalImageCount = useMemo(
    () => visibleStats.reduce((count, stats) => count + stats.totalImageCount, 0),
    [visibleStats]
  )

  const isBusy = processing || loadingMessage !== null
  const isGridMode = displayMode === "grid"
  const treatAsAll = isGridMode
  const canConvert = (treatAsAll ? totalImageCount > 0 : selectedImageCount > 0) && !isBusy
  const canMerge = (treatAsAll ? totalItemCount > 0 : selectedPages.length > 0) && !isBusy
  const canDeleteSelected = selectedPages.length > 0 && !isBusy
  const hasAnyItems = visibleWorkspaces.some((workspace) => workspace.sources.length > 0)
  const deleteButtonDisabled = isBusy || !hasAnyItems

  const setWorkspaceSources = useCallback((workspaceId: WorkspaceId, updater: (sources: SourceItem[]) => SourceItem[]) => {
    setWorkspaces((prev) => prev.map((workspace) =>
      workspace.id === workspaceId
        ? { ...workspace, sources: updater(workspace.sources) }
        : workspace
    ))
  }, [])

  const appendImportedSources = useCallback((sources: SourceItem[], assignments: WorkspaceId[]) => {
    if (sources.length === 0 || sources.length !== assignments.length) return
    setWorkspaces((previous) => previous.map((workspace) => {
      const assignedSources = sources.filter((_, index) => assignments[index] === workspace.id)
      if (assignedSources.length === 0) return workspace
      return {
        ...workspace,
        sources: [...workspace.sources, ...assignedSources],
      }
    }))

    if (assignments.includes("secondary")) {
      setDualEnabled(true)
      Storage.set(DUAL_ENABLED_KEY, true)
    }
  }, [])

  const togglePage = useCallback((workspaceId: WorkspaceId, sourceId: string, pageId: string) => {
    setWorkspaceSources(workspaceId, (prev) => {
      const currentMax = getMaxSelectedOrder(prev)
      const next = prev.map((source) =>
        source.id !== sourceId
          ? source
          : {
            ...source,
            pages: source.pages.map((page) =>
              page.id === pageId
                ? page.selected
                  ? { ...page, selected: false, selectedOrder: undefined }
                  : { ...page, selected: true, selectedOrder: currentMax + 1 }
                : page
            ),
          }
      )
      return compactSelectionOrders(next)
    })
  }, [setWorkspaceSources])

  const deletePage = useCallback((workspaceId: WorkspaceId, sourceId: string, pageId: string) => {
    setWorkspaceSources(workspaceId, (prev) =>
      compactSelectionOrders(
        prev
          .map((source) =>
            source.id !== sourceId
              ? source
              : { ...source, pages: source.pages.filter((page) => page.id !== pageId) }
          )
          .filter((source) => source.pages.length > 0)
      )
    )
  }, [setWorkspaceSources])

  const addFromFiles = useCallback(async () => {
    if (isBusy) return
    try {
      if (dualEnabled) {
        const candidates = await pickFileImportCandidates()
        if (candidates.length === 0) return
        const choices = await chooseFileImportChoices(candidates)
        if (!choices) return

        setLoadingMessage("正在导入文件...")
        const imported = await importFileCandidates(candidates, choices)
        appendImportedSources(imported.sources, imported.assignments)
        if (imported.notices.length > 0) {
          await Dialog.alert({ title: "导入提示", message: imported.notices.join("\n") })
        }
        return
      }

      setLoadingMessage("正在导入文件...")
      const imported = await pickSourcesFromFiles("primary")
      if (imported.sources.length > 0) {
        appendImportedSources(imported.sources, imported.sources.map(() => "primary"))
      }
      if (imported.notices.length > 0) {
        await Dialog.alert({
          title: "导入提示",
          message: imported.notices.join("\n"),
        })
      }
    } catch (error: any) {
      if (isUserCancelled(error)) return
      await Dialog.alert({
        title: "导入失败",
        message: String(error?.message ?? error),
      })
    } finally {
      setLoadingMessage(null)
    }
  }, [appendImportedSources, dualEnabled, isBusy])

  const addFromPhotos = useCallback(async () => {
    if (isBusy) return
    setLoadingMessage("正在导入照片...")
    try {
      const imported = await pickSourcesFromPhotos()
      if (imported.sources.length > 0) {
        setLoadingMessage(null)
        const assignments = dualEnabled
          ? await chooseImportWorkspaceAssignments(imported.sources, "primary")
          : imported.sources.map(() => "primary" as WorkspaceId)
        if (!assignments) return
        appendImportedSources(imported.sources, assignments)
      }
      if (imported.notices.length > 0) {
        await Dialog.alert({
          title: "导入提示",
          message: imported.notices.join("\n"),
        })
      }
    } catch (error: any) {
      if (isUserCancelled(error)) return
      await Dialog.alert({
        title: "导入失败",
        message: String(error?.message ?? error),
      })
    } finally {
      setLoadingMessage(null)
    }
  }, [appendImportedSources, dualEnabled, isBusy])

  const setImportDirectory = useCallback(async () => {
    if (isBusy) return
    try {
      let workspaceId: WorkspaceId = "primary"
      if (dualEnabled) {
        const action = await Dialog.actionSheet({
          title: "设置默认导入路径",
          cancelButton: true,
          actions: [
            { label: "工作区 1" },
            { label: "工作区 2" },
          ],
        })
        if (action == null) return
        workspaceId = action === 1 ? "secondary" : "primary"
      }
      const directory = await chooseImportInitialDirectory(workspaceId)
      if (!directory) return
      await Dialog.alert({
        title: `${workspaceTitle(workspaceId)} 默认导入路径已设置`,
        message: directory,
      })
    } catch (error: any) {
      if (isUserCancelled(error)) return
      await Dialog.alert({
        title: "设置失败",
        message: String(error?.message ?? error),
      })
    }
  }, [dualEnabled, isBusy])

  const deleteSelected = useCallback(async () => {
    if (!canDeleteSelected) return
    const ok = await Dialog.confirm({
      title: "删除选中项目",
      message: `确定删除当前可见工作区中选中的 ${selectedPages.length} 个项目吗？`,
    })
    if (!ok) return
    const visibleIds = new Set(visibleWorkspaces.map((workspace) => workspace.id))
    setWorkspaces((prev) => prev.map((workspace) => {
      if (!visibleIds.has(workspace.id)) return workspace
      return {
        ...workspace,
        sources: compactSelectionOrders(
          workspace.sources
            .map((source) => ({
              ...source,
              pages: source.pages.filter((page) => !page.selected),
            }))
            .filter((source) => source.pages.length > 0)
        ),
      }
    }))
  }, [canDeleteSelected, selectedPages.length, visibleWorkspaces])

  const deleteImportedPdfs = useCallback(async () => {
    if (isBusy || importedPdfSources.length === 0) return
    const ok = await Dialog.confirm({
      title: "删除已导入的 PDF",
      message: `确定删除当前可见工作区中已导入的 ${importedPdfSources.length} 个 PDF 项吗？`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!ok) return
    const visibleIds = new Set(visibleWorkspaces.map((workspace) => workspace.id))
    setWorkspaces((prev) => prev.map((workspace) =>
      visibleIds.has(workspace.id)
        ? { ...workspace, sources: compactSelectionOrders(workspace.sources.filter((source) => source.kind !== "pdf")) }
        : workspace
    ))
  }, [importedPdfSources.length, isBusy, visibleWorkspaces])

  const deleteImportedPdfFiles = useCallback(async () => {
    if (isBusy || importedPdfFilePaths.length === 0) return
    const ok = await Dialog.confirm({
      title: "删除源 PDF 文件",
      message: `确定删除当前可见工作区已导入项目对应的 ${importedPdfFilePaths.length} 个源 PDF 文件吗？此操作不可恢复。`,
      confirmLabel: "删除文件",
      cancelLabel: "取消",
    })
    if (!ok) return

    const removedPaths = new Set<string>()
    const failedPaths: string[] = []

    for (const pdfPath of importedPdfFilePaths) {
      try {
        const exists = await FileManager.exists(pdfPath)
        if (!exists) {
          removedPaths.add(pdfPath)
          continue
        }
        await FileManager.remove(pdfPath)
        removedPaths.add(pdfPath)
      } catch {
        failedPaths.push(pdfPath)
      }
    }

    if (removedPaths.size > 0) {
      const visibleIds = new Set(visibleWorkspaces.map((workspace) => workspace.id))
      setWorkspaces((prev) => prev.map((workspace) =>
        visibleIds.has(workspace.id)
          ? { ...workspace, sources: removeSourcesByPdfPaths(workspace.sources, removedPaths) }
          : workspace
      ))
    }

    if (failedPaths.length > 0) {
      await Dialog.alert({
        title: "部分删除失败",
        message: `已删除 ${removedPaths.size} 个文件，失败 ${failedPaths.length} 个。\n${failedPaths.join("\n")}`,
      })
      return
    }

    await Dialog.alert({
      title: "删除完成",
      message: `已删除 ${removedPaths.size} 个源 PDF 文件`,
    })
  }, [importedPdfFilePaths, isBusy, visibleWorkspaces])

  const chooseWorkspaceForOperation = useCallback(async (kind: "convert" | "merge"): Promise<WorkspaceState | null> => {
    const candidates = visibleWorkspaces.filter((workspace) => {
      const stats = getWorkspaceStats(workspace.sources)
      if (treatAsAll) {
        return kind === "convert" ? stats.totalImageCount > 0 : stats.allPages.length > 0
      }
      return kind === "convert" ? stats.selectedImageCount > 0 : stats.selectedPages.length > 0
    })
    if (candidates.length === 0) return null
    if (!dualEnabled || candidates.length === 1) return candidates[0]

    const action = await Dialog.actionSheet({
      title: kind === "convert" ? "选择转换工作区" : "选择合并工作区",
      cancelButton: true,
      actions: candidates.map((workspace) => {
        const stats = getWorkspaceStats(workspace.sources)
        const itemCount = treatAsAll ? stats.allPages.length : stats.selectedPages.length
        return {
          label: `${workspace.title}（${itemCount} 项）`,
        }
      }),
    })
    if (action == null) return null
    return candidates[action] ?? null
  }, [dualEnabled, treatAsAll, visibleWorkspaces])

  const runConvert = useCallback(async () => {
    if (!canConvert) return
    const target = await chooseWorkspaceForOperation("convert")
    if (!target) return
    const operationSources = treatAsAll ? selectAllPagesByVisualOrder(target.sources) : target.sources
    setProcessing(true)
    try {
      const result = await convertSelectedImagesToPdf(operationSources)
      setProcessing(false)
      await presentExportActionSheet(
        result.data,
        buildOutputFileName("images-converted"),
        `${target.title} 已转换 ${result.pageCount} 页图片`
      )
    } catch (error: any) {
      await Dialog.alert({
        title: "转换失败",
        message: String(error?.message ?? error),
      })
    } finally {
      setProcessing(false)
    }
  }, [canConvert, chooseWorkspaceForOperation, treatAsAll])

  const runMerge = useCallback(async () => {
    if (!canMerge) return
    const target = await chooseWorkspaceForOperation("merge")
    if (!target) return
    const operationSources = treatAsAll ? selectAllPagesByVisualOrder(target.sources) : target.sources
    setProcessing(true)
    try {
      const result = await mergeSelectedPagesToPdf(operationSources)
      setProcessing(false)
      await presentExportActionSheet(
        result.data,
        buildOutputFileName("merged-pdf"),
        `${target.title} 已合并 ${result.pageCount} 页`
      )
    } catch (error: any) {
      await Dialog.alert({
        title: "合并失败",
        message: String(error?.message ?? error),
      })
    } finally {
      setProcessing(false)
    }
  }, [canMerge, chooseWorkspaceForOperation, treatAsAll])

  const handleDropPayload = useCallback((payload: PdfHelperDragPayload, targetWorkspaceId: WorkspaceId, target: { sourceId?: string; pageId?: string } = {}) => {
    setActiveDrag(null)
    setWorkspaces((previous) => {
      const currentPayload = resolveDraggedItem(previous, payload) ?? payload
      // 列表模式：单工作区内不进行重排，仅允许跨工作区互拖
      if (displayMode === "list" && currentPayload.workspaceId === targetWorkspaceId) {
        return previous
      }
      return moveDraggedItem(previous, currentPayload, targetWorkspaceId, target)
    })
  }, [displayMode])

  const toggleDualMode = useCallback(() => {
    const next = !dualEnabled
    setDualEnabled(next)
    Storage.set(DUAL_ENABLED_KEY, next)
  }, [dualEnabled])

  const toggleDisplayMode = useCallback(() => {
    setDisplayMode((previous) => {
      const next = previous === "list" ? "grid" : "list"
      Storage.set(DISPLAY_MODE_KEY, next)
      return next
    })
  }, [])

  const handleRatioChangeEnd = useCallback((nextRatio: number) => {
    const rounded = Math.round(clampRatio(nextRatio) * 1000) / 1000
    setRatio(rounded)
    Storage.set(DUAL_RATIO_KEY, rounded)
  }, [])

  const handleToggleLayout = useCallback(() => {
    setLayoutDir((prev) => {
      const next = prev === "horizontal" ? "vertical" : "horizontal"
      Storage.set(DUAL_LAYOUT_KEY, next)
      return next
    })
  }, [])

  const selectionSummary = treatAsAll
    ? `共 ${totalItemCount} 项 · ${totalPageCount} 页（图片 ${totalImageCount}）`
    : selectedPages.length > 0
      ? `已选择 ${selectedPages.length} 项 · 共 ${selectedTotalPageCount} 页（图片 ${selectedImageCount}）`
      : `未勾选项目 · 点击列表项按序勾选`

  return (
    <NavigationStack>
      <ZStack
        alignment="bottom"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="systemGroupedBackground"
        ignoresSafeArea={{ edges: "bottom" }}
        sheet={releaseNotesSheet}
        navigationTitle="PDF Helper"
        navigationBarTitleDisplayMode="inline"
        toolbarBackground={{ style: "systemGroupedBackground", bars: ["navigationBar"] }}
        toolbar={{
          topBarLeading: (
            <HStack spacing={8}>
              <Button
                title=""
                systemImage={dualEnabled ? "rectangle.split.2x1.fill" : "rectangle.split.2x1"}
                foregroundStyle={isBusy ? "secondaryLabel" : "systemBlue"}
                disabled={isBusy}
                action={toggleDualMode}
              />
              <Button
                title=""
                systemImage={displayMode === "grid" ? "list.bullet" : "square.grid.2x2"}
                foregroundStyle={isBusy ? "secondaryLabel" : "systemBlue"}
                disabled={isBusy}
                action={toggleDisplayMode}
              />
            </HStack>
          ),
          topBarTrailing: (
            <HStack spacing={8}>
              <Button
                title=""
                systemImage="folder"
                foregroundStyle={isBusy ? "secondaryLabel" : "systemBlue"}
                disabled={isBusy}
                action={() => void setImportDirectory()}
              />
              <Menu title="" systemImage="plus">
                <Button title="添加文件" systemImage="doc.badge.plus" action={() => void addFromFiles()} />
                <Button title="添加照片" systemImage="photo.on.rectangle.angled" action={() => void addFromPhotos()} />
              </Menu>
            </HStack>
          ),
        }}
      >
        <Rectangle fill="systemGroupedBackground" ignoresSafeArea={true} allowsHitTesting={false} />
        {dualEnabled ? (
          <GeometryReader>
            {(proxy) => {
              const totalW = proxy.size.width
              const totalH = proxy.size.height
              const primaryPanel = (
                <WorkspacePanel
                  workspace={workspaces[0]}
                  displayMode={displayMode}
                  selectionEnabled={displayMode === "list"}
                  showEmptyState
                  activeDragPayload={activeDrag}
                  onDragStarted={setActiveDrag}
                  onTogglePage={togglePage}
                  onDeletePage={deletePage}
                  onDropPayload={handleDropPayload}
                />
              )
              const secondaryPanel = (
                <WorkspacePanel
                  workspace={workspaces[1]}
                  displayMode={displayMode}
                  selectionEnabled={displayMode === "list"}
                  showEmptyState
                  activeDragPayload={activeDrag}
                  onDragStarted={setActiveDrag}
                  onTogglePage={togglePage}
                  onDeletePage={deletePage}
                  onDropPayload={handleDropPayload}
                />
              )

              return (
                <ZStack>
                  {layoutDir === "horizontal" ? (
                    <HStack spacing={0}>
                      <VStack frame={{ width: Math.max(40, totalW * ratio), maxHeight: "infinity" }} spacing={0}>{primaryPanel}</VStack>
                      <VStack frame={{ width: Math.max(40, totalW * (1 - ratio)), maxHeight: "infinity" }} spacing={0}>{secondaryPanel}</VStack>
                    </HStack>
                  ) : (
                    <VStack spacing={0}>
                      <VStack frame={{ maxWidth: "infinity", height: Math.max(40, totalH * ratio) }} spacing={0}>{primaryPanel}</VStack>
                      <VStack frame={{ maxWidth: "infinity", height: Math.max(40, totalH * (1 - ratio)) }} spacing={0}>{secondaryPanel}</VStack>
                    </VStack>
                  )}
                  <WorkspaceDivider
                    layoutDir={layoutDir}
                    totalW={totalW}
                    totalH={totalH}
                    ratio={ratio}
                    onDragEnd={handleRatioChangeEnd}
                    onToggleLayout={handleToggleLayout}
                  />
                </ZStack>
              )
            }}
          </GeometryReader>
        ) : (
          <WorkspacePanel
            workspace={workspaces[0]}
            displayMode={displayMode}
            selectionEnabled={displayMode === "list"}
            showEmptyState
            activeDragPayload={activeDrag}
            onDragStarted={setActiveDrag}
            onTogglePage={togglePage}
            onDeletePage={deletePage}
            onDropPayload={handleDropPayload}
          />
        )}

        <VStack
          padding={{ bottom: 8, leading: 18, trailing: 18 }}
          frame={{ maxWidth: "infinity", alignment: "bottom" as any }}
        >
          <VStack
            spacing={10}
            padding={{ top: 13, bottom: 12, leading: 18, trailing: 18 }}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            glassEffect={{ type: "rect", cornerRadius: 34 } as any}
          >
            <HStack>
              <Text foregroundStyle="secondaryLabel" font="footnote">
                {selectionSummary}
              </Text>
              <Spacer />
              {loadingMessage ? (
                <HStack spacing={6}>
                  <ProgressView progressViewStyle="circular" />
                  <Text font="footnote">{loadingMessage}</Text>
                </HStack>
              ) : null}
            </HStack>
            <HStack spacing={10}>
              <BottomActionButton
                title="删除"
                systemImage="trash"
                destructive
                disabled={deleteButtonDisabled}
                contextMenu={{
                  menuItems: (
                    <Group>
                      <Button
                        title="删除已导入的 PDF"
                        role="destructive"
                        disabled={isBusy || importedPdfSources.length === 0}
                        action={() => void deleteImportedPdfs()}
                      />
                      <Button
                        title="删除对应源 PDF 文件"
                        role="destructive"
                        disabled={isBusy || importedPdfFilePaths.length === 0}
                        action={() => void deleteImportedPdfFiles()}
                      />
                    </Group>
                  ),
                }}
                action={() => {
                  if (deleteButtonDisabled) return
                  if (dualEnabled) {
                    void Dialog.alert({ message: "双栏模式不使用选择，请左划删除单个项目，或长按打开删除菜单" })
                    return
                  }
                  if (canDeleteSelected) {
                    void deleteSelected()
                    return
                  }
                  void Dialog.alert({ message: "请先选择要删除的项目，或长按打开删除菜单" })
                }}
              />
              <BottomActionButton
                title={processing ? "处理中..." : "转换"}
                systemImage="doc.badge.gearshape"
                disabled={!canConvert}
                action={() => void runConvert()}
              />
              <BottomActionButton
                title={processing ? "处理中..." : "合并"}
                systemImage="square.stack.3d.up.fill"
                disabled={!canMerge}
                action={() => void runMerge()}
              />
            </HStack>
          </VStack>
        </VStack>
      </ZStack>
    </NavigationStack>
  )
}
