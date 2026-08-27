// 预览容器 - TabView 主布局 + 全屏切换 + 退出

import { Script, TabView, Tab, Group, EmptyView, ZStack, useState, useEffect, useRef } from "scripting";
import { getAllBookmarks, Bookmark } from "../manager/BookmarkManager";
import { readSettings, saveSettings } from "../manager/Settings";
import { MountDirectoriesPage } from "./MountDirectoriesPage";
import { DualBrowserPage } from "./DualBrowserPage";
import { SettingsTabPage } from "./SettingsTabPage";
import { useReleaseNotesSheet } from "./ReleaseNotesSheet";
import { ToastOverlay } from "./ToastOverlay";
import { showToast } from "../manager/ToastManager";
import { getServerCount, hasActiveServers, stopHttpBackgroundIfIdle } from "../manager/LocalHttpServer";
import { ensureNpmDependencies } from "../manager/npmDeps";

/* ───── 主页视图 ───── */
export function HomeView() {
  const initialSettings = readSettings();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => getAllBookmarks());
  const [refreshKey, setRefreshKey] = useState(0);
  // 仅允许 0、1、2 作为可恢复页面；退出 Tab 永不参与启动恢复。
  const initialTabIndex = initialSettings.defaultTab >= 0 && initialSettings.defaultTab <= 2 ? initialSettings.defaultTab : 0;
  const [tabIndex, setTabIndex] = useState(initialTabIndex);
  const [settings, setSettings] = useState(initialSettings);
  const lastContentTabRef = useRef(initialTabIndex);
  const exitingRef = useRef(false);
  const releaseNotesSheet = useReleaseNotesSheet();

  // 初次进入时检查运行环境，并提示当前保活的 HTTP 服务数量。
  useEffect(() => {
    void ensureNpmDependencies();
    const serverCount = getServerCount();
    if (serverCount > 0) {
      const timer = setTimeout(() => showToast(`正在运行 ${serverCount} 个 HTTP 服务`), 0);
      return () => clearTimeout(timer);
    }
  }, []);

  // 恢复保活实例后回到退出前的内容页。先切到另一个内容 Tab，再在下一轮切回，
  // 促使原生控件离开残留的退出 Tab，但不销毁并重建所有页面。
  useEffect(() => Script.onResume((details) => {
    if (!details.resumeFromMinimized) return;
    exitingRef.current = false;
    const serverCount = getServerCount();
    if (serverCount > 0) showToast(`正在运行 ${serverCount} 个 HTTP 服务`);
    const contentTab = lastContentTabRef.current;
    setTabIndex(contentTab === 0 ? 1 : 0);
    setTimeout(() => setTabIndex(contentTab), 0);
  }), []);

  const onRefresh = () => {
    withAnimation(Animation.smooth({ duration: 0.4 }), () => {
      setBookmarks(getAllBookmarks());
      setRefreshKey((k) => k + 1);
    });
  };

  const exitCurrentInstance = async () => {
    // 原生 Tab 的回调可能连续触发；一次退出流程只执行一次。
    if (exitingRef.current) return;
    exitingRef.current = true;
    if (hasActiveServers() && Script.supportsMinimization()) {
      const minimized = await Script.minimize();
      if (minimized) return;
    }
    // 当前实例没有 HTTP 服务（包括第二次启动的 UI 实例）时，释放它自己的
    // BackgroundKeeper 请求并彻底结束；不会影响持有服务的其他实例。
    await stopHttpBackgroundIfIdle();
    Script.exit();
  };

  const handleTabChange = (index: number) => {
    if (index === 3) {
      // 退出时直接最小化/结束，避免同步重建整棵 TabView 造成卡顿；
      // 恢复时会由 onResume 重建并清除原生退出 Tab 的残留选中状态。
      void exitCurrentInstance();
      return;
    }
    lastContentTabRef.current = index;
    setTabIndex(index);
    // 记住默认标签页
    if (index <= 2) {
      setTimeout(() => {
        saveSettings({ ...readSettings(), defaultTab: index });
      }, 233);
    }
  };

  return (
    <ZStack
      alignment="bottomTrailing"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={releaseNotesSheet}
    >
      <TabView
        tabBarMinimizeBehavior={settings.tabBarMinimizeOnScroll ? "onScrollDown" : "never"}
        tabIndex={tabIndex}
        onTabIndexChanged={handleTabChange}
        labelStyle="iconOnly"
        tabBarVisibility="hidden"
      >
        <Tab title="双栏浏览" systemImage="book.pages.fill" value={0}>
          <Group labelStyle="titleAndIcon">
            <DualBrowserPage settings={settings} refreshKey={refreshKey} onSettingsChange={setSettings} bookmarks={bookmarks} />
          </Group>
        </Tab>

        <Tab title="挂载目录" systemImage="tray.2.fill" value={1}>
          <Group labelStyle="titleAndIcon">
            <MountDirectoriesPage bookmarks={bookmarks} showFolderItemCounts={settings.showFolderItemCounts} onRefresh={onRefresh} onSettingsChange={setSettings} />
          </Group>
        </Tab>

        <Tab title="设置" systemImage="gearshape.fill" value={2}>
          <Group labelStyle="titleAndIcon">
            <SettingsTabPage
              settings={settings}
              onSettingsChange={(newSettings) => {
                saveSettings(newSettings);
                setSettings(newSettings);
              }}
              bookmarks={bookmarks}
              onSwitchTab={handleTabChange}
              onBookmarksChange={onRefresh}
            />
          </Group>
        </Tab>

        <Tab title="退出" systemImage="pencil.slash" value={3} role={settings.showExitButton ? "search" : undefined}>
          <EmptyView />
        </Tab>
      </TabView>
      <ToastOverlay />
    </ZStack>
  );
}
