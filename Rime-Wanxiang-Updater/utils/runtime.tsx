// File: utils/runtime.ts
export const Runtime = {
  Storage: (globalThis as any).Storage as any,
  FileManager: (globalThis as any).FileManager as any,
  fetch: (globalThis as any).fetch as any,
  Safari: (globalThis as any).Safari as any,
  BackgroundURLSession: (globalThis as any).BackgroundURLSession as any,
}
