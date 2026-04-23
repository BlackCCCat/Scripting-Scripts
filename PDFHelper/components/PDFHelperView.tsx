import {
  Button,
  Divider,
  HStack,
  Image,
  List,
  LongPressGesture,
  Menu,
  NavigationStack,
  Path,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useMemo,
  useState,
} from "scripting"
import type { SourceItem } from "../types"
import { SourceBlockView } from "./SourceBlockView"
import { chooseImportInitialDirectory, pickSourcesFromFiles, pickSourcesFromPhotos } from "../utils/importer"
import { buildOutputFileName } from "../utils/id"
import { convertSelectedImagesToPdf, getSelectedPages, mergeSelectedPagesToPdf } from "../utils/pdf_ops"

function isUserCancelled(error: any): boolean {
  const message = String(error?.message ?? error ?? "").toLowerCase()
  return message.includes("cancel")
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

function assignSelectionOrderForImported(
  sources: SourceItem[],
  startOrder: number
): SourceItem[] {
  let order = startOrder
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

export function PDFHelperView() {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  const [processing, setProcessing] = useState<boolean>(false)

  const selectedPages = useMemo(() => getSelectedPages(sources), [sources])
  const selectedImageCount = useMemo(
    () => selectedPages.filter((page) => page.kind === "image").length,
    [selectedPages]
  )
  const selectedTotalPageCount = useMemo(() => {
    let count = 0
    for (const page of selectedPages) {
      if (page.kind === "pdf-whole") count += page.pageCount
      else count += 1
    }
    return count
  }, [selectedPages])

  const isBusy = processing || loadingMessage !== null
  const canConvert = selectedImageCount > 0 && !isBusy
  const canMerge = selectedPages.length > 0 && !isBusy
  const canDeleteSelected = selectedPages.length > 0 && !isBusy
  const hasAnyItems = sources.length > 0
  const deleteButtonDisabled = isBusy || !hasAnyItems

  const togglePage = useCallback((sourceId: string, pageId: string) => {
    setSources((prev) => {
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
  }, [])

  const deletePage = useCallback((sourceId: string, pageId: string) => {
    setSources((prev) =>
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
  }, [])

  const addFromFiles = useCallback(async () => {
    if (isBusy) return
    setLoadingMessage("正在导入文件...")
    try {
      const imported = await pickSourcesFromFiles()
      if (imported.sources.length > 0) {
        setSources((prev) => {
          const start = getMaxSelectedOrder(prev) + 1
          return [...prev, ...assignSelectionOrderForImported(imported.sources, start)]
        })
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
  }, [isBusy])

  const addFromPhotos = useCallback(async () => {
    if (isBusy) return
    setLoadingMessage("正在导入照片...")
    try {
      const imported = await pickSourcesFromPhotos()
      if (imported.sources.length > 0) {
        setSources((prev) => {
          const start = getMaxSelectedOrder(prev) + 1
          return [...prev, ...assignSelectionOrderForImported(imported.sources, start)]
        })
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
  }, [isBusy])

  const setImportDirectory = useCallback(async () => {
    if (isBusy) return
    try {
      const directory = await chooseImportInitialDirectory()
      if (!directory) return
      await Dialog.alert({
        title: "默认导入路径已设置",
        message: directory,
      })
    } catch (error: any) {
      if (isUserCancelled(error)) return
      await Dialog.alert({
        title: "设置失败",
        message: String(error?.message ?? error),
      })
    }
  }, [isBusy])

  const deleteSelected = useCallback(async () => {
    if (!canDeleteSelected) return
    const ok = await Dialog.confirm({
      title: "删除选中项目",
      message: `确定删除当前选中的 ${selectedPages.length} 个项目吗？`,
    })
    if (!ok) return
    setSources((prev) =>
      compactSelectionOrders(
        prev
          .map((source) => ({
            ...source,
            pages: source.pages.filter((page) => !page.selected),
          }))
          .filter((source) => source.pages.length > 0)
      )
    )
  }, [canDeleteSelected, selectedPages.length])

  const deleteAll = useCallback(async () => {
    if (isBusy || sources.length === 0) return
    const ok = await Dialog.confirm({
      title: "删除全部",
      message: `确定删除当前全部 ${sources.reduce((sum, source) => sum + source.pages.length, 0)} 个项目吗？`,
      confirmLabel: "删除全部",
      cancelLabel: "取消",
    })
    if (!ok) return
    setSources([])
  }, [isBusy, sources])

  const runConvert = useCallback(async () => {
    if (!canConvert) return
    setProcessing(true)
    try {
      const result = await convertSelectedImagesToPdf(sources)
      setProcessing(false)
      await presentExportActionSheet(
        result.data,
        buildOutputFileName("images-converted"),
        `已转换 ${result.pageCount} 页图片`
      )
    } catch (error: any) {
      await Dialog.alert({
        title: "转换失败",
        message: String(error?.message ?? error),
      })
    } finally {
      setProcessing(false)
    }
  }, [canConvert, sources])

  const runMerge = useCallback(async () => {
    if (!canMerge) return
    setProcessing(true)
    try {
      const result = await mergeSelectedPagesToPdf(sources)
      setProcessing(false)
      await presentExportActionSheet(
        result.data,
        buildOutputFileName("merged-pdf"),
        `已合并 ${result.pageCount} 页`
      )
    } catch (error: any) {
      await Dialog.alert({
        title: "合并失败",
        message: String(error?.message ?? error),
      })
    } finally {
      setProcessing(false)
    }
  }, [canMerge, sources])

  return (
    <NavigationStack>
      <VStack
        navigationTitle="PDF Helper"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <ZStack
              frame={{ width: 28, height: 28, alignment: "center" }}
              background={"rgba(0,0,0,0.001)"}
              onTapGesture={() => {
                if (deleteButtonDisabled) return
                if (canDeleteSelected) {
                  void deleteSelected()
                  return
                }
                void Dialog.alert({ message: "请先选择要删除的项目，或长按删除全部" })
              }}
              gesture={
                LongPressGesture({ minDuration: 600 }).onEnded(() => {
                  if (deleteButtonDisabled) return
                  void deleteAll()
                })
              }
            >
              <Image
                systemName="trash"
                foregroundStyle="#DC2626"
                opacity={deleteButtonDisabled ? 0.45 : 1}
              />
            </ZStack>
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
        spacing={0}
      >
        <List listStyle="insetGroup">
          {sources.length === 0 ? (
            <VStack spacing={8} padding={24}>
              <Text>点右上角「+」添加文件或照片</Text>
              <Text foregroundStyle="secondaryLabel">
                图片将显示整图；PDF 可选择按页展示缩略图(文件页数较大时不显示缩略图)或作为整体导入，支持自定义导入页码范围
              </Text>
            </VStack>
          ) : (
            sources.map((source) => (
              <SourceBlockView
                key={source.id}
                source={source}
                onTogglePage={togglePage}
                onDeletePage={deletePage}
              />
            ))
          )}
        </List>

        <Divider />

        <VStack spacing={8} padding={12}>
          <HStack>
            <Text foregroundStyle="secondaryLabel">
              已选择 {selectedPages.length} 项 · 共 {selectedTotalPageCount} 页（图片 {selectedImageCount}）
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
            <Button
              title={processing ? "处理中..." : "转换"}
              systemImage="doc.badge.gearshape"
              buttonStyle="borderedProminent"
              disabled={!canConvert}
              action={() => void runConvert()}
            />
            <Button
              title={processing ? "处理中..." : "合并"}
              systemImage="square.stack.3d.up.fill"
              buttonStyle="borderedProminent"
              disabled={!canMerge}
              action={() => void runMerge()}
            />
          </HStack>
        </VStack>
      </VStack>
    </NavigationStack>
  )
}
