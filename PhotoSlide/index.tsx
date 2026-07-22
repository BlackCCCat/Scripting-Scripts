import {
  Script,
  Navigation,
  NavigationStack,
  ZStack,
  VStack,
  HStack,
  Group,
  Spacer,
  Text,
  Image,
  Button,
  Menu,
  DatePicker,
  ProgressView,
  Toolbar,
  ToolbarItem,
  useEffect,
  useRef,
  useState,
  ScrollView,
  Markdown,
} from "scripting"
import { PhotoCardStack } from "./components/PhotoCardStack"
import {
  FETCH_LIMIT,
  SWIPE_THRESHOLD,
  cardHeight,
  cardWidth,
  screenWidth,
  screenHeight,
  skipTargetOffset,
} from "./constants"
import type { AlbumOption, PhotoItem, PhotoSource, PointOffset } from "./types"
import { formatDate, interactiveMotion, trashFlightMotion } from "./utils"
import { instructionsMarkdown } from "./instructions"
import { useMarkdownReleaseNotesSheet } from "./components/ReleaseNotesSheet"

const initialOffset: PointOffset = { x: 0, y: 0 }
const allPhotosSource: PhotoSource = { kind: "all" }
const screenshotsSource: PhotoSource = { kind: "screenshots" }
const dayInMilliseconds = 24 * 60 * 60 * 1000

type UndoAction =
  | {
      kind: "skip" | "queueDelete"
      id: string
      index: number
    }
  | {
      kind: "albumMove"
      id: string
      index: number
      targetAlbumId: string
      sourceAlbumId?: string
      removedFromSource: boolean
      wasSkipped: boolean
    }

type AlbumMoveHiddenRecord = {
  id: string
  targetAlbumId: string
}

function sourceKey(source: PhotoSource): string {
  if (source.kind === "album") return `album:${source.albumId ?? ""}`
  return source.kind
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function endOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}


function App() {
  const dismiss = Navigation.useDismiss()
  const today = startOfDay(Date.now())
  const defaultStartDate = today - 30 * dayInMilliseconds
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "release-notes.md",
    storageKey: "photoslide:release-notes:last-seen-hash",
  })


  const [items, setItems] = useState<PhotoItem[]>([])
  const [albums, setAlbums] = useState<AlbumOption[]>([])
  const [selectedSource, setSelectedSource] = useState<PhotoSource>(allPhotosSource)
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [dateFilterEnabled, setDateFilterEnabled] = useState(false)
  const [dateFilterStart, setDateFilterStart] = useState(defaultStartDate)
  const [dateFilterEnd, setDateFilterEnd] = useState(today)
  const [draftDateStart, setDraftDateStart] = useState(defaultStartDate)
  const [draftDateEnd, setDraftDateEnd] = useState(today)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([])
  const [dragOffset, setDragOffset] = useState<PointOffset>(initialOffset)
  const [cardScale, setCardScale] = useState(1)
  const [cardOpacity, setCardOpacity] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(false)
  const [isThrowing, setIsThrowing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isEditingPhoto, setIsEditingPhoto] = useState(false)
  const [message, setMessage] = useState("")
  const [showToast, setShowToast] = useState(false)
  const [showManagementSheet, setShowManagementSheet] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [showSkippedOnly, setShowSkippedOnly] = useState(false)
  const [skippedPhotoIds, setSkippedPhotoIds] = useState<string[]>(() => {
    return Storage.get<string[]>("skippedPhotoIds") ?? []
  })
  const [albumMoveHiddenRecords, setAlbumMoveHiddenRecords] = useState<AlbumMoveHiddenRecord[]>(() => {
    return Storage.get<AlbumMoveHiddenRecord[]>("albumMoveHiddenRecords") ?? []
  })
  const [hiddenAlbumIds, setHiddenAlbumIds] = useState<string[]>(() => {
    return Storage.get<string[]>("hiddenAlbumIds") ?? []
  })

  function toggleAlbumVisibility(albumId: string) {
    setHiddenAlbumIds(prev => {
      const next = prev.includes(albumId)
        ? prev.filter(id => id !== albumId)
        : [...prev, albumId]
      Storage.set("hiddenAlbumIds", next)
      return next
    })
  }

  function addAlbumMoveHiddenRecord(id: string, targetAlbumId: string) {
    setAlbumMoveHiddenRecords(prev => {
      const exists = prev.some(record =>
        record.id === id &&
        record.targetAlbumId === targetAlbumId
      )
      const next = exists ? prev : [...prev, { id, targetAlbumId }]
      Storage.set("albumMoveHiddenRecords", next)
      return next
    })
  }

  function removeAlbumMoveHiddenRecord(id: string, targetAlbumId?: string) {
    setAlbumMoveHiddenRecords(prev => {
      const next = prev.filter(record => {
        if (record.id !== id) return true
        return targetAlbumId ? record.targetAlbumId !== targetAlbumId : false
      })
      Storage.set("albumMoveHiddenRecords", next)
      return next
    })
  }

  const loadingImageIdsRef = useRef<Set<string>>(new Set())
  const allSourceAssetsRef = useRef<PHAsset[]>([])
  const unavailablePhotoIds = [...deletedPhotoIds, ...pendingDeleteIds]

  function findPreviousActiveIndex(
    fromIndex: number,
    currentSkipped = skippedPhotoIds,
    currentDeleted = unavailablePhotoIds
  ): number {
    for (let i = fromIndex - 1; i >= 0; i--) {
      const id = items[i].id
      const isDeleted = currentDeleted.includes(id)
      if (isDeleted) continue

      if (showSkippedOnly) {
        if (currentSkipped.includes(id)) {
          return i
        }
      } else {
        if (!currentSkipped.includes(id)) {
          return i
        }
      }
    }
    return -1
  }

  function findNextActiveIndex(
    fromIndex: number,
    currentSkipped = skippedPhotoIds,
    currentDeleted = unavailablePhotoIds
  ): number {
    for (let i = fromIndex + 1; i < items.length; i++) {
      const id = items[i].id
      const isDeleted = currentDeleted.includes(id)
      if (isDeleted) continue

      if (showSkippedOnly) {
        if (currentSkipped.includes(id)) {
          return i
        }
      } else {
        if (!currentSkipped.includes(id)) {
          return i
        }
      }
    }
    return items.length
  }

  const currentItem = items[currentIndex]
  const nextItem = items[findNextActiveIndex(currentIndex)]
  const selectedAlbum = selectedSource.kind === "album"
    ? albums.find(album => album.id === selectedSource.albumId)
    : undefined
  const selectedSourceTitle = selectedSource.kind === "screenshots"
    ? "截图"
    : selectedSource.kind === "album"
      ? selectedAlbum?.title ?? "相簿"
      : "全部照片"
  const targetAlbums = albums.filter(album => album.collection.type === "album")

  const skippedCount = allSourceAssetsRef.current.filter(asset =>
    skippedPhotoIds.includes(asset.localIdentifier) &&
    !unavailablePhotoIds.includes(asset.localIdentifier)
  ).length

  const remainingCount = showSkippedOnly
    ? allSourceAssetsRef.current.filter(asset =>
        skippedPhotoIds.includes(asset.localIdentifier) &&
        !unavailablePhotoIds.includes(asset.localIdentifier)
      ).length
    : allSourceAssetsRef.current.filter(asset =>
        !skippedPhotoIds.includes(asset.localIdentifier) &&
        !unavailablePhotoIds.includes(asset.localIdentifier)
      ).length
  const isBusy = isLoading || isThrowing || isDeleting || isEditingPhoto
  const isEmpty = !isLoading && items.length === 0
  const isFinished = !isLoading && items.length > 0 && currentIndex >= items.length
  const getProgressStats = () => {
    let currentActiveDisplayIndex = 0
    let totalActiveCount = 0

    for (let i = 0; i < items.length; i++) {
      const id = items[i].id
      const isDeleted = unavailablePhotoIds.includes(id)
      if (isDeleted) continue

      const isSkipped = skippedPhotoIds.includes(id)
      const isActive = showSkippedOnly ? isSkipped : !isSkipped

      if (isActive) {
        totalActiveCount++
        if (i < currentIndex) {
          currentActiveDisplayIndex++
        }
      }
    }

    const isCurrentActive = currentItem && !unavailablePhotoIds.includes(currentItem.id) &&
      (showSkippedOnly ? skippedPhotoIds.includes(currentItem.id) : !skippedPhotoIds.includes(currentItem.id))
    
    const displayIndex = isCurrentActive ? currentActiveDisplayIndex + 1 : currentActiveDisplayIndex

    return {
      displayIndex,
      total: totalActiveCount
    }
  }

  const activeStats = getProgressStats()
  const progressText = isLoading
    ? "正在读取照片…"
    : isFinished
      ? "本组照片已浏览完"
      : `${activeStats.displayIndex} / ${activeStats.total}`
  const dateFilterKey = dateFilterEnabled
    ? `${startOfDay(dateFilterStart)}-${endOfDay(dateFilterEnd)}`
    : "all-dates"

  function toast(text: string) {
    setMessage(text)
    setShowToast(true)
  }

  function resetCardState() {
    setDragOffset(initialOffset)
    setCardScale(1)
    setCardOpacity(1)
  }

  function buildPhotoItems(assets: PHAsset[]): PhotoItem[] {
    return assets.map(asset => ({
      id: asset.localIdentifier,
      asset,
      image: null,
      loading: false,
    }))
  }

  async function syncAlbumMoveHiddenState(currentSkippedIds = skippedPhotoIds) {
    if (albumMoveHiddenRecords.length === 0) return currentSkippedIds

    const validRecords: AlbumMoveHiddenRecord[] = []
    const groupedRecords = new Map<string, AlbumMoveHiddenRecord[]>()

    for (const record of albumMoveHiddenRecords) {
      const records = groupedRecords.get(record.targetAlbumId) ?? []
      records.push(record)
      groupedRecords.set(record.targetAlbumId, records)
    }

    for (const [albumId, records] of groupedRecords) {
      try {
        const collection = await findAlbumCollection(albumId)
        if (!collection) continue

        const albumAssets = await collection.fetchAssets({
          mediaType: "image",
          limit: FETCH_LIMIT,
        })
        const albumAssetIds = new Set(albumAssets.map(asset => asset.localIdentifier))

        for (const record of records) {
          if (albumAssetIds.has(record.id)) {
            validRecords.push(record)
          }
        }
      } catch (error) {
        console.error(error)
        validRecords.push(...records)
      }
    }

    const validHiddenIds = new Set(validRecords.map(record => record.id))
    const staleHiddenIds = new Set(
      albumMoveHiddenRecords
        .filter(record => !validHiddenIds.has(record.id))
        .map(record => record.id)
    )

    const nextSkippedIds = staleHiddenIds.size > 0
      ? currentSkippedIds.filter(id => !staleHiddenIds.has(id))
      : currentSkippedIds

    if (validRecords.length !== albumMoveHiddenRecords.length) {
      Storage.set("albumMoveHiddenRecords", validRecords)
      setAlbumMoveHiddenRecords(validRecords)
    }

    if (nextSkippedIds.length !== currentSkippedIds.length) {
      Storage.set("skippedPhotoIds", nextSkippedIds)
      setSkippedPhotoIds(nextSkippedIds)
    }

    return nextSkippedIds
  }

  async function loadAlbums() {
    setIsLoadingAlbums(true)

    try {
      const collections = await Photos.fetchAlbums()
      const options = collections
        .filter(collection => collection.title || collection.estimatedAssetCount > 0)
        .map<AlbumOption>(collection => ({
          id: collection.localIdentifier,
          title: collection.title ?? collection.subtype,
          subtitle: collection.type === "smartAlbum" ? "智能相簿" : "用户相簿",
          count: Math.max(collection.estimatedAssetCount, 0),
          collection,
        }))
        .sort((left, right) => {
          if (left.collection.type !== right.collection.type) {
            return left.collection.type === "album" ? -1 : 1
          }
          return left.title.localeCompare(right.title)
        })

      setAlbums(options)
    } catch (error) {
      console.error(error)
      toast("读取相簿失败，仍可整理全部照片。")
    } finally {
      setIsLoadingAlbums(false)
    }
  }

  async function loadImagesForIndexes(sourceItems: PhotoItem[], indexes: number[]) {
    const validIndexes = indexes.filter(index => index >= 0 && index < sourceItems.length)
    if (validIndexes.length === 0) return

    const imageScale = Math.min(Device.screen.scale, 2)

    for (const index of validIndexes) {
      const item = sourceItems[index]
      if (!item || item.image || loadingImageIdsRef.current.has(item.id)) continue
      loadingImageIdsRef.current.add(item.id)

      let image: UIImage | null = null
      try {
        image = await item.asset.requestImage({
          targetWidth: Math.round(cardWidth * imageScale),
          targetHeight: Math.round(cardHeight * imageScale),
          contentMode: "aspectFit",
          deliveryMode: "highQualityFormat",
          allowNetworkAccess: true,
        })
      } catch (error) {
        console.error(error)
      } finally {
        loadingImageIdsRef.current.delete(item.id)
      }

      if (!image) continue

      setItems(list => {
        const current = list[index]
        if (!current || current.id !== item.id) return list

        const copy = [...list]
        copy[index] = {
          ...current,
          image,
          loading: false,
        }
        return copy
      })
    }
  }

  async function fetchAssetsForSource(source: PhotoSource): Promise<PHAsset[]> {
    const options: PHFetchOptions = {
      mediaType: "image",
      sortBy: "creationDate",
      ascending: false,
      limit: FETCH_LIMIT,
      createdAfter: dateFilterEnabled ? startOfDay(dateFilterStart) : undefined,
      createdBefore: dateFilterEnabled ? endOfDay(dateFilterEnd) : undefined,
    }

    if (source.kind === "screenshots") {
      return Photos.fetchAssets({
        ...options,
        mediaSubtypes: ["photoScreenshot"],
      })
    }

    if (source.kind === "album" && source.albumId) {
      const album = albums.find(item => item.id === source.albumId)
      if (album) return album.collection.fetchAssets(options)

      const collection = await Photos.fetchAlbum(source.albumId)
      return collection ? collection.fetchAssets(options) : []
    }

    return Photos.fetchAssets(options)
  }

  async function loadPhotos(source = selectedSource) {
    setIsLoading(true)

    try {
      const status = Photos.authorizationStatus("readWrite")
      if (status === "denied" || status === "restricted") {
        toast("没有照片访问权限，请在系统设置中允许访问照片。")
        setIsLoading(false)
        return
      }

      const assets = await fetchAssetsForSource(source)
      allSourceAssetsRef.current = assets
      const syncedSkippedPhotoIds = await syncAlbumMoveHiddenState(skippedPhotoIds)

      const filteredAssets = assets.filter(asset => {
        const isPendingDelete = unavailablePhotoIds.includes(asset.localIdentifier)
        const isSkipped = syncedSkippedPhotoIds.includes(asset.localIdentifier)

        if (isPendingDelete) return false

        if (showSkippedOnly) {
          return isSkipped
        } else {
          return !isSkipped
        }
      })

      const photoItems = buildPhotoItems(filteredAssets)

      loadingImageIdsRef.current.clear()
      setItems(photoItems)
      setCurrentIndex(0)
      resetCardState()
      setIsLoading(false)

      await loadImagesForIndexes(photoItems, [0, 1])
    } catch (error) {
      console.error(error)
      setIsLoading(false)
      toast("读取照片失败，请稍后重试。")
    }
  }

  useEffect(() => {
    loadAlbums()
  }, [])

  useEffect(() => {
    loadPhotos(selectedSource)
  }, [sourceKey(selectedSource), dateFilterKey, showSkippedOnly])

  useEffect(() => {
    loadImagesForIndexes(items, [currentIndex, currentIndex + 1, currentIndex + 2])
  }, [currentIndex])

  async function refreshCurrentView() {
    await loadAlbums()
    await loadPhotos(selectedSource)
  }

  function selectSource(source: PhotoSource) {
    setSelectedSource(source)
    resetCardState()
  }

  function applyDateFilter() {
    const start = startOfDay(draftDateStart)
    const end = endOfDay(draftDateEnd)

    if (start > end) {
      toast("开始日期不能晚于结束日期。")
      return
    }

    setDateFilterStart(start)
    setDateFilterEnd(end)
    setDateFilterEnabled(true)
    setShowDateFilter(false)
  }

  function clearDateFilter() {
    setDateFilterEnabled(false)
    setDraftDateStart(defaultStartDate)
    setDraftDateEnd(today)
    setShowDateFilter(false)
  }



  async function throwCurrentToTrash() {
    if (!currentItem || isThrowing || isDeleting || isEditingPhoto) return

    setIsThrowing(true)

    const flight = trashFlightMotion(dragOffset)
    await withAnimation(
      Animation.easeIn(0.44),
      () => {
        setDragOffset(flight.offset)
        setCardScale(flight.scale)
        setCardOpacity(flight.opacity)
      }
    )

    const updatedDeleted = pendingDeleteIds.includes(currentItem.id)
      ? pendingDeleteIds
      : [...pendingDeleteIds, currentItem.id]
    setPendingDeleteIds(updatedDeleted)

    setUndoStack(stack => [...stack, {
      kind: "queueDelete",
      id: currentItem.id,
      index: currentIndex,
    }])

    resetCardState()
    setCurrentIndex(findNextActiveIndex(currentIndex, skippedPhotoIds, [
      ...deletedPhotoIds,
      ...updatedDeleted,
    ]))
    setIsThrowing(false)
  }

  async function skipCurrentPhoto(dir: "down") {
    if (!currentItem || isThrowing || isDeleting || isEditingPhoto) return

    setIsThrowing(true)

    const targetY = screenHeight * 1.1

    await withAnimation(
      Animation.easeOut(0.26),
      () => {
        setDragOffset({ x: 0, y: targetY })
        setCardScale(0.92)
        setCardOpacity(0)
      }
    )

    setSkippedPhotoIds(prev => {
      const next = prev.includes(currentItem.id) ? prev : [...prev, currentItem.id]
      Storage.set("skippedPhotoIds", next)
      return next
    })

    setUndoStack(stack => [...stack, {
      kind: "skip",
      id: currentItem.id,
      index: currentIndex,
    }])

    resetCardState()
    const nextSkipped = skippedPhotoIds.includes(currentItem.id)
      ? skippedPhotoIds
      : [...skippedPhotoIds, currentItem.id]
    setCurrentIndex(findNextActiveIndex(currentIndex, nextSkipped))
    setIsThrowing(false)
  }

  async function unskipCurrentPhoto(dir: "down") {
    if (!currentItem || isThrowing || isDeleting || isEditingPhoto) return

    setIsThrowing(true)

    const targetY = screenHeight * 1.1

    await withAnimation(
      Animation.easeOut(0.26),
      () => {
        setDragOffset({ x: 0, y: targetY })
        setCardScale(0.92)
        setCardOpacity(0)
      }
    )

    setSkippedPhotoIds(prev => {
      const next = prev.filter(id => id !== currentItem.id)
      Storage.set("skippedPhotoIds", next)
      return next
    })

    resetCardState()
    const nextSkipped = skippedPhotoIds.filter(id => id !== currentItem.id)
    setCurrentIndex(findNextActiveIndex(currentIndex, nextSkipped))
    setIsThrowing(false)
  }

  async function browseNextPhoto(dir: "left") {
    if (!currentItem || isThrowing || isDeleting || isEditingPhoto) return

    setIsThrowing(true)

    const targetX = -screenWidth * 1.1

    await withAnimation(
      Animation.easeOut(0.26),
      () => {
        setDragOffset({ x: targetX, y: 0 })
        setCardScale(0.92)
        setCardOpacity(0)
      }
    )

    resetCardState()
    setCurrentIndex(findNextActiveIndex(currentIndex))
    setIsThrowing(false)
  }

  async function goBackToPreviousPhoto() {
    if (isBusy) return

    const prevIndex = findPreviousActiveIndex(currentIndex)
    if (prevIndex < 0) {
      toast("前面没有更多照片了。")
      return
    }

    setIsThrowing(true)
    setDragOffset({ x: -screenWidth * 1.1, y: 0 })
    setCardScale(0.92)
    setCardOpacity(0)
    setCurrentIndex(prevIndex)

    await withAnimation(
      Animation.spring({ response: 0.32, dampingFraction: 0.8 }),
      () => {
        setDragOffset({ x: 0, y: 0 })
        setCardScale(1)
        setCardOpacity(1)
      }
    )

    setIsThrowing(false)
  }

  function resetDrag() {
    withAnimation(Animation.spring({ response: 0.28, dampingFraction: 0.82 }), resetCardState)
  }

  async function findAlbumCollection(albumId?: string): Promise<PHAssetCollection | null> {
    if (!albumId) return null
    const knownAlbum = albums.find(album => album.id === albumId)
    if (knownAlbum) return knownAlbum.collection
    return Photos.fetchAlbum(albumId)
  }

  async function undoAlbumMove(undoAction: Extract<UndoAction, { kind: "albumMove" }>) {
    setIsEditingPhoto(true)

    try {
      const existingItem = items.find(item => item.id === undoAction.id)
      const asset = existingItem?.asset ?? await Photos.fetchAsset(undoAction.id)
      if (!asset) {
        setUndoStack(stack => stack.slice(0, -1))
        toast("照片已不存在，无法撤销相簿操作。")
        return
      }

      const targetIsOriginalSource =
        undoAction.sourceAlbumId === undoAction.targetAlbumId &&
        !undoAction.removedFromSource

      if (!targetIsOriginalSource) {
        const targetCollection = await findAlbumCollection(undoAction.targetAlbumId)
        if (!targetCollection) {
          toast("找不到目标相簿，无法撤销。")
          return
        }

        const removedFromTarget = await targetCollection.removeAssets([asset])
        if (!removedFromTarget) {
          toast("无法从目标相簿移除，撤销失败。")
          return
        }
      }

      if (undoAction.removedFromSource) {
        const sourceCollection = await findAlbumCollection(undoAction.sourceAlbumId)
        if (sourceCollection) {
          await sourceCollection.addAssets([asset])
        }
      }

      if (!undoAction.wasSkipped) {
        removeAlbumMoveHiddenRecord(undoAction.id, undoAction.targetAlbumId)
        setSkippedPhotoIds(prev => {
          const next = prev.filter(id => id !== undoAction.id)
          Storage.set("skippedPhotoIds", next)
          return next
        })
      }

      const willBeSkippedAfterUndo = undoAction.wasSkipped
      const isActiveInCurrentMode = showSkippedOnly
        ? willBeSkippedAfterUndo
        : !willBeSkippedAfterUndo
      const currentSourceIsTargetAlbum =
        selectedSource.kind === "album" &&
        selectedSource.albumId === undoAction.targetAlbumId &&
        !targetIsOriginalSource
      const currentSourceIsRestoredSourceAlbum =
        selectedSource.kind === "album" &&
        selectedSource.albumId === undoAction.sourceAlbumId &&
        undoAction.removedFromSource
      const currentSourceCanContainAsset =
        selectedSource.kind === "all" ||
        (selectedSource.kind === "screenshots" && asset.mediaSubtypes.includes("photoScreenshot")) ||
        currentSourceIsRestoredSourceAlbum ||
        (
          selectedSource.kind === "album" &&
          selectedSource.albumId === undoAction.targetAlbumId &&
          targetIsOriginalSource
        )
      const shouldShowInCurrentList = currentSourceCanContainAsset && isActiveInCurrentMode

      if (currentSourceIsTargetAlbum) {
        allSourceAssetsRef.current = allSourceAssetsRef.current.filter(
          sourceAsset => sourceAsset.localIdentifier !== undoAction.id
        )
        setItems(list => {
          const next = list.filter(item => item.id !== undoAction.id)
          setCurrentIndex(index => Math.min(index, Math.max(next.length - 1, 0)))
          return next
        })
      } else if (
        currentSourceIsRestoredSourceAlbum &&
        !allSourceAssetsRef.current.some(sourceAsset => sourceAsset.localIdentifier === undoAction.id)
      ) {
        allSourceAssetsRef.current = [
          ...allSourceAssetsRef.current.slice(0, Math.min(undoAction.index, allSourceAssetsRef.current.length)),
          asset,
          ...allSourceAssetsRef.current.slice(Math.min(undoAction.index, allSourceAssetsRef.current.length)),
        ]
      }

      const currentListIndex = items.findIndex(item => item.id === undoAction.id)
      if (currentListIndex < 0 && shouldShowInCurrentList) {
        const restoredItem: PhotoItem = {
          id: undoAction.id,
          asset,
          image: null,
          loading: false,
        }
        setItems(list => {
          if (list.some(item => item.id === undoAction.id)) return list
          const insertIndex = Math.min(undoAction.index, list.length)
          return [
            ...list.slice(0, insertIndex),
            restoredItem,
            ...list.slice(insertIndex),
          ]
        })
      }

      resetCardState()
      if (!currentSourceIsTargetAlbum) {
        if (currentListIndex >= 0 && shouldShowInCurrentList) {
          setCurrentIndex(currentListIndex)
        } else if (currentListIndex < 0 && shouldShowInCurrentList) {
          setCurrentIndex(Math.min(undoAction.index, items.length))
        }
      }
      setUndoStack(stack => stack.slice(0, -1))
      toast("已撤销相簿操作。")
    } catch (error) {
      console.error(error)
      toast("撤销相簿操作失败。")
    } finally {
      setIsEditingPhoto(false)
    }
  }

  async function undoLastSwipe() {
    if (undoStack.length === 0 || isBusy) return

    const undoAction = undoStack[undoStack.length - 1]

    if (undoAction.kind === "albumMove") {
      await undoAlbumMove(undoAction)
      return
    }

    const targetIndex = items.findIndex(item => item.id === undoAction.id)

    if (undoAction.kind === "queueDelete") {
      setPendingDeleteIds(ids => ids.filter(id => id !== undoAction.id))
    } else if (undoAction.kind === "skip") {
      setSkippedPhotoIds(prev => {
        const next = prev.filter(id => id !== undoAction.id)
        Storage.set("skippedPhotoIds", next)
        return next
      })
    }

    resetCardState()
    if (targetIndex >= 0) {
      setCurrentIndex(targetIndex)
    }
    setUndoStack(stack => stack.slice(0, -1))
    if (targetIndex < 0) {
      toast("已撤销，当前筛选中不显示这张照片。")
    }
  }

  async function deletePendingPhotos() {
    if (isDeleting) return

    if (pendingDeleteIds.length === 0) {
      toast("暂无待删除照片，先右滑图片加入垃圾箱。")
      return
    }

    setIsDeleting(true)

    try {
      const idsToDelete = [...pendingDeleteIds]
      const assets = await Photos.fetchAssets(idsToDelete)
      if (assets.length === 0) {
        setPendingDeleteIds([])
        setDeletedPhotoIds(ids => [...new Set([...ids, ...idsToDelete])])
        setUndoStack(stack => stack.filter(action => !idsToDelete.includes(action.id)))
        toast("待删除照片已不存在。")
        setIsDeleting(false)
        return
      }

      const ok = await Photos.deleteAssets(assets)
      if (!ok) {
        toast("已取消删除，待删除队列仍保留。")
        setIsDeleting(false)
        return
      }

      const deletedSet = new Set(idsToDelete)
      allSourceAssetsRef.current = allSourceAssetsRef.current.filter(
        asset => !deletedSet.has(asset.localIdentifier)
      )
      setDeletedPhotoIds(ids => [...new Set([...ids, ...idsToDelete])])

      setSkippedPhotoIds(prev => {
        const next = prev.filter(id => !deletedSet.has(id))
        Storage.set("skippedPhotoIds", next)
        return next
      })

      setPendingDeleteIds([])
      setUndoStack(stack => stack.filter(action => !idsToDelete.includes(action.id)))
      toast(`已删除 ${idsToDelete.length} 张照片。`)
    } catch (error) {
      console.error(error)
      toast("删除失败，请稍后重试。")
    } finally {
      setIsDeleting(false)
    }
  }

  async function toggleFavoriteForCurrent() {
    if (!currentItem || isBusy) return

    setIsEditingPhoto(true)

    try {
      const nextFavorite = !currentItem.asset.isFavorite
      const ok = await currentItem.asset.setFavorite(nextFavorite)
      if (!ok) {
        toast("收藏标记未变更。")
        return
      }

      const refreshed = await Photos.fetchAsset(currentItem.id)
      setItems(list => list.map(item => item.id === currentItem.id
        ? { ...item, asset: refreshed ?? item.asset }
        : item
      ))
      toast(nextFavorite ? "已标记为收藏。" : "已取消收藏。")
    } catch (error) {
      console.error(error)
      toast("修改收藏标记失败。")
    } finally {
      setIsEditingPhoto(false)
    }
  }

  async function moveCurrentToAlbum(targetAlbum: AlbumOption) {
    if (!currentItem || isBusy) return

    setIsEditingPhoto(true)

    try {
      const wasSkipped = skippedPhotoIds.includes(currentItem.id)
      const ok = await targetAlbum.collection.addAssets([currentItem.asset])
      if (!ok) {
        toast("加入目标相簿失败，可能不是可编辑相簿。")
        return
      }

      const sourceAlbum = selectedSource.kind === "album"
        ? albums.find(album => album.id === selectedSource.albumId)
        : undefined
      const shouldRemoveFromSource = Boolean(
        sourceAlbum &&
        sourceAlbum.id !== targetAlbum.id &&
        sourceAlbum.collection.type === "album"
      )
      let removedFromSource = false

      if (sourceAlbum && shouldRemoveFromSource) {
        const removed = await sourceAlbum.collection.removeAssets([currentItem.asset])
        removedFromSource = removed !== false
        if (removedFromSource) {
          setItems(list => list.filter(item => item.id !== currentItem.id))
          setPendingDeleteIds(ids => ids.filter(id => id !== currentItem.id))
        }
      } else {
        setCurrentIndex(index => index + 1)
      }

      setUndoStack(stack => [...stack, {
        kind: "albumMove",
        id: currentItem.id,
        index: currentIndex,
        targetAlbumId: targetAlbum.id,
        sourceAlbumId: sourceAlbum?.id,
        removedFromSource,
        wasSkipped,
      }])

      if (!wasSkipped) {
        addAlbumMoveHiddenRecord(currentItem.id, targetAlbum.id)
      }

      setSkippedPhotoIds(prev => {
        const next = prev.includes(currentItem.id) ? prev : [...prev, currentItem.id]
        Storage.set("skippedPhotoIds", next)
        return next
      })

      resetCardState()
      toast(`已移动到「${targetAlbum.title}」。`)
    } catch (error) {
      console.error(error)
      toast("移动照片失败。")
    } finally {
      setIsEditingPhoto(false)
    }
  }

  async function handleCreateAlbum() {
    const title = await Dialog.prompt({
      title: "新建相簿",
      placeholder: "请输入新相簿名称",
      confirmLabel: "创建",
      cancelLabel: "取消",
    })
    if (!title || !title.trim()) return

    try {
      const newAlbum = await Photos.createAlbum(title.trim())
      if (newAlbum) {
        toast(`相簿「${title}」创建成功。`)
        await loadAlbums()
      } else {
        toast("相簿创建失败。")
      }
    } catch (error) {
      console.error(error)
      toast("相簿创建失败，请稍后重试。")
    }
  }

  async function handleRenameAlbum(album: AlbumOption) {
    const newTitle = await Dialog.prompt({
      title: "重命名相簿",
      placeholder: "请输入新的相簿名称",
      defaultValue: album.title,
      confirmLabel: "重命名",
      cancelLabel: "取消",
    })

    if (!newTitle || !newTitle.trim() || newTitle.trim() === album.title) return

    setIsEditingPhoto(true)
    try {
      const newCollection = await Photos.createAlbum(newTitle.trim())
      if (!newCollection) {
        toast("创建新相簿失败。")
        setIsEditingPhoto(false)
        return
      }

      const assets = await album.collection.fetchAssets()
      if (assets.length > 0) {
        await newCollection.addAssets(assets)
      }

      const ok = await Photos.deleteAlbums([album.collection])
      if (ok) {
        toast(`相簿已重命名为「${newTitle}」。`)
        await loadAlbums()
      } else {
        await Photos.deleteAlbums([newCollection])
        toast("已取消重命名。")
      }
    } catch (error) {
      console.error(error)
      toast("重命名失败，请稍后重试。")
    } finally {
      setIsEditingPhoto(false)
    }
  }

  async function handleDeleteAlbum(album: AlbumOption) {
    const confirmed = await Dialog.confirm({
      title: "删除相簿",
      message: `确定要删除相簿「${album.title}」吗？该相簿内的图片不会被删除。`,
      cancelLabel: "取消",
      confirmLabel: "删除",
    })

    if (!confirmed) return

    try {
      const ok = await Photos.deleteAlbums([album.collection])
      if (ok) {
        toast(`相簿「${album.title}」已删除。`)
        await loadAlbums()
      } else {
        toast("删除相簿失败。")
      }
    } catch (error) {
      console.error(error)
      toast("删除相簿失败，请稍后重试。")
    }
  }

  function handleDragChanged(value: any) {
    if (isThrowing || isDeleting || isEditingPhoto || !currentItem) return

    const motion = interactiveMotion({
      x: value.translation.width,
      y: value.translation.height,
    })
    setDragOffset(motion.offset)
    setCardScale(motion.scale)
    setCardOpacity(motion.opacity)
  }

  function handleDragEnded(value: any) {
    if (isThrowing || isDeleting || isEditingPhoto || !currentItem) return

    const xDiff = value.translation.width
    const yDiff = value.translation.height
    const predX = value.predictedEndTranslation.width
    const predY = value.predictedEndTranslation.height

    const isHorizontal = Math.abs(xDiff) > Math.abs(yDiff)

    if (isHorizontal) {
      const shouldHorizontal =
        Math.abs(xDiff) > SWIPE_THRESHOLD ||
        Math.abs(predX) > SWIPE_THRESHOLD * 1.35

      if (shouldHorizontal) {
        if (xDiff < 0) {
          void browseNextPhoto("left")
        } else {
          void goBackToPreviousPhoto()
        }
      } else {
        resetDrag()
      }
    } else {
      const shouldVertical =
        Math.abs(yDiff) > SWIPE_THRESHOLD ||
        Math.abs(predY) > SWIPE_THRESHOLD * 1.35

      if (shouldVertical) {
        if (yDiff < 0) {
          throwCurrentToTrash()
        } else {
          if (showSkippedOnly) {
            void unskipCurrentPhoto("down")
          } else {
            void skipCurrentPhoto("down")
          }
        }
      } else {
        resetDrag()
      }
    }
  }

  function renderTrashLabel() {
    return (
      <HStack spacing={5}>
        <Image
          systemName={pendingDeleteIds.length > 0 ? "trash.fill" : "trash"}
          renderingMode="template"
          foregroundStyle={pendingDeleteIds.length > 0 ? "systemRed" : "systemBlue"}
        />
        {pendingDeleteIds.length > 0 ? (
          <Text font={14} fontWeight="semibold" foregroundStyle="systemRed">
            {pendingDeleteIds.length}
          </Text>
        ) : null}
      </HStack>
    )
  }

  function renderIconButton({
    systemImage,
    action,
    disabled = false,
    foregroundStyle = "systemBlue",
    contextMenu,
    size = 44,
  }: {
    systemImage: string
    action: () => void
    disabled?: boolean
    foregroundStyle?: any
    contextMenu?: any
    size?: number
  }) {
    return (
      <Button
        action={action}
        disabled={disabled}
        buttonStyle="plain"
        frame={{ width: size, height: size }}
        contextMenu={contextMenu}
      >
        <Image
          systemName={systemImage}
          font={22}
          foregroundStyle={disabled ? "tertiaryLabel" : foregroundStyle}
        />
      </Button>
    )
  }

  function renderToolbarActions() {
    return (
      <HStack spacing={8}>
        <Button
          action={() => setShowSkippedOnly(prev => !prev)}
          disabled={isLoading}
          glassEffect
        >
          <HStack spacing={5}>
            <Image
              systemName={showSkippedOnly ? "arrow.right.circle.fill" : "arrow.right.circle"}
              renderingMode="template"
              foregroundStyle={showSkippedOnly ? "systemOrange" : "systemBlue"}
            />
            {skippedCount > 0 ? (
              <Text font={14} fontWeight="semibold" foregroundStyle={showSkippedOnly ? "systemOrange" : "label"}>
                {skippedCount}
              </Text>
            ) : null}
          </HStack>
        </Button>

        <Button action={() => deletePendingPhotos()} disabled={isDeleting} glassEffect>
          {renderTrashLabel()}
        </Button>
      </HStack>
    )
  }

  function renderAlbumMenuItems() {
    const visibleAlbums = targetAlbums.filter(album => !hiddenAlbumIds.includes(album.id))

    return (
      <Group>
        {visibleAlbums.map(album => (
          <Button
            key={album.id}
            title={album.title}
            systemImage="rectangle.stack"
            action={() => void moveCurrentToAlbum(album)}
          />
        ))}

        {visibleAlbums.length === 0 ? (
          <Button
            title="暂无快捷相簿"
            systemImage="folder.badge.minus"
            action={() => toast("请在下方「管理相簿」中启用相簿。")}
          />
        ) : null}

        <Button
          title="管理相簿..."
          systemImage="gearshape"
          action={() => setShowManagementSheet(true)}
        />
      </Group>
    )
  }

  function renderAlbumManagementSheetContent() {
    return (
      <NavigationStack background="systemGroupedBackground">
        <VStack
          spacing={16}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={16}
          background="systemGroupedBackground"
          navigationTitle="管理相簿"
          navigationBarTitleDisplayMode="inline"
          toolbar={
            <Toolbar>
              <ToolbarItem placement="topBarLeading">
                <Button
                  title="新建"
                  systemImage="folder.badge.plus"
                  action={() => void handleCreateAlbum()}
                />
              </ToolbarItem>
              <ToolbarItem placement="topBarTrailing">
                <Button
                  title="完成"
                  action={() => setShowManagementSheet(false)}
                />
              </ToolbarItem>
            </Toolbar>
          }
        >
          {targetAlbums.length === 0 ? (
            <VStack spacing={12} padding={40} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
              <Image systemName="folder" font={32} foregroundStyle="tertiaryLabel" />
              <Text font={14} foregroundStyle="secondaryLabel">
                暂无相簿
              </Text>
            </VStack>
          ) : (
            <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
              <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
                {targetAlbums.map(album => {
                  const isHidden = hiddenAlbumIds.includes(album.id)
                  return (
                    <HStack
                      key={album.id}
                      spacing={12}
                      padding={12}
                      background="secondarySystemGroupedBackground"
                      clipShape={{ type: "rect", cornerRadius: 14 }}
                      frame={{ maxWidth: "infinity" }}
                    >
                      <Image
                        systemName={isHidden ? "eye.slash" : "rectangle.stack"}
                        font={16}
                        foregroundStyle={isHidden ? "secondaryLabel" : "systemBlue"}
                      />
                      
                      <Text font={16} fontWeight="semibold" foregroundStyle={isHidden ? "secondaryLabel" : "label"} lineLimit={1}>
                        {album.title}
                      </Text>
                      
                      <Spacer />
                      
                      <HStack spacing={16}>
                        <Button
                          action={() => toggleAlbumVisibility(album.id)}
                          buttonStyle="plain"
                        >
                          <Image
                            systemName={isHidden ? "eye.slash.fill" : "eye.fill"}
                            font={18}
                            foregroundStyle={isHidden ? "secondaryLabel" : "systemBlue"}
                          />
                        </Button>
                        
                        <Button
                          action={() => void handleRenameAlbum(album)}
                          buttonStyle="plain"
                        >
                          <Image
                            systemName="pencil"
                            font={18}
                            foregroundStyle="systemOrange"
                          />
                        </Button>
                        
                        <Button
                          action={() => void handleDeleteAlbum(album)}
                          buttonStyle="plain"
                        >
                          <Image
                            systemName="trash"
                            font={18}
                            foregroundStyle="systemRed"
                          />
                        </Button>
                      </HStack>
                    </HStack>
                  )
                })}
              </VStack>
            </ScrollView>
          )}
        </VStack>
      </NavigationStack>
    )
  }

  function renderInstructionsSheetContent() {
    return (
      <NavigationStack background="systemGroupedBackground">
        <VStack
          spacing={16}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={16}
          background="systemGroupedBackground"
          navigationTitle="操作说明"
          navigationBarTitleDisplayMode="inline"
          toolbar={
            <Toolbar>
              <ToolbarItem placement="topBarTrailing">
                <Button
                  title="完成"
                  action={() => setShowInstructions(false)}
                />
              </ToolbarItem>
            </Toolbar>
          }
        >
          <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="clear">
            <Markdown content={instructionsMarkdown} theme="basic" background="clear" />
          </ScrollView>
        </VStack>
      </NavigationStack>
    )
  }

  function renderAlbumContextButton() {
    return (
      <Menu
        label={
          <Image
            systemName="rectangle.stack.badge.plus"
            font={22}
            foregroundStyle={!currentItem || isBusy ? "tertiaryLabel" : "systemBlue"}
          />
        }
        buttonStyle="plain"
        frame={{ width: 44, height: 44 }}
        disabled={!currentItem || isBusy}
      >
        {renderAlbumMenuItems()}
      </Menu>
    )
  }

  function renderSourceMenu(title: string, systemImage?: string) {
    return (
      <Menu
        label={
          <Image
            systemName={systemImage ?? "rectangle.stack"}
            font={22}
            foregroundStyle="systemBlue"
          />
        }
        buttonStyle="plain"
        frame={{ width: 44, height: 44 }}
      >
        {renderSourceMenuItems()}
      </Menu>
    )
  }

  function renderSourceMenuItems() {
    const allSelected = selectedSource.kind === "all"
    const screenshotsSelected = selectedSource.kind === "screenshots"

    return (
      <Group>
        <Button
          title={`${allSelected ? "✓ " : ""}全部照片`}
          systemImage="photo.on.rectangle"
          action={() => selectSource(allPhotosSource)}
        />
        <Button
          title={`${screenshotsSelected ? "✓ " : ""}截图`}
          systemImage="camera.viewfinder"
          action={() => selectSource(screenshotsSource)}
        />
        <Menu title="相簿" systemImage="rectangle.stack">
          {albums.length === 0 ? (
            <Button
              title={isLoadingAlbums ? "正在读取相簿" : "没有相簿"}
              systemImage="hourglass"
              action={() => void loadAlbums()}
            />
          ) : albums.map(album => (
            <Button
              key={album.id}
              title={`${selectedSource.albumId === album.id ? "✓ " : ""}${album.title} · ${album.count}`}
              systemImage={album.collection.type === "smartAlbum" ? "sparkles.rectangle.stack" : "rectangle.stack"}
              action={() => selectSource({ kind: "album", albumId: album.id })}
            />
          ))}
        </Menu>
        <Button
          title="刷新相簿"
          systemImage="arrow.clockwise"
          action={() => void loadAlbums()}
        />
      </Group>
    )
  }

  function renderMetric(label: string, value: string, color: any = "secondaryLabel") {
    return (
      <VStack alignment="leading" spacing={2}>
        <Text font={11} foregroundStyle="tertiaryLabel">
          {label}
        </Text>
        <Text font={15} fontWeight="semibold" foregroundStyle={color}>
          {value}
        </Text>
      </VStack>
    )
  }

  function formatDay(timestamp: number): string {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, "0")
    const day = `${date.getDate()}`.padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  function renderDateFilterPanel() {
    return (
      <HStack
        spacing={12}
        frame={{ maxWidth: "infinity", height: 44 }}
        padding={{ vertical: 2 }}
      >
        <DatePicker
          title=""
          value={draftDateStart}
          onChanged={setDraftDateStart}
          displayedComponents={["date"]}
          datePickerStyle="compact"
          frame={{ width: 110, height: 32 }}
        />
        <Image
          systemName="arrow.right"
          imageScale="small"
          foregroundStyle="tertiaryLabel"
        />
        <DatePicker
          title=""
          value={draftDateEnd}
          onChanged={setDraftDateEnd}
          displayedComponents={["date"]}
          datePickerStyle="compact"
          frame={{ width: 110, height: 32 }}
        />
        <Spacer />
        <HStack spacing={16}>
          {renderIconButton({
            systemImage: "xmark.circle",
            action: clearDateFilter,
          })}
          {renderIconButton({
            systemImage: "checkmark.circle",
            action: applyDateFilter,
          })}
        </HStack>
      </HStack>
    )
  }

  function renderPhotoInfo() {
    if (!currentItem || isFinished) return null

    const asset = currentItem.asset
    const subtypeText = asset.mediaSubtypes.includes("photoScreenshot")
      ? "截图"
      : asset.mediaSubtypes.includes("photoLive")
        ? "Live"
        : "照片"

    return (
      <VStack spacing={1} alignment="center">
        <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
          {formatDate(asset.creationDate)}
        </Text>
        <Text font={10} foregroundStyle="tertiaryLabel" lineLimit={1}>
          {asset.pixelWidth}×{asset.pixelHeight}
        </Text>
        <Text font={10} foregroundStyle={asset.isFavorite ? "systemYellow" : "tertiaryLabel"} lineLimit={1}>
          {asset.isFavorite ? "★ 已收藏" : subtypeText}
        </Text>
      </VStack>
    )
  }

  function renderHeader() {
    return (
      <VStack
        alignment="leading"
        spacing={5}
        frame={{ maxWidth: "infinity", height: 96 }}
        padding={{ horizontal: 2, vertical: 2 }}
        contextMenu={{
          menuItems: renderSourceMenuItems(),
        }}
      >
        {showDateFilter ? (
          <VStack frame={{ maxWidth: "infinity", height: 92 }}>
            <Spacer />
            {renderDateFilterPanel()}
            <Spacer />
          </VStack>
        ) : (
          <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <VStack alignment="leading" spacing={3}>
                <Text font={12} foregroundStyle="secondaryLabel">
                  当前范围
                </Text>
                <Text font={18} fontWeight="bold" foregroundStyle="label">
                  {selectedSourceTitle}
                </Text>
              </VStack>
              <Spacer />
              <HStack spacing={16}>
                {renderSourceMenu("", "rectangle.stack")}
                {renderIconButton({
                  systemImage: dateFilterEnabled ? "calendar.badge.clock" : "calendar",
                  action: () => setShowDateFilter(visible => !visible),
                  foregroundStyle: "systemBlue",
                })}
              </HStack>
            </HStack>

            <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
              {renderMetric("进度", progressText, "label")}
              {renderMetric("剩余", `${remainingCount}`)}
              {renderMetric("待删除", `${pendingDeleteIds.length}`, pendingDeleteIds.length > 0 ? "systemRed" : "secondaryLabel")}
              {dateFilterEnabled ? renderMetric("日期", "已筛选", "systemBlue") : null}
            </HStack>
          </VStack>
        )}
        <Spacer />
      </VStack>
    )
  }

  function renderActionBar() {
    return (
      <HStack
        alignment="center"
        frame={{ maxWidth: cardWidth, height: 56 }}
        padding={{ horizontal: 8, bottom: 6 }}
      >
        <HStack spacing={16}>
          {renderIconButton({
            systemImage: currentItem?.asset.isFavorite ? "star.slash" : "star",
            action: () => void toggleFavoriteForCurrent(),
            disabled: !currentItem || isBusy,
            foregroundStyle: currentItem?.asset.isFavorite ? "systemYellow" : "systemBlue",
          })}
          {renderAlbumContextButton()}
        </HStack>

        <Spacer />
        {renderPhotoInfo()}
        <Spacer />

        <HStack spacing={16}>
          {renderIconButton({
            systemImage: "arrow.uturn.backward",
            action: undoLastSwipe,
            disabled: undoStack.length === 0 || isBusy,
          })}
          {renderIconButton({
            systemImage: "arrow.clockwise",
            action: () => void refreshCurrentView(),
            disabled: isBusy,
          })}
        </HStack>
      </HStack>
    )
  }

  return (
    <NavigationStack
      sheet={showInstructions ? {
        isPresented: showInstructions,
        onChanged: setShowInstructions,
        content: renderInstructionsSheetContent()
      } : releaseNotesSheet}
    >
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="systemBackground"
        ignoresSafeArea={{ edges: "bottom" }}
        navigationTitle="整理照片"
        navigationBarTitleDisplayMode="inline"
        sheet={{
          isPresented: showManagementSheet,
          onChanged: setShowManagementSheet,
          content: renderAlbumManagementSheetContent()
        }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <HStack spacing={8}>
                <Button title="" systemImage="xmark" action={dismiss} glassEffect />
                <Button title="" systemImage="info.circle" action={() => setShowInstructions(true)} glassEffect />
              </HStack>
            </ToolbarItem>
            <ToolbarItem placement="principal">
              <Text font={17} fontWeight="semibold" foregroundStyle="label">
                整理照片
              </Text>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              {renderToolbarActions()}
            </ToolbarItem>
          </Toolbar>
        }
        toast={{
          message,
          isPresented: showToast,
          onChanged: setShowToast,
          position: "bottom",
        }}
      >
        <VStack
          spacing={2}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ horizontal: 12, top: 16, bottom: 6 }}
        >
          {renderHeader()}

          <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            {isLoading ? (
              <VStack spacing={12}>
                <ProgressView />
                <Text font={15} foregroundStyle="secondaryLabel">正在载入照片索引</Text>
                <Text font={12} foregroundStyle="tertiaryLabel">只会懒加载当前附近图片</Text>
              </VStack>
            ) : isEmpty ? (
              <VStack spacing={12} padding={28}>
                <Image systemName="photo.on.rectangle.angled" imageScale="large" foregroundStyle="secondaryLabel" />
                <Text font={20} fontWeight="semibold" foregroundStyle="label">
                  没有找到照片
                </Text>
                <Text font={14} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                  当前范围没有可整理的图片，切换到全部照片、截图或其他相簿再试。
                </Text>
              </VStack>
            ) : isFinished ? (
              <VStack spacing={14} padding={28}>
                <Image systemName="checkmark.circle.fill" imageScale="large" foregroundStyle="systemGreen" />
                <Text font={22} fontWeight="bold" foregroundStyle="label">
                  浏览完成
                </Text>
                <Text font={14} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                  已放入垃圾箱 {pendingDeleteIds.length} 张。点击右上角垃圾箱可统一删除。
                </Text>
                {renderIconButton({
                  systemImage: "arrow.clockwise",
                  action: () => void loadPhotos(),
                })}
              </VStack>
            ) : currentItem ? (
              <VStack spacing={12} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                <PhotoCardStack
                  currentItem={currentItem}
                  nextItem={nextItem}
                  dragOffset={dragOffset}
                  cardScale={cardScale}
                  cardOpacity={cardOpacity}
                  onDragChanged={handleDragChanged}
                  onDragEnded={handleDragEnded}
                />
                {renderActionBar()}
                <Spacer />
              </VStack>
            ) : (
              <VStack spacing={12}>
                <ProgressView />
                <Text font={15} foregroundStyle="secondaryLabel">正在准备图片…</Text>
              </VStack>
            )}
          </ZStack>
        </VStack>
      </ZStack>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({
    element: <App />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
