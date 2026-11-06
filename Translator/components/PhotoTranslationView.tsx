import {
  Button, CaptureVideoPreviewView, GeometryReader, HStack, Image, MagnifyGesture, Menu,
  Navigation, NavigationStack, ProgressView, Rectangle, Script, Spacer, Text, VStack, ZStack,
  useEffect, useEffectEvent, useRef, useState,
} from "scripting"
import type { CameraControlParameter } from "scripting"
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type { TranslatorEngineEntry } from "../types"
import { isLiveEngineAvailable } from "../utils/live_translation"
import { preparePhotoImage, recognizePhotoText } from "../utils/photo_orientation"
import { translatePhoto, type PhotoTextBlock, type PhotoTranslation } from "../utils/photo_translation"
import { getExecutableEngines, loadTranslatorSettings } from "../utils/translator_settings"
import { EngineIcon } from "./EngineIcon"

type Camera = { session: AVCaptureSession; device: AVCaptureDevice; photo: AVCapturePhotoOutput }
const SELECT_TEXT_MESSAGE = "点击文字区域选择内容，确认后翻译。"

function PhotoOverlay({ image, blocks, selecting, selected, onSelect, onTap }: {
  image: UIImage
  blocks: PhotoTextBlock[]
  selecting: boolean
  selected: number[]
  onSelect: (index: number) => void
  onTap: () => void
}) {
  return (
    <GeometryReader frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={{ regions: "container", edges: "all" }}>
      {(proxy) => {
        const scale = Math.min(proxy.size.width / image.width, proxy.size.height / image.height)
        const width = image.width * scale
        const displayHeight = image.height * scale
        const left = (proxy.size.width - width) / 2
        const top = (proxy.size.height - displayHeight) / 2
        return (
          <ZStack frame={{ width: proxy.size.width, height: proxy.size.height }}
            contentShape="rect" clipped onTapGesture={onTap}>
            <Image image={image} resizable
              frame={{ width, height: displayHeight }}
              position={{ x: proxy.size.width / 2, y: proxy.size.height / 2 }} />
            {selecting ? blocks.map((block, index) => {
              const box = block.box
              const boxWidth = Math.max(28, box.width * width)
              const boxHeight = Math.max(24, box.height * displayHeight)
              const centerX = left + (box.x + box.width / 2) * width
              const centerY = top + (1 - box.y - box.height / 2) * displayHeight
              const isSelected = selected.includes(index)
              return <Rectangle key={index}
                fill={isSelected ? "rgba(0,122,255,0.24)" : "rgba(0,122,255,0.08)"}
                stroke={isSelected ? "accentColor" : "white"}
                frame={{ width: boxWidth, height: boxHeight }}
                position={{ x: centerX, y: centerY }}
                accessibilityLabel={`${isSelected ? "已选中" : "选择"}：${block.text}`}
                onTapGesture={() => onSelect(index)} />
            }) : null}
            {blocks.map((block, index) => {
              if (!block.translatedText.trim()) return null
              const box = block.box
              const boxWidth = Math.min(width, Math.max(48, box.width * width))
              const boxHeight = Math.max(22, box.height * displayHeight)
              const fontSize = Math.max(7, Math.min(16, Math.sqrt(boxWidth * boxHeight / Math.max(1, block.translatedText.length) / 1.2)))
              const centerX = Math.max(left + boxWidth / 2, Math.min(left + width - boxWidth / 2, left + (box.x + box.width / 2) * width))
              const centerY = top + (1 - box.y - box.height / 2) * displayHeight
              return (
                <Text
                  key={index}
                  font={fontSize}
                  foregroundStyle="label"
                  background="systemBackground"
                  padding={2}
                  lineLimit={Math.max(1, Math.floor(boxHeight / (fontSize * 1.2)))}
                  multilineTextAlignment="center"
                  frame={{ width: boxWidth, height: boxHeight, alignment: "center" }}
                  position={{ x: centerX, y: centerY }}
                >
                  {block.translatedText}
                </Text>
              )
            })}
          </ZStack>
        )
      }}
    </GeometryReader>
  )
}

export function PhotoTranslationView({ initialBatch = null, startInCamera = false, active = true, onClose }: {
  initialBatch?: CameraControlParameter | null
  startInCamera?: boolean
  active?: boolean
  onClose?: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const settings = loadTranslatorSettings()
  const engines = getExecutableEngines(settings).filter(isLiveEngineAvailable)
  const [engineId, setEngineId] = useState(engines[0]?.id ?? "")
  const engine = engines.find((entry) => entry.id === engineId) ?? engines[0]
  const [sourceCode, setSourceCode] = useState(settings.defaultSourceLanguageCode)
  const [targetCode, setTargetCode] = useState(
    settings.defaultTargetLanguageCode === "zh-Hans" ? "auto" : settings.defaultTargetLanguageCode
  )
  const [camera, setCamera] = useState<Camera | null>(null)
  const [image, setImage] = useState<UIImage | null>(null)
  const [result, setResult] = useState<PhotoTranslation | null>(null)
  const [recognizedBlocks, setRecognizedBlocks] = useState<PhotoTextBlock[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [previewBlocks, setPreviewBlocks] = useState<PhotoTextBlock[]>([])
  const [controlsVisible, setControlsVisible] = useState(true)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [translationHost] = useState(() => new Translation())
  const cameraRef = useRef<Camera | null>(null)
  const pinchStartZoomRef = useRef<number | null>(null)
  const stoppingRef = useRef<Promise<void>>(Promise.resolve())
  const revisionRef = useRef(0)
  const workingRef = useRef(false)
  const seenCaptureIds = useRef(new Set<string>())
  const aliveRef = useRef(true)
  const activeRef = useRef(active)
  const forcedOrientationRef = useRef<"portrait" | "landscape" | null>(null)
  const previewAspectRef = useRef(Device.screen.width / Device.screen.height)
  activeRef.current = active
  const useGlass = Number.parseInt(Device.systemVersion, 10) >= 26
  const languageWidth = Math.max(110, Math.floor((Device.screen.width - 84) / 2))
  const compactControls = Math.min(Device.screen.width, Device.screen.height) < 360
  const sideWidth = compactControls ? 96 : 116
  const sideButtonSize = compactControls ? 44 : 56

  function setPageOrientation(target: "portrait" | "landscape") {
    if (!Device.isiPhone) return
    Device.supportedInterfaceOrientations = [target]
    forcedOrientationRef.current = target
  }

  useEffect(() => {
    if (!active || !Device.isiPhone) return
    const previous = Device.supportedInterfaceOrientations
    Device.supportedInterfaceOrientations = ["all"]
    const onOrientation = (orientation: Device.Orientation) => {
      const target = forcedOrientationRef.current
      const matches = target === "landscape"
        ? orientation === "landscapeLeft" || orientation === "landscapeRight"
        : orientation === "portrait"
      if (!target || !matches) return
      forcedOrientationRef.current = null
      Device.supportedInterfaceOrientations = ["all"]
    }
    Device.addOrientationListener(onOrientation)
    if (Device.isLandscape) setPageOrientation("landscape")
    return () => {
      Device.removeOrientationListener(onOrientation)
      forcedOrientationRef.current = null
      if (!onClose) Device.supportedInterfaceOrientations = previous
    }
  }, [active])

  async function stopCamera() {
    const current = cameraRef.current
    cameraRef.current = null
    pinchStartZoomRef.current = null
    const previous = stoppingRef.current
    const stopping = current
      ? current.session.stopRunning().finally(() => current.session.dispose())
      : Promise.resolve()
    stoppingRef.current = Promise.all([previous, stopping]).then(() => {}, () => {})
    await stoppingRef.current
    if (aliveRef.current) setCamera(null)
  }

  async function startCamera() {
    if (workingRef.current || cameraRef.current?.session.isRunning) return
    workingRef.current = true
    setBusy(true)
    setMessage("正在打开相机…")
    const revision = ++revisionRef.current
    try {
      await stopCamera()
      const device = AVCaptureDevice.default("video")
      if (!device) throw new Error("当前设备没有可用相机，可从相册导入图片。")
      const session = new AVCaptureSession()
      const photo = new AVCapturePhotoOutput()
      const input = new AVCaptureDeviceInput(device)
      cameraRef.current = { session, device, photo }
      session.configure(() => {
        session.sessionPreset = "photo"
        if (!session.canAddInput(input) || !session.canAddOutput(photo)) throw new Error("无法配置相机。")
        session.addInput(input)
        session.addOutput(photo)
      })
      await session.startRunning()
      if (!aliveRef.current || revision !== revisionRef.current) {
        await stopCamera()
        return
      }
      setImage(null)
      setResult(null)
      setRecognizedBlocks([])
      setSelectedIds([])
      setPreviewBlocks([])
      setCamera(cameraRef.current)
      setMessage("")
    } catch (error) {
      await stopCamera()
      if (aliveRef.current && revision === revisionRef.current) setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      workingRef.current = false
      if (aliveRef.current) setBusy(false)
    }
  }

  async function recognizeImage(
    nextImage: UIImage,
    captureOrientation?: Device.Orientation,
    previewAspect?: number,
    fromCamera = false,
    outputRotation?: number
  ) {
    const revision = ++revisionRef.current
    if (!fromCamera) setImage(nextImage)
    setResult(null)
    setRecognizedBlocks([])
    setSelectedIds([])
    setPreviewBlocks([])
    setControlsVisible(true)
    setBusy(true)
    setMessage("正在识别图片文字…")
    try {
      if (!fromCamera) await stopCamera()
      if (!aliveRef.current || revision !== revisionRef.current) return
      const recognition = await recognizePhotoText(nextImage, {
        orientation: captureOrientation,
        previewAspect,
        outputRotation,
        isCurrent: () => aliveRef.current && revision === revisionRef.current,
      })
      if (!aliveRef.current || revision !== revisionRef.current) return
      const blocks = recognition.result.candidates
        .filter((item) => item.content.trim() && item.boundingBox.width > 0 && item.boundingBox.height > 0)
        .map((item) => ({ text: item.content.trim(), translatedText: "", box: item.boundingBox }))
      if (!blocks.length) throw new Error("没有识别到可选择的文字，请重新拍照或导入图片。")
      setImage(recognition.image)
      setRecognizedBlocks(blocks)
      setMessage(SELECT_TEXT_MESSAGE)
      if (fromCamera) await stopCamera()
    } catch (error) {
      if (aliveRef.current && revision === revisionRef.current)
        setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      if (aliveRef.current && revision === revisionRef.current) setBusy(false)
    }
  }

  async function processImage(nextImage: UIImage, options: {
    engine?: TranslatorEngineEntry
    sourceCode?: string
    targetCode?: string
    recognized: Pick<PhotoTranslation, "blocks">
  }) {
    const revision = ++revisionRef.current
    setBusy(true)
    setControlsVisible(true)
    setResult(null)
    setPreviewBlocks(options.recognized.blocks.map((block) => ({ ...block, translatedText: "" })))
    setImage(nextImage)
    try {
      await stopCamera()
      const selectedEngine = options.engine ?? engine
      if (!selectedEngine) throw new Error("请先在设置中启用翻译引擎。")
      const translated = await translatePhoto({
        engine: selectedEngine,
        sourceLanguageCode: options.sourceCode ?? sourceCode,
        targetLanguageCode: options.targetCode ?? targetCode,
        recognized: options.recognized,
        translationHost, isCurrent: () => aliveRef.current && revision === revisionRef.current,
        onProgress: (text) => { if (aliveRef.current && revision === revisionRef.current) setMessage(text) },
        onBlock: (index, translatedText) => {
          if (aliveRef.current && revision === revisionRef.current) {
            setPreviewBlocks((current) => current[index]?.translatedText === translatedText
              ? current
              : current.map((block, blockIndex) =>
                blockIndex === index ? { ...block, translatedText } : block
              ))
          }
        },
      })
      if (aliveRef.current && revision === revisionRef.current) {
        setResult(translated)
        setMessage("")
        setControlsVisible(false)
      }
    } catch (error) {
      if (aliveRef.current && revision === revisionRef.current) setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      if (aliveRef.current && revision === revisionRef.current) setBusy(false)
    }
  }

  function confirmSelection() {
    if (!image || !selectedIds.length || busy) return
    const blocks = recognizedBlocks.filter((_, index) => selectedIds.includes(index))
    void processImage(image, { recognized: { blocks } })
  }

  async function capture() {
    const current = cameraRef.current
    if (!current || workingRef.current) return
    workingRef.current = true
    setBusy(true)
    let started = false
    try {
      const captureOrientation = Device.orientation
      const photo = await current.photo.capturePhoto({ codec: "jpeg" })
      if (aliveRef.current) {
        const prepared = preparePhotoImage(photo.image)
        started = true
        void recognizeImage(prepared, captureOrientation, previewAspectRef.current, true,
          current.photo.connections[0]?.videoRotationAngle)
      }
    } catch (error) {
      if (aliveRef.current) setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      workingRef.current = false
      if (aliveRef.current && !started) setBusy(false)
    }
  }

  async function pickImage() {
    if (busy) return
    setBusy(true)
    let started = false
    try {
      const picked = await Photos.pick({ filter: PHPickerFilter.images(), limit: 1 })
      if (!picked.length) return
      const selected = await picked[0].uiImage()
      if (!selected) throw new Error("无法读取所选图片。")
      const prepared = preparePhotoImage(selected)
      started = true
      void recognizeImage(prepared)
    } catch (error) {
      if (aliveRef.current) setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      if (aliveRef.current && !started) setBusy(false)
    }
  }

  const receiveBatch = useEffectEvent((batch: CameraControlParameter | null) => {
    if (!batch || seenCaptureIds.current.has(batch.captureId)) return
    const photo = batch.assets.find((asset) => asset.type === "photo")
    if (!photo) { setMessage("本次拍摄没有照片。"); return }
    try {
      const decoded = UIImage.fromFile(photo.filePath)
      if (!decoded) throw new Error("无法读取相机交付的照片。")
      const prepared = preparePhotoImage(decoded)
      seenCaptureIds.current.add(batch.captureId)
      void recognizeImage(prepared, Device.orientation, previewAspectRef.current)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  })

  useEffect(() => {
    aliveRef.current = true
    if (initialBatch) receiveBatch(initialBatch)
    const unsubscribe = Script.onResume((event) => {
      if (!activeRef.current) return
      if (event.cameraControlParameter) receiveBatch(event.cameraControlParameter)
      else if (Script.env === "camera_control" && !cameraRef.current) void startCamera()
    })
    return () => {
      aliveRef.current = false
      revisionRef.current += 1
      unsubscribe()
      void stopCamera()
    }
  }, [])

  useEffect(() => {
    if (!active) {
      revisionRef.current += 1
      void stopCamera()
      return
    }
    if (startInCamera && !initialBatch) {
      setImage(null)
      setResult(null)
      setRecognizedBlocks([])
      setSelectedIds([])
      setPreviewBlocks([])
      setControlsVisible(true)
      void startCamera()
    }
  }, [active])

  async function close() {
    revisionRef.current += 1
    setBusy(true)
    setPageOrientation("portrait")
    await stopCamera()
    if (onClose) onClose()
    else dismiss()
  }

  function changeSource(code: string) {
    if (code === sourceCode) return
    setSourceCode(code)
    if (image && result) void processImage(image, { sourceCode: code, recognized: result })
  }

  function changeTarget(code: string) {
    if (code === targetCode) return
    setTargetCode(code)
    if (image && result) void processImage(image, { targetCode: code, recognized: result })
  }

  function changeEngine(nextEngine: TranslatorEngineEntry) {
    if (nextEngine.id === engine?.id) return
    setEngineId(nextEngine.id)
    if (image && result) void processImage(image, { engine: nextEngine, recognized: result })
  }

  const viewingCamera = !!camera && !image
  const showingCaptureSurface = !image && (viewingCamera || (active && startInCamera))
  const sourcePicker = (width: number) => <Menu
    buttonStyle={useGlass ? "glass" : "bordered"}
    frame={{ width }}
    disabled={busy}
    label={<Text lineLimit={1} truncationMode="tail">
      {sourceCode === "auto" ? AUTO_LANGUAGE.label : LANGUAGE_OPTIONS.find((item) => item.code === sourceCode)?.label ?? sourceCode}
    </Text>}
  >
    {[AUTO_LANGUAGE, ...LANGUAGE_OPTIONS].map((option) => (
      <Button key={option.code} title={`${option.label}-${option.promptName}`} action={() => changeSource(option.code)} />
    ))}
  </Menu>
  const targetPicker = (width: number) => <Menu
    buttonStyle={useGlass ? "glass" : "bordered"}
    frame={{ width }}
    disabled={busy}
    label={<Text lineLimit={1} truncationMode="tail">
      {targetCode === "auto" ? "自动切换" : LANGUAGE_OPTIONS.find((item) => item.code === targetCode)?.label ?? targetCode}
    </Text>}
  >
    <Button title="自动切换（中文 ↔ 英语）" action={() => changeTarget("auto")} />
    {LANGUAGE_OPTIONS.map((option) => (
      <Button key={option.code} title={`${option.label}-${option.promptName}`} action={() => changeTarget(option.code)} />
    ))}
  </Menu>
  const enginePicker = (width?: number) => <Menu
    buttonStyle={useGlass ? "glass" : "bordered"}
    frame={width == null ? { maxWidth: "infinity" } : { width }}
    disabled={busy}
    label={<HStack spacing={8}>
      {engine ? <EngineIcon kind={engine.kind} mode={engine.config?.compatibilityMode} size={20} /> : null}
      <Text lineLimit={1} truncationMode="tail">{engine?.label ?? "没有可用的翻译引擎"}</Text>
      <Image systemName="chevron.up.chevron.down" font="caption2" />
    </HStack>}
  >
    {engines.map((item) => (
      <Button key={item.id} action={() => changeEngine(item)}>
        <HStack spacing={8}>
          <EngineIcon kind={item.kind} mode={item.config?.compatibilityMode} size={20} />
          <Text>{item.label}</Text>
          {engine?.id === item.id ? <Image systemName="checkmark" /> : null}
        </HStack>
      </Button>
    ))}
  </Menu>
  const albumButton = <Button
    buttonStyle={useGlass ? "glass" : "bordered"}
    frame={{ width: sideButtonSize, height: sideButtonSize }}
    disabled={busy}
    accessibilityLabel="从相册选择"
    action={() => { void pickImage() }}
  ><Image systemName="photo.on.rectangle" font="title2" /></Button>
  const captureButton = <Button
    buttonStyle="plain"
    frame={{ width: 76, height: 76 }}
    disabled={busy}
    accessibilityLabel={viewingCamera ? "拍照" : "打开相机"}
    action={() => { void (viewingCamera ? capture() : startCamera()) }}
  ><Image systemName={viewingCamera ? "circle.inset.filled" : "camera.circle.fill"}
    font={68} foregroundStyle={showingCaptureSurface ? "white" : "accentColor"} /></Button>
  const confirmButton = image && !result && recognizedBlocks.length
    ? <Button buttonStyle="borderedProminent"
        frame={{ width: compactControls ? 44 : 52, height: sideButtonSize }}
        disabled={busy || !selectedIds.length}
        accessibilityLabel={`确认翻译已选中的 ${selectedIds.length} 处文字`}
        action={confirmSelection}>
        <Image systemName="checkmark" font="title" />
      </Button>
    : null
  const rotateButton = Device.isiPhone ? <Button
    buttonStyle={useGlass ? "glass" : "bordered"}
    frame={{ width: compactControls ? 44 : 52, height: sideButtonSize }}
    disabled={busy}
    accessibilityLabel="切换横竖屏"
    action={() => {
      const current = forcedOrientationRef.current ?? (Device.isLandscape ? "landscape" : "portrait")
      setPageOrientation(current === "landscape" ? "portrait" : "landscape")
    }}
  ><Image systemName="rotate.right" font="title2" /></Button> : null
  const closeButton = <Button
    buttonStyle={useGlass ? "glass" : "bordered"}
    frame={{ width: sideButtonSize, height: sideButtonSize }}
    accessibilityLabel="退出拍照翻译"
    action={() => { void close() }}
  ><Image systemName="xmark" font="title2" /></Button>
  const status = image && recognizedBlocks.length && !result && !busy && message === SELECT_TEXT_MESSAGE
    ? `已选 ${selectedIds.length} 处，点击相册旁的勾选按钮翻译。`
    : message
  const statusText = status && !(image && busy)
    ? <Text foregroundStyle={showingCaptureSurface ? "white" : "label"}
        background={image ? "regularMaterial" : undefined}
        padding={{ horizontal: 20, vertical: 8 }}>{status}</Text>
    : !camera && !image ? <Text foregroundStyle="secondaryLabel">拍照或从相册选择图片，再点选文字翻译。</Text> : null
  return (
    <NavigationStack><ZStack
      navigationBarVisibility="hidden"
      navigationBarBackButtonHidden
      tabBarVisibility="hidden"
      preferredColorScheme={showingCaptureSurface ? "dark" : undefined}
      translationHost={translationHost}
      background={showingCaptureSurface ? "black" : "systemGroupedBackground"}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      onCameraCaptureEvent={{
        isEnabled: viewingCamera && !busy,
        primaryAction: (event) => { if (event.phase === "ended") void capture() },
      }}
      simultaneousGesture={{
        gesture: MagnifyGesture()
          .onChanged(({ magnification }) => {
            const current = cameraRef.current
            if (!current || image || !Number.isFinite(magnification) || magnification <= 0) return
            const device = current.device
            const startZoom = pinchStartZoomRef.current ?? device.videoZoomFactor
            pinchStartZoomRef.current = startZoom
            const zoom = Math.max(device.minAvailableVideoZoomFactor,
              Math.min(device.maxAvailableVideoZoomFactor, startZoom * magnification))
            if (zoom !== device.videoZoomFactor) device.setVideoZoomFactor(zoom)
          })
          .onEnded(() => { pinchStartZoomRef.current = null }),
        isEnabled: viewingCamera && !busy,
      }}
    >
      {camera ? (
        <CaptureVideoPreviewView
          session={camera.session} videoDevice={camera.device}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          opacity={image ? 0 : 1}
          ignoresSafeArea={{ regions: "container", edges: "all" }}
          accessibilityLabel="相机取景"
        />
      ) : null}
      {image ? <PhotoOverlay image={image} blocks={result?.blocks ?? (recognizedBlocks.length && !busy ? recognizedBlocks : previewBlocks)}
        selecting={!result && !busy && recognizedBlocks.length > 0}
        selected={selectedIds}
        onSelect={(index) => {
          setSelectedIds((current) => current.includes(index)
            ? current.filter((id) => id !== index) : [...current, index])
          setMessage(SELECT_TEXT_MESSAGE)
        }}
        onTap={() => {
        if (result && !busy) setControlsVisible(!controlsVisible)
      }} /> : null}
      {image && busy ? (
        <VStack spacing={10} padding={16}
          glassEffect={useGlass ? { type: "rect", cornerRadius: 16 } : undefined}
          background={useGlass ? undefined : "regularMaterial"}
          clipShape={{ type: "rect", cornerRadius: 16 }}>
          <ProgressView progressViewStyle="circular" controlSize="large" />
          <Text font="subheadline">{message || "翻译中…"}</Text>
        </VStack>
      ) : null}
      {busy && !image ? <ProgressView progressViewStyle="circular" controlSize="large" tint="white" /> : null}
      {controlsVisible ? <GeometryReader frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {(proxy) => {
          const insets = proxy.safeAreaInsets
          previewAspectRef.current =
            (proxy.size.width + insets.leading + insets.trailing) /
            (proxy.size.height + insets.top + insets.bottom)
          const landscape = proxy.size.width > proxy.size.height
          const landscapePickerWidth = Math.max(90,
            Math.floor((proxy.size.width - sideWidth - 80) / 3))
          return landscape ? (
            <HStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 16, vertical: 12 }}>
              <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                  {sourcePicker(landscapePickerWidth)}
                  <Image systemName="arrow.right" frame={{ width: 16 }}
                    foregroundStyle={showingCaptureSurface ? "white" : "label"} />
                  {targetPicker(landscapePickerWidth)}
                  {enginePicker(landscapePickerWidth)}
                </HStack>
                <Spacer />
                {statusText}
                <Spacer />
              </VStack>
              <VStack spacing={8} frame={{ width: sideWidth, maxHeight: "infinity" }}>
                {closeButton}
                {rotateButton}
                <Spacer />
                {captureButton}
                <Spacer />
                {confirmButton ? <HStack spacing={8} frame={{ width: sideWidth }}>
                  {albumButton}
                  {confirmButton}
                </HStack> : albumButton}
              </VStack>
            </HStack>
          ) : (
            <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} spacing={12}>
              <HStack spacing={8} padding={{ horizontal: 16, top: 10 }}>
                {sourcePicker(languageWidth)}
                <Image systemName="arrow.right" foregroundStyle={showingCaptureSurface ? "white" : "label"} />
                {targetPicker(languageWidth)}
              </HStack>
              <HStack padding={{ horizontal: 16 }} frame={{ maxWidth: "infinity" }}>
                {enginePicker()}
              </HStack>
              <Spacer />
              {statusText}
              <HStack frame={{ maxWidth: "infinity" }} padding={{ horizontal: 24, bottom: 12 }}>
                <HStack spacing={8} frame={{ width: sideWidth, alignment: "leading" }}>
                  {albumButton}
                  {confirmButton}
                </HStack>
                <Spacer />
                {captureButton}
                <Spacer />
                <HStack spacing={8} frame={{ width: sideWidth, alignment: "trailing" }}>
                  {rotateButton}
                  {closeButton}
                </HStack>
              </HStack>
            </VStack>
          )
        }}
      </GeometryReader> : null}
    </ZStack></NavigationStack>
  )
}
