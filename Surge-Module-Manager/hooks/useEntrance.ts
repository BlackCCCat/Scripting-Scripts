import { useEffect, useState } from "scripting"

// 每次展示只播放一次入场动画，刷新或切换页面不会重新触发。
export const useEntrance = (): boolean => {
  const [appeared, setAppeared] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setAppeared(true), 60)
    return () => clearTimeout(timer)
  }, [])
  return appeared
}
