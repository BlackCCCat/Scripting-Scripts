import {
  Button,
  Divider,
  HStack,
  Image,
  List,
  Menu,
  NavigationStack,
  LongPressGesture,
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
import { pickSourcesFromFiles, pickSourcesFromPhotos } from "../utils/importer"
import { buildOutputFileName } from "../utils/id"
import { convertSelectedImagesToPdf, getSelectedPages, mergeSelectedPagesToPdf } from "../utils/pdf_ops"

function isUserCancelled(error: any): boolean {
  const message = String(error?.message ?? error ?? "").toLowerCase()
  return message.includes("cancel")
}

async function confirmAndExportPdf(data: Data, fileName: string, summary: string) {
  const shouldSave = await Dialog.confirm({
    title: "处理完成",
    message: `${summary}\n是否保存文件？`,
    confirmLabel: "保存",
    cancelLabel: "取消",
  })
  if (!shouldSave) return

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
  const nextSources = sources.map((source) => ({
    ...source,
    pages: source.pages.map((page) => {
      if (!page.selected) return { ...page, selectedOrder: undefined }
      const next = { ...page, selectedOrder: order }
      order += 1
      return next
    }),
  }))
  return nextSources
}

function compactSelectionOrders(sources: SourceItem[]): SourceItem[] {
  const selectedRows: Array<{ sourceId: string; pageId: string; order: number }> = []
  for (const source of sources) {
    for (const page of source.pages) {
      if (page.selected) {
        selectedRows.push({
          sourceId: source.id,
          pageId: page.id,
          order: typeof page.selectedOrder === "number" ? page.selectedOrder : Number.MAX_SAFE_INTEGER,
        })
      }
    }
  }

  selectedRows.sort((a, b) => a.order - b.order)
  const orderMap = new Map<string, number>()
  selectedRows.forEach((row, idx) => orderMap.set(`${row.sourceId}::${row.pageId}`, idx + 1))

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

  const isBusy = processing || loadingMessage !== null
  const canConvert = selectedImageCount > 0 && !isBusy
  const canMerge = selectedPages.length > 0 && !isBusy
  const canDeleteSelected = selectedPages.length > 0 && !isBusy
  const hasAnyItems = sources.length > 0
  const deleteButtonDisabled = isBusy || !hasAnyItems

  const togglePage = useCallback((sourceId: string, pageId: string) => {
    setSources((prev) => {
      const currentMax = getMaxSelectedOrder(prev)
      let next = prev.map((source) =>
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
      next = compactSelectionOrders(next)
      return next
    })
  }, [])

  const deletePage = useCallback((sourceId: string, pageId: string) => {
    setSources((prev) => {
      const next = compactSelectionOrders(prev
        .map((source) =>
          source.id !== sourceId
            ? source
            : { ...source, pages: source.pages.filter((page) => page.id !== pageId) }
        )
        .filter((source) => source.pages.length > 0))
      return next
    })
  }, [])

  const addFromFiles = useCallback(async () => {
    if (isBusy) return
    setLoadingMessage("正在导入文件...")
    try {
      const imported = await pickSourcesFromFiles()
      if (imported.sources.length > 0) {
        setSources((prev) => {
          const start = getMaxSelectedOrder(prev) + 1
          const normalized = assignSelectionOrderForImported(imported.sources, start)
          return [...prev, ...normalized]
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
          const normalized = assignSelectionOrderForImported(imported.sources, start)
          return [...prev, ...normalized]
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

  const deleteSelected = useCallback(async () => {
    if (!canDeleteSelected) return
    const ok = await Dialog.confirm({
      title: "删除选中项目",
      message: `确定删除当前选中的 ${selectedPages.length} 个项目吗？`,
    })
    if (!ok) return
    setSources((prev) =>
      compactSelectionOrders(prev
        .map((source) => ({
          ...source,
          pages: source.pages.filter((page) => !page.selected),
        }))
        .filter((source) => source.pages.length > 0))
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

  const convertImages = useCallback(async () => {
    if (!canConvert) return
    setProcessing(true)
    try {
      const result = await convertSelectedImagesToPdf(sources)
      await confirmAndExportPdf(
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

  const mergePages = useCallback(async () => {
    if (!canMerge) return
    setProcessing(true)
    try {
      const result = await mergeSelectedPagesToPdf(sources)
      await confirmAndExportPdf(
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
                LongPressGesture({ minDuration: 600 })
                  .onEnded(() => {
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
            <Menu label={<Image systemName="plus" />}>
              <Button title="添加文件" systemImage="doc.badge.plus" action={() => void addFromFiles()} />
              <Button title="添加照片" systemImage="photo.on.rectangle.angled" action={() => void addFromPhotos()} />
            </Menu>
          ),
        }}
        spacing={0}
      >
        <List listStyle="insetGroup">
          {sources.length === 0 ? (
            <VStack spacing={8} padding={24}>
              <Text>点右上角「+」添加文件或照片</Text>
              <Text foregroundStyle="secondaryLabel">
                图片将显示整图，PDF 将按页展示缩略图，可逐页勾选后执行转换或合并
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
              已选择 {selectedPages.length} 页（图片 {selectedImageCount}）
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
              action={() => void convertImages()}
            />
            <Button
              title={processing ? "处理中..." : "合并"}
              systemImage="square.stack.3d.up.fill"
              buttonStyle="borderedProminent"
              disabled={!canMerge}
              action={() => void mergePages()}
            />
          </HStack>
        </VStack>
      </VStack>
    </NavigationStack>
  )
}
