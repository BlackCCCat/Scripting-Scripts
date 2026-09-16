import type { PhotoItem } from "./types"

// Only the browsing window owns decoded images; photo IDs and undo history stay intact.
export class PhotoImageCache {
  private images = new Map<string, UIImage>()
  private window = new Map<string, PhotoItem>()
  private inFlight = new Set<string>()
  private failed = new Set<string>()
  private generation = 0
  private disposed = false

  constructor(
    private requestImage: (item: PhotoItem) => Promise<UIImage | null>,
    private onChange: () => void
  ) {}

  get(id: string | undefined): UIImage | null {
    return id ? this.images.get(id) ?? null : null
  }

  setWindow(items: PhotoItem[]) {
    if (this.disposed) return
    this.window = new Map(items.slice(0, 5).map(item => [item.id, item]))
    for (const id of this.images.keys()) {
      if (!this.window.has(id)) this.images.delete(id)
    }
    for (const id of this.failed) {
      if (!this.window.has(id)) this.failed.delete(id)
    }
    this.pump()
  }

  clear() {
    this.generation++
    this.window.clear()
    this.images.clear()
    this.failed.clear()
  }

  dispose() {
    this.disposed = true
    this.clear()
  }

  private pump() {
    if (this.disposed) return
    for (const item of this.window.values()) {
      if (this.inFlight.size >= 2) return
      const key = `${this.generation}:${item.id}`
      if (this.images.has(item.id) || this.failed.has(item.id) || this.inFlight.has(key)) continue
      this.inFlight.add(key)
      void this.load(item, key, this.generation)
    }
  }

  private async load(item: PhotoItem, key: string, generation: number) {
    let image: UIImage | null = null
    try {
      image = await this.requestImage(item)
    } catch (error) {
      console.error(error)
    } finally {
      this.inFlight.delete(key)
      if (!this.disposed && generation === this.generation && this.window.has(item.id)) {
        if (image) {
          this.images.set(item.id, image)
          this.onChange()
        } else {
          this.failed.add(item.id)
        }
      }
      this.pump()
    }
  }
}
