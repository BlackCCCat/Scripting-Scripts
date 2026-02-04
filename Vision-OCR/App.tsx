import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  Navigation,
  NavigationStack,
  VStack,
  HStack,
  ZStack,
  Image,
  Rectangle,
  Text,
  Button,
  Spacer,
  GroupBox,
  Label,
  GeometryReader,
  TextField,
  ProgressView,
  Toggle,
  MagnifyGesture,
  DragGesture,
  TapGesture
} from 'scripting'
import type { Font } from 'scripting'

type RecognizedItem = {
  id: string
  content: string
  confidence: number
  boundingBox: { x: number; y: number; width: number; height: number }
  edited?: string
}

const AUTO_PASTE_KEY = 'vision_ocr_auto_paste_clipboard'

function readStoredBool(key: string, fallback = false): boolean {
  const st: any = (globalThis as any).Storage
  if (!st) return fallback
  const raw =
    typeof st.get === 'function'
      ? st.get(key)
      : typeof st.getString === 'function'
        ? st.getString(key)
        : null
  if (raw == null) return fallback
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') return raw === 'true' || raw === '1'
  return fallback
}

function writeStoredBool(key: string, value: boolean): void {
  const st: any = (globalThis as any).Storage
  if (!st) return
  if (typeof st.set === 'function') st.set(key, value)
  else if (typeof st.setString === 'function') st.setString(key, String(value))
}

function clamp(v: number, a = 0, b = 1) {
  return Math.max(a, Math.min(b, v))
}

function RectOverlay({
  box,
  selected,
  onTap
}: {
  box: { left: number; top: number; width: number; height: number }
  selected: boolean
  onTap: () => void
}) {
  const stroke = selected ? 'rgba(0,122,255,1)' : 'rgba(0,200,0,1)'
  const fill = selected ? 'rgba(0,122,255,0.18)' : 'rgba(0,200,0,0.06)'
  const hitPad = 6
  return (
    <>
      <Rectangle
        // larger invisible hit area for easier tapping
        fill={'rgba(0,0,0,0.001)'}
        frame={{ width: box.width + hitPad * 2, height: box.height + hitPad * 2 }}
        position={{ x: box.left + box.width / 2, y: box.top + box.height / 2 }}
        onTapGesture={() => onTap()}
      />
      <Rectangle
        // a faint green fill so it's visible and hit-testable
        fill={fill}
        stroke={stroke}
        frame={{ width: box.width, height: box.height }}
        position={{ x: box.left + box.width / 2, y: box.top + box.height / 2 }}
        onTapGesture={() => onTap()}
      />
    </>
  )
}

function ToolbarButton(props: {
  title: string
  systemImage?: string
  onPress: () => void
  active?: boolean
  layout?: 'horizontal' | 'vertical'
  font?: number | Font | { name: string; size: number }
  imageScale?: 'small' | 'medium' | 'large'
  background?: boolean
}) {
  const isActive = props.active ?? false
  const foreground = isActive ? 'systemBlue' : undefined
  const layout = props.layout ?? 'horizontal'
  const font = props.font ?? 15
  const imageScale = props.imageScale ?? 'small'
  const hasBackground = props.background ?? true
  const padding = layout === 'vertical'
    ? { top: 10, bottom: 10, left: 12, right: 12 }
    : { top: 6, bottom: 6, left: 10, right: 10 }
  return (
    <Button
      action={props.onPress}
      buttonStyle="plain"
      background={hasBackground ? { style: 'secondarySystemBackground', shape: { type: 'rect', cornerRadius: 10 } } : undefined}
    >
      {layout === 'vertical' ? (
        <VStack spacing={6} padding={padding} alignment="center">
          {props.systemImage ? (
            <Image systemName={props.systemImage} foregroundStyle={foreground} imageScale={imageScale} />
          ) : null}
          <Text font={font} foregroundStyle={foreground}>
            {props.title}
          </Text>
        </VStack>
      ) : (
        <HStack spacing={6} padding={padding}>
          {props.systemImage ? (
            <Image systemName={props.systemImage} foregroundStyle={foreground} imageScale={imageScale} />
          ) : null}
          <Text font={font} foregroundStyle={foreground}>
            {props.title}
          </Text>
        </HStack>
      )}
    </Button>
  )
}

export default function App({ initialImage }: { initialImage?: UIImage | null }) {
  const dismiss = Navigation.useDismiss()

  const [image, setImage] = useState<UIImage | null>(null)
  const [items, setItems] = useState<RecognizedItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [multiSelect, setMultiSelect] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadSeqRef = useRef(0)
  const autoPasteAttemptedRef = useRef(false)
  const [autoPaste, setAutoPaste] = useState(false)

  // zoom / pan state
  const [scale, setScale] = useState(1)
  const [gestureScale, setGestureScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [gestureOffset, setGestureOffset] = useState({ x: 0, y: 0 })

  // toast state
  const [toastShown, setToastShown] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  // touch point for gesture-centered zoom
  const [touchPoint, setTouchPoint] = useState<{ x: number; y: number } | null>(null)
  function showToast(msg: string, duration = 2000) {
    setToastMsg(msg)
    setToastShown(true)
    // ensure it will be hidden after duration
    setTimeout(() => {
      setToastShown(false)
    }, duration)
  }

  // Load image helpers
  const handleUIImage = useCallback(async (img: UIImage | null) => {
    if (!img) return
    const seq = ++loadSeqRef.current

    // Normalize image orientation / representation by rendering into a clean image of same pixel size.
    // This avoids dealing with EXIF orientation or rotated pixel buffers that may cause OCR boxes to be rotated.
    let clean: UIImage = img
    try {
      const rendered = img.renderedIn({ width: img.width, height: img.height })
      if (rendered != null) clean = rendered
    } catch (e) {
      console.warn('normalize image failed', e)
    }

    setImage(clean)
    // reset zoom/pan when loading a new image
    setScale(1)
    setGestureScale(1)
    setOffset({ x: 0, y: 0 })
    setGestureOffset({ x: 0, y: 0 })

    // show gesture hint using toast
    showToast('双指缩放 · 双击重置 · 拖动移动', 3500)

    setItems([])
    setSelectedId(null)
    setSelectedIds([])
    setLoading(true)
    try {
      // Use global Vision (declared in dts) to recognize text on the normalized image
      const result = await (Vision as any).recognizeText(clean, {
        recognitionLevel: 'accurate',
        recognitionLanguages: ['zh-Hans', 'en'],
        usesLanguageCorrection: true,
      })

      const recognized = (result.candidates as any[]).map((c: any, i: number) => ({
        id: i.toString(),
        content: c.content as string,
        confidence: c.confidence as number,
        boundingBox: c.boundingBox as { x: number; y: number; width: number; height: number },
        edited: undefined,
      }))
      if (seq === loadSeqRef.current) {
        setItems(recognized)
      }
    } catch (e) {
      // use global Dialog
      if (seq === loadSeqRef.current) {
        await (Dialog as any).alert({ title: '识别失败', message: String(e) })
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (initialImage) handleUIImage(initialImage)
  }, [initialImage])

  const pickPhoto = useCallback(async () => {
    try {
      const results = await (Photos as any).pick({ limit: 1, filter: (PHPickerFilter as any).images() })
      if (results && results.length > 0) {
        const img = await results[0].uiImage()
        if (img != null) await handleUIImage(img)
      }
    } catch (e) {
      // user canceled or error
      console.warn('pickPhoto error', e)
    }
  }, [handleUIImage])

  const takePhoto = useCallback(async () => {
    try {
      const img = await (Photos as any).takePhoto()
      if (img != null) await handleUIImage(img)
    } catch (e) {
      console.warn('takePhoto error', e)
    }
  }, [handleUIImage])

  const pickFile = useCallback(async () => {
    try {
      const paths = await (DocumentPicker as any).pickFiles({ types: ['public.image'], allowsMultipleSelection: false })
      if (paths && paths.length > 0) {
        const img = UIImage.fromFile(paths[0])
        if (img != null) await handleUIImage(img)
      }
    } catch (e) {
      console.warn('pickFile error', e)
    }
  }, [handleUIImage])

  // Paste image from clipboard and recognize
  const pasteImage = useCallback(async () => {
    try {
      const img = await Pasteboard.getImage()
      if (!img) {
        showToast('剪贴板没有图片')
        return
      }
      await handleUIImage(img)
    } catch (e) {
      console.warn('pasteImage error', e)
      showToast('粘贴失败')
    }
  }, [handleUIImage])

  useEffect(() => {
    const stored = readStoredBool(AUTO_PASTE_KEY, false)
    setAutoPaste(stored)
  }, [])

  useEffect(() => {
    writeStoredBool(AUTO_PASTE_KEY, autoPaste)
  }, [autoPaste])

  useEffect(() => {
    if (!autoPaste || autoPasteAttemptedRef.current) return
    if (initialImage) {
      autoPasteAttemptedRef.current = true
      return
    }
    autoPasteAttemptedRef.current = true
    void pasteImage()
  }, [autoPaste, initialImage, pasteImage])

  // Reset edited text for a single item
  const resetItem = useCallback((id: string) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, edited: undefined } : it)))
  }, [])

  const resetImage = useCallback(() => {
    loadSeqRef.current += 1
    setImage(null)
    setItems([])
    setSelectedId(null)
    setSelectedIds([])
    setMultiSelect(false)
    setLoading(false)
    setScale(1)
    setGestureScale(1)
    setOffset({ x: 0, y: 0 })
    setGestureOffset({ x: 0, y: 0 })
  }, [])

  // Copy current selection text
  const copySelected = useCallback(async () => {
    if (selectedId == null) return
    const it = items.find(x => x.id === selectedId)
    if (!it) return
    await Pasteboard.setString(it.edited ?? it.content)
    showToast('选中文本已复制')
  }, [selectedId, items])

  const copyAll = useCallback(async () => {
    const text = items.map(it => it.edited ?? it.content).join('\n')
    await Pasteboard.setString(text)
    showToast('全部文本已复制')
  }, [items])

  const copySelectedMulti = useCallback(async () => {
    if (selectedIds.length === 0) {
      showToast('未选择任何文本')
      return
    }
    const text = items
      .filter(it => selectedIds.includes(it.id))
      .map(it => it.edited ?? it.content)
      .join('\n')
    await Pasteboard.setString(text)
    showToast(`已复制 ${selectedIds.length} 条`)
  }, [items, selectedIds])

  // Geometry mapping: map image coordinate to display coordinate inside GeometryReader
  const mappedBoxes = useMemo(() => {
    if (!image) return [] as { id: string; left: number; top: number; width: number; height: number }[]
    return items.map(it => ({ id: it.id, left: it.boundingBox.x, top: it.boundingBox.y, width: it.boundingBox.width, height: it.boundingBox.height }))
  }, [image, items])

  // Editor state
  const selectedItem = items.find(i => i.id === selectedId) ?? null
  const [editorValue, setEditorValue] = useState<string>('')
  useEffect(() => {
    setEditorValue(selectedItem ? (selectedItem.edited ?? selectedItem.content) : '')
  }, [selectedItem])

  const selectItem = useCallback((id: string) => {
    if (multiSelect) {
      setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
      return
    }
    if (id === selectedId) return
    if (selectedId) {
      // auto-commit current edit before switching
      setItems(prev => prev.map(it => (it.id === selectedId ? { ...it, edited: editorValue } : it)))
    }
    setSelectedId(id)
  }, [selectedId, editorValue, multiSelect])

  const toggleMultiSelect = useCallback(() => {
    if (!multiSelect) {
      if (selectedId) {
        setItems(prev => prev.map(it => (it.id === selectedId ? { ...it, edited: editorValue } : it)))
      }
      setSelectedIds(selectedId ? [selectedId] : [])
      setSelectedId(null)
      setMultiSelect(true)
      return
    }
    setSelectedId(selectedIds[0] ?? null)
    setSelectedIds([])
    setMultiSelect(false)
  }, [multiSelect, selectedId, selectedIds])

  // Apply edit
  const applyEdit = useCallback(() => {
    if (!selectedId) return
    setItems(prev => prev.map(it => (it.id === selectedId ? { ...it, edited: editorValue } : it)))
  }, [editorValue, selectedId])

  // Helper to compute display transforms inside GeometryReader
  function computeTransforms(containerW: number, containerH: number) {
    if (!image) return { imgW: 0, imgH: 0, dispW: 0, dispH: 0, offsetX: 0, offsetY: 0, scale: 1 }
    const imgW = image.width
    const imgH = image.height
    const scale = Math.min(containerW / imgW, containerH / imgH)
    const dispW = imgW * scale
    const dispH = imgH * scale
    const offsetX = (containerW - dispW) / 2
    const offsetY = (containerH - dispH) / 2
    return { imgW, imgH, dispW, dispH, offsetX, offsetY, scale }
  }

  // Convert a recognized bounding box (which might be normalized or pixel coords) to displayed box
  // NOTE: coordinates use Y axis reversed (origin at bottom-left), so we flip Y directly.
  function boxToDisplay(box: { x: number; y: number; width: number; height: number }, transforms: { dispW: number; dispH: number; imgW: number; imgH: number; offsetX: number; offsetY: number; scale: number }) {
    const { dispW, dispH, imgW, imgH, offsetX, offsetY, scale } = transforms

    // If values are in [0,1], treat them as normalized
    const isNormalized = box.x <= 1 && box.y <= 1 && box.width <= 1 && box.height <= 1

    // X is left-origin; Y in incoming data is measured from bottom -> flip it
    const left = (isNormalized ? box.x * imgW : box.x) * scale + offsetX
    const top = (isNormalized ? (1 - box.y - box.height) * imgH : (imgH - (box.y + box.height))) * scale + offsetY
    const width = (isNormalized ? box.width * imgW : box.width) * scale
    const height = (isNormalized ? box.height * imgH : box.height) * scale

    return { left, top, width, height }
  }

  const multiSelectText = useMemo(() => {
    if (!image || selectedIds.length === 0) return ''
    const imgW = image.width
    const imgH = image.height
    const selected = items
      .filter(it => selectedIds.includes(it.id))
      .map(it => {
        const box = it.boundingBox
        const isNormalized = box.x <= 1 && box.y <= 1 && box.width <= 1 && box.height <= 1
        const left = isNormalized ? box.x * imgW : box.x
        const top = isNormalized ? (1 - box.y - box.height) * imgH : (imgH - (box.y + box.height))
        const width = isNormalized ? box.width * imgW : box.width
        const height = isNormalized ? box.height * imgH : box.height
        const text = (it.edited ?? it.content).trim()
        return { text, left, top, width, height, centerY: top + height / 2 }
      })
      .filter(it => it.text.length > 0)

    if (selected.length === 0) return ''

    const heights = selected
      .map(it => it.height)
      .filter(h => h > 0)
      .sort((a, b) => a - b)
    const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 0
    const lineThreshold = medianHeight > 0 ? medianHeight * 0.6 : 12

    const sorted = [...selected].sort((a, b) => {
      if (a.centerY === b.centerY) return a.left - b.left
      return a.centerY - b.centerY
    })

    const lines: { centerY: number; items: typeof selected }[] = []
    for (const item of sorted) {
      const last = lines[lines.length - 1]
      if (!last || Math.abs(item.centerY - last.centerY) > lineThreshold) {
        lines.push({ centerY: item.centerY, items: [item] })
      } else {
        last.items.push(item)
        last.centerY = (last.centerY * (last.items.length - 1) + item.centerY) / last.items.length
      }
    }

    return lines
      .map(line => line.items.sort((a, b) => a.left - b.left).map(it => it.text).join(' '))
      .join('\n')
  }, [items, selectedIds, image])

  return (
    <NavigationStack>
      <ZStack>
        <VStack spacing={8} padding toast={{ message: toastMsg, isPresented: toastShown, onChanged: (v: boolean) => setToastShown(v), duration: 2, position: 'bottom' }}>
          <HStack spacing={8} alignment="center">
            <Button title="" systemImage="xmark" buttonStyle="plain" action={() => dismiss()} />
            <Text font="headline">Vision OCR</Text>
            <Spacer />
            {loading ? <ProgressView value={0.5} /> : null}
          </HStack>

        {!image ? (
          <VStack frame={{ maxWidth: 'infinity', maxHeight: 'infinity' }} alignment="center">
            <Spacer />
            <VStack spacing={10} alignment="center">
              <ToolbarButton title="相册" systemImage="photo" onPress={pickPhoto} layout="vertical" font={16} imageScale="medium" background={false} />
              <ToolbarButton title="文件" systemImage="doc" onPress={pickFile} layout="vertical" font={16} imageScale="medium" background={false} />
              <ToolbarButton title="拍照" systemImage="camera" onPress={takePhoto} layout="vertical" font={16} imageScale="medium" background={false} />
              <ToolbarButton title="粘贴" systemImage="doc.on.clipboard" onPress={pasteImage} layout="vertical" font={16} imageScale="medium" background={false} />
              <Toggle
                title="自动读取剪贴板"
                value={autoPaste}
                onChanged={(v: boolean) => setAutoPaste(v)}
                toggleStyle="switch"
              />
            </VStack>
            <Spacer />
          </VStack>
        ) : null}

        {image ? (
          <GroupBox label={<Label title="操作" systemImage="slider.horizontal.3" />}>
            <HStack spacing={8}>
              <ToolbarButton title="重置图片" systemImage="xmark.bin" onPress={resetImage} />
              <ToolbarButton
                title={multiSelect ? '合并复制' : '复制全部'}
                systemImage="doc.on.doc"
                onPress={multiSelect ? copySelectedMulti : copyAll}
              />
              <ToolbarButton
                title="多选"
                systemImage={multiSelect ? 'checkmark.circle.fill' : 'checkmark.circle'}
                onPress={toggleMultiSelect}
                active={multiSelect}
              />
              {selectedItem ? <ToolbarButton title="取消选择" systemImage="xmark.circle" onPress={() => setSelectedId(null)} /> : null}
            </HStack>
          </GroupBox>
        ) : null}

        {image ? (
          <GroupBox label={<></>}>
            <GeometryReader>
              {({ size }: any) => {
                const transforms = computeTransforms(size.width, size.height)
                // Use the original image for display to ensure coordinate system & orientation match the OCR results.
                // preparingThumbnail may change orientation/scale rounding and lead to mis-aligned boxes.
                const displayImage = image

              // compute current interactive scale & offset
              const effectiveScale = scale * gestureScale
              const effectiveOffset = { x: offset.x + gestureOffset.x, y: offset.y + gestureOffset.y }

              // compute some bounds for panning when zoomed
              const effectiveScaleRef = scale * gestureScale
              const effectiveDispW = transforms.dispW * effectiveScaleRef
              const effectiveDispH = transforms.dispH * effectiveScaleRef
              const maxPanX = Math.max(0, (effectiveDispW - size.width) / 2)
              const maxPanY = Math.max(0, (effectiveDispH - size.height) / 2)

              const dragG = DragGesture({ minDistance: 10, coordinateSpace: 'local' })
                .onChanged((g) => {
                  // compute desired offset and clamp live so the image never drifts offscreen
                  const desiredX = offset.x + g.translation.width
                  const desiredY = offset.y + g.translation.height
                  const clampedX = clamp(desiredX, -maxPanX, maxPanX)
                  const clampedY = clamp(desiredY, -maxPanY, maxPanY)
                  // set gestureOffset as delta from base offset
                  setGestureOffset({ x: clampedX - offset.x, y: clampedY - offset.y })
                  setTouchPoint({ x: g.location.x, y: g.location.y })
                })
                .onEnded((g) => {
                  // already clamped during change, so commit
                  const finalX = offset.x + g.translation.width
                  const finalY = offset.y + g.translation.height
                  const clampedX = clamp(finalX, -maxPanX, maxPanX)
                  const clampedY = clamp(finalY, -maxPanY, maxPanY)
                  setOffset({ x: clampedX, y: clampedY })
                  setGestureOffset({ x: 0, y: 0 })
                })

              // double-tap handled via onTapGesture (so we get consistent touch sequence);
              // implementation moved to onTapGesture below (uses same anchor math)

                return (
                  <ZStack
                  frame={{ width: size.width, height: size.height }}
                  scaleEffect={effectiveScaleRef}
                  offset={{ x: offset.x + gestureOffset.x, y: offset.y + gestureOffset.y }}
                  gesture={
                    MagnifyGesture()
                      .onChanged((v) => {
                        // set live magnification and touch anchor
                        const sOld = scale
                        const sLive = clamp(sOld * v.magnification, 1, 6)
                        setGestureScale(v.magnification)
                        // compute anchor-preserving offset during pinch
                        const p = { x: v.startLocation.x, y: v.startLocation.y }
                        setTouchPoint(p)
                        const center = { x: size.width / 2, y: size.height / 2 }
                        // offsetLive = offset + (1 - sLive/sOld) * (p - center - offset)
                        const ratio = sOld > 0 ? (1 - sLive / sOld) : 0
                        const offsetLiveX = offset.x + ratio * (p.x - center.x - offset.x)
                        const offsetLiveY = offset.y + ratio * (p.y - center.y - offset.y)
                        // clamp live offset
                        const liveMaxPanX = Math.max(0, (transforms.dispW * sLive - size.width) / 2)
                        const liveMaxPanY = Math.max(0, (transforms.dispH * sLive - size.height) / 2)
                        const clampedLiveX = clamp(offsetLiveX, -liveMaxPanX, liveMaxPanX)
                        const clampedLiveY = clamp(offsetLiveY, -liveMaxPanY, liveMaxPanY)
                        setGestureOffset({ x: clampedLiveX - offset.x, y: clampedLiveY - offset.y })
                        setToastShown(false)
                      })
                      .onEnded((v) => {
                        const sOld = scale
                        const sNew = clamp(sOld * v.magnification, 1, 6)
                        const p = { x: v.startLocation.x, y: v.startLocation.y }
                        const center = { x: size.width / 2, y: size.height / 2 }
                        const ratio = sOld > 0 ? (1 - sNew / sOld) : 0
                        const newOffsetX = offset.x + ratio * (p.x - center.x - offset.x)
                        const newOffsetY = offset.y + ratio * (p.y - center.y - offset.y)
                        const newMaxPanX = Math.max(0, (transforms.dispW * sNew - size.width) / 2)
                        const newMaxPanY = Math.max(0, (transforms.dispH * sNew - size.height) / 2)
                        const clampedX = clamp(newOffsetX, -newMaxPanX, newMaxPanX)
                        const clampedY = clamp(newOffsetY, -newMaxPanY, newMaxPanY)
                        setScale(sNew)
                        setGestureScale(1)
                        setOffset({ x: clampedX, y: clampedY })
                        setGestureOffset({ x: 0, y: 0 })
                      })
                  }
                  simultaneousGesture={dragG}
                  highPriorityGesture={
                    TapGesture(2).onEnded(() => {
                      const p = touchPoint ?? { x: size.width / 2, y: size.height / 2 }
                      const sCur = scale
                      const sNew = sCur > 1.05 ? 1 : 2
                      const center = { x: size.width / 2, y: size.height / 2 }
                      const ratio = sCur > 0 ? (1 - sNew / sCur) : 0
                      const newOffsetX = offset.x + ratio * (p.x - center.x - offset.x)
                      const newOffsetY = offset.y + ratio * (p.y - center.y - offset.y)
                      const newMaxPanX = Math.max(0, (transforms.dispW * sNew - size.width) / 2)
                      const newMaxPanY = Math.max(0, (transforms.dispH * sNew - size.height) / 2)
                      const clampedX = clamp(newOffsetX, -newMaxPanX, newMaxPanX)
                      const clampedY = clamp(newOffsetY, -newMaxPanY, newMaxPanY)
                      setScale(sNew)
                      setGestureScale(1)
                      setOffset({ x: clampedX, y: clampedY })
                      setGestureOffset({ x: 0, y: 0 })
                    })
                  }
                  onTapGesture={{ count: 2, coordinateSpace: 'local', perform: () => {
                    // fallback double-tap perform (in case highPriority doesn't fire)
                    const p = touchPoint ?? { x: size.width / 2, y: size.height / 2 }
                    const sCur = scale
                    const sNew = sCur > 1.05 ? 1 : 2
                    const center = { x: size.width / 2, y: size.height / 2 }
                    const ratio = sCur > 0 ? (1 - sNew / sCur) : 0
                    const newOffsetX = offset.x + ratio * (p.x - center.x - offset.x)
                    const newOffsetY = offset.y + ratio * (p.y - center.y - offset.y)
                    const newMaxPanX = Math.max(0, (transforms.dispW * sNew - size.width) / 2)
                    const newMaxPanY = Math.max(0, (transforms.dispH * sNew - size.height) / 2)
                    const clampedX = clamp(newOffsetX, -newMaxPanX, newMaxPanX)
                    const clampedY = clamp(newOffsetY, -newMaxPanY, newMaxPanY)
                    setScale(sNew)
                    setGestureScale(1)
                    setOffset({ x: clampedX, y: clampedY })
                    setGestureOffset({ x: 0, y: 0 })
                  } }}
                >
                  {displayImage ? (
                    <Image
                      image={displayImage}
                      resizable={true}
                      frame={{ width: transforms.dispW, height: transforms.dispH }}
                      position={{ x: transforms.offsetX + transforms.dispW / 2, y: transforms.offsetY + transforms.dispH / 2 }}
                      gesture={
                        DragGesture({ minDistance: 0, coordinateSpace: 'local' })
                          .onChanged((g) => setTouchPoint({ x: g.location.x, y: g.location.y }))
                      }
                    />
                  ) : (
                    <ZStack frame={{ width: size.width, height: size.height }}>
                      <Rectangle fill={'rgba(0,0,0,0.02)'} stroke={'separator'} frame={{ width: size.width, height: size.height }} />
                      <Text font="subheadline">未选择图片</Text>
                    </ZStack>
                  )}

                    {/* overlays */}
                    {image && items.map((it) => {
                      const disp = boxToDisplay(it.boundingBox, transforms)
                      return (
                        <RectOverlay
                          key={it.id}
                          box={disp}
                          selected={multiSelect ? selectedIds.includes(it.id) : selectedId === it.id}
                          onTap={() => selectItem(it.id)}
                        />
                      )
                    })}
                  </ZStack>
                )
              }}</GeometryReader>
          </GroupBox>
        ) : null}

        {image && multiSelect && selectedIds.length > 0 ? (
          <GroupBox label={<Label title="多选结果" systemImage="checkmark.circle" />}>
            <Text frame={{ maxWidth: 'infinity' }}>{multiSelectText}</Text>
          </GroupBox>
        ) : null}

          {/* selected editor */}
          {selectedItem ? (
            <GroupBox label={<Label title={`#${parseInt(selectedItem.id) + 1}`} systemImage="pencil" />}>
              <VStack spacing={8}>
                {/* <Text font="footnote">识别结果：{selectedItem.content}</Text> */}
                <TextField title="编辑" value={editorValue} onChanged={setEditorValue} prompt="编辑文本" />
                <HStack spacing={8}>
                  <Button title="应用" action={() => { applyEdit(); showToast('更改已保存') }} />
                  <Button title="重置" action={() => { resetItem(selectedItem.id); setEditorValue(selectedItem.content) }} />
                  <Button title="复制" action={copySelected} />
                  <Spacer />
                  <Button title="关闭" action={() => setSelectedId(null)} />
                </HStack>
              </VStack>
            </GroupBox>
          ) : null}

        </VStack>

      </ZStack>
    </NavigationStack>
  )
}
