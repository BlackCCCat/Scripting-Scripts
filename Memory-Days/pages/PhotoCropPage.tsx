import { Navigation, NavigationStack, ScrollView, Text, Image, Button, Toolbar, ToolbarItem, VStack, GeometryReader, ZStack, MagnifyGesture, RoundedRectangle } from 'scripting'
import { useState } from 'scripting'
import { MEDIUM_PHOTO_ASPECT, saveCroppedPhoto } from '../photoUtils'

interface PhotoCropPageProps {
  image: UIImage
  cropAspectRatio?: number
}

export async function pickAndCropPhoto(aspectRatio = MEDIUM_PHOTO_ASPECT): Promise<string | null> {
  const images = await Photos.pickPhotos(1)
  if (images.length === 0) return null
  const result = await Navigation.present(
    <PhotoCropPage image={images[0]} cropAspectRatio={aspectRatio} />
  )
  return typeof result === 'string' ? result : null
}

export function PhotoCropPage({ image, cropAspectRatio = MEDIUM_PHOTO_ASPECT }: PhotoCropPageProps) {
  const dismiss = Navigation.useDismiss()
  const [zoom, setZoom] = useState(1)
  const [x, setX] = useState(0.5)
  const [y, setY] = useState(0.5)
  const [dragStartX, setDragStartX] = useState(0.5)
  const [dragStartY, setDragStartY] = useState(0.5)
  const [zoomStart, setZoomStart] = useState(1)
  const [isSaving, setIsSaving] = useState(false)

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  const handleSave = async () => {
    setIsSaving(true)
    const path = await saveCroppedPhoto(image, cropAspectRatio, { zoom, x, y })
    setIsSaving(false)
    dismiss(path)
  }

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="裁剪照片"
        navigationBarTitleDisplayMode="inline"
        background="systemGroupedBackground"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button title="取消" role="cancel" action={() => dismiss(null)} />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button title="使用" systemImage="checkmark" action={handleSave} disabled={isSaving} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        <VStack spacing={18} frame={{ maxWidth: Infinity }} padding={{ top: 18, bottom: 24, leading: 14, trailing: 14 }}>
          <GeometryReader frame={{ maxWidth: Infinity, height: 590 }}>
            {({ size }) => {
              const canvasWidth = Math.min(size.width, 390)
              const canvasHeight = 540
              const width = Math.min(canvasWidth - 32, 360)
              const height = width / cropAspectRatio
              const imageRatio = image.width / image.height
              const baseWidth = imageRatio > cropAspectRatio ? height * imageRatio : width
              const baseHeight = imageRatio > cropAspectRatio ? height : width / imageRatio
              const scaledWidth = baseWidth * zoom
              const scaledHeight = baseHeight * zoom
              const extraX = Math.max(0, scaledWidth - width)
              const extraY = Math.max(0, scaledHeight - height)
              const offsetX = (0.5 - x) * extraX
              const offsetY = (0.5 - y) * extraY
              return (
                <VStack frame={{ maxWidth: Infinity }} alignment="center">
                  <ZStack
                    frame={{ width: canvasWidth, height: canvasHeight }}
                    clipShape={{ type: 'rect', cornerRadius: 28, style: 'continuous' as const }}
                    background="secondarySystemGroupedBackground"
                    onDragGesture={{
                      minDistance: 0,
                      onChanged: details => {
                        if (details.translation.width === 0 && details.translation.height === 0) {
                          setDragStartX(x)
                          setDragStartY(y)
                        }
                        setX(clamp(dragStartX - (details.translation.width / Math.max(1, extraX)), 0, 1))
                        setY(clamp(dragStartY - (details.translation.height / Math.max(1, extraY)), 0, 1))
                      },
                      onEnded: () => {
                        setDragStartX(x)
                        setDragStartY(y)
                      }
                    }}
                    simultaneousGesture={{
                      gesture: MagnifyGesture(0.01)
                        .onChanged(value => {
                          setZoom(clamp(zoomStart * value.magnification, 1, 3))
                        })
                        .onEnded(() => setZoomStart(zoom)),
                      mask: 'all'
                    }}
                  >
                    <Image
                      image={image}
                      resizable
                      scaleToFill
                      frame={{ width: scaledWidth, height: scaledHeight }}
                      offset={{ x: offsetX, y: offsetY }}
                    />
                    <RoundedRectangle
                      cornerRadius={24}
                      fill="clear"
                      frame={{ width, height }}
                      stroke={{
                        shapeStyle: 'white',
                        strokeStyle: { lineWidth: 2.5 }
                      }}
                    />
                    <RoundedRectangle
                      cornerRadius={24}
                      fill="clear"
                      frame={{ width, height }}
                      stroke={{
                        shapeStyle: 'rgba(0,0,0,0.32)',
                        strokeStyle: { lineWidth: 0.8 }
                      }}
                    />
                  </ZStack>
                  <Text foregroundStyle="secondaryLabel" font={13} padding={{ top: 12 }}>移动照片并缩放，白色方框内会保存为卡片照片</Text>
                </VStack>
              )
            }}
          </GeometryReader>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
