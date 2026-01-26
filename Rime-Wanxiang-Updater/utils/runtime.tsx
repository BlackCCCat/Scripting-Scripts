// File: utils/runtime.ts
export const Runtime = {
  // 常见全局注入
  Storage: (globalThis as any).Storage as any,
  FileManager: (globalThis as any).FileManager as any,
  Archive: (globalThis as any).Archive as any,

  // 目录/文件选择：不同版本命名可能不同
  DocumentPicker: (globalThis as any).DocumentPicker as any,
  FileDialog: (globalThis as any).FileDialog as any,

  // 网络/打开URL
  fetch: (globalThis as any).fetch as any,
  Safari: (globalThis as any).Safari as any,
  openURL: (globalThis as any).openURL as any,
}