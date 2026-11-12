// runInMain 在主线程可能立即执行；先跨一轮事件，确保原生事件监听已返回。
export const scheduleUI = (change: () => void): ReturnType<typeof setTimeout> =>
  setTimeout(() => Thread.runInMain(change), 0)
