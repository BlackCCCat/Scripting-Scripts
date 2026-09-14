import type { PdfHelperDragPayload, SourceItem, WorkspaceId, WorkspaceState } from "../types"
import { createId } from "./id"

function renumberSelectionOrders(sources: SourceItem[]): SourceItem[] {
  let order = 1
  return sources.map((source) => ({
    ...source,
    pages: source.pages.map((page) => {
      if (!page.selected) return { ...page, selectedOrder: undefined }
      const nextPage = { ...page, selectedOrder: order }
      order += 1
      return nextPage
    }),
  }))
}

export function resolveDraggedItem(
  workspaces: WorkspaceState[],
  payload: PdfHelperDragPayload
): PdfHelperDragPayload | null {
  for (const workspace of workspaces) {
    if (payload.kind === "source") {
      if (workspace.sources.some((source) => source.id === payload.sourceId)) {
        return { ...payload, workspaceId: workspace.id }
      }
      continue
    }

    for (const source of workspace.sources) {
      if (source.pages.some((page) => page.id === payload.pageId)) {
        return { ...payload, workspaceId: workspace.id, sourceId: source.id }
      }
    }
  }
  return null
}

export function moveDraggedItem(
  workspaces: WorkspaceState[],
  payload: PdfHelperDragPayload,
  targetWorkspaceId: WorkspaceId,
  target: { sourceId?: string; pageId?: string } = {}
): WorkspaceState[] {
  if (payload.kind === "page" && payload.pageId === target.pageId) return workspaces
  if (payload.kind === "source" && payload.sourceId === target.sourceId) return workspaces

  const next = workspaces.map((workspace) => ({
    ...workspace,
    sources: workspace.sources.map((source) => ({ ...source, pages: [...source.pages] })),
  }))
  const originWorkspace = next.find((workspace) => workspace.id === payload.workspaceId)
  const targetWorkspace = next.find((workspace) => workspace.id === targetWorkspaceId)
  if (!originWorkspace || !targetWorkspace) return workspaces

  if (payload.kind === "source") {
    const sourceIndex = originWorkspace.sources.findIndex((source) => source.id === payload.sourceId)
    if (sourceIndex < 0) return workspaces
    const [movingSource] = originWorkspace.sources.splice(sourceIndex, 1)
    let insertIndex = target.sourceId
      ? targetWorkspace.sources.findIndex((source) => source.id === target.sourceId)
      : targetWorkspace.sources.length
    if (insertIndex < 0) insertIndex = targetWorkspace.sources.length
    targetWorkspace.sources.splice(insertIndex, 0, movingSource)
  } else {
    const originSourceIndex = originWorkspace.sources.findIndex((source) => source.id === payload.sourceId)
    if (originSourceIndex < 0 || !payload.pageId) return workspaces
    const originSource = originWorkspace.sources[originSourceIndex]
    const movingFromMultiPageSource = originSource.pages.length > 1
    const movingAcrossWorkspaces = originWorkspace.id !== targetWorkspace.id
    const pageIndex = originSource.pages.findIndex((page) => page.id === payload.pageId)
    if (pageIndex < 0) return workspaces
    const [movingPage] = originSource.pages.splice(pageIndex, 1)
    const movingPageSourceKind = movingPage.kind === "image" ? "image" : "pdf"
    let reusableSourceId = false
    if (originSource.pages.length === 0) {
      originWorkspace.sources.splice(originSourceIndex, 1)
      reusableSourceId = true
    }

    const targetSource = target.sourceId
      ? targetWorkspace.sources.find((source) => source.id === target.sourceId)
      : undefined

    if (targetSource && targetSource.id === payload.sourceId) {
      let insertIndex = target.pageId
        ? targetSource.pages.findIndex((page) => page.id === target.pageId)
        : targetSource.pages.length
      if (insertIndex < 0) insertIndex = targetSource.pages.length
      targetSource.pages.splice(insertIndex, 0, movingPage)
    } else if (
      targetSource &&
      target.pageId &&
      (movingFromMultiPageSource || movingAcrossWorkspaces) &&
      (targetSource.kind === movingPageSourceKind || targetSource.kind === "pdf")
    ) {
      let insertIndex = targetSource.pages.findIndex((page) => page.id === target.pageId)
      if (insertIndex < 0) insertIndex = targetSource.pages.length
      targetSource.pages.splice(insertIndex, 0, movingPage)
    } else {
      const pageSource: SourceItem = {
        id: reusableSourceId ? originSource.id : createId("source"),
        kind: movingPageSourceKind,
        name: movingPage.sourceName,
        originalPath: movingPage.kind === "image" ? undefined : movingPage.pdfPath,
        pages: [movingPage],
      }
      let insertIndex = target.sourceId
        ? targetWorkspace.sources.findIndex((source) => source.id === target.sourceId)
        : targetWorkspace.sources.length
      if (insertIndex < 0) insertIndex = targetWorkspace.sources.length
      targetWorkspace.sources.splice(insertIndex, 0, pageSource)
    }
  }

  return next.map((workspace) => ({
    ...workspace,
    sources: renumberSelectionOrders(workspace.sources),
  }))
}
