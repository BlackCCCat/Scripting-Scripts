import { Button, DragGesture, GeometryReader, Group, Image, Menu, Script, ToolbarItem, ZStack, useState } from "scripting";
import { Bookmark, getAllBookmarks } from "./manager/BookmarkManager";
import { readSettings, saveSettings } from "./manager/Settings";
import { DualBrowserPage } from "./view/DualBrowserPage";
import { MountDirectoriesPage } from "./view/MountDirectoriesPage";
import { SettingsTabPage } from "./view/SettingsTabPage";
import { ToastOverlay } from "./view/ToastOverlay";

const tabs = [
  { title: "双栏浏览", icon: "book.pages.fill" },
  { title: "挂载目录", icon: "tray.2.fill" },
  { title: "设置", icon: "gearshape.fill" },
] as const;

interface FloatingPosition {
  x: number;
  y: number;
}

const FLOATING_MENU_POSITION_KEY = "FileStore_HomeFloatingTabMenuPosition";
const DEFAULT_FLOATING_POSITION: FloatingPosition = { x: 0.92, y: 0.18 };
const FLOATING_MENU_SIZE = 54;
const FLOATING_MENU_MARGIN = 12;
const SUPPORTS_GLASS_EFFECT = Number.parseInt(Device.systemVersion, 10) >= 26;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readFloatingPosition(): FloatingPosition {
  try {
    const saved = Storage.get<Partial<FloatingPosition>>(FLOATING_MENU_POSITION_KEY, { shared: true });
    const x = saved?.x;
    const y = saved?.y;
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      return {
        x: clamp(x, 0, 1),
        y: clamp(y, 0, 1),
      };
    }
  } catch (error) {
    console.log("读取主页悬浮按钮位置失败:", error);
  }
  return DEFAULT_FLOATING_POSITION;
}

function FloatingTabMenu({ activeTab, onSwitchTab }: { activeTab: number; onSwitchTab: (tab: number) => void }) {
  const [position, setPosition] = useState<FloatingPosition>(readFloatingPosition);
  const [translation, setTranslation] = useState({ x: 0, y: 0 });

  return (
    <GeometryReader frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {(proxy) => {
        const halfSize = FLOATING_MENU_SIZE / 2;
        const minX = FLOATING_MENU_MARGIN + halfSize;
        const maxX = Math.max(minX, proxy.size.width - FLOATING_MENU_MARGIN - halfSize);
        const minY = FLOATING_MENU_MARGIN + halfSize;
        const maxY = Math.max(minY, proxy.size.height - FLOATING_MENU_MARGIN - halfSize);
        const widthRange = maxX - minX;
        const heightRange = maxY - minY;
        const baseX = minX + widthRange * position.x;
        const baseY = minY + heightRange * position.y;
        const displayedX = clamp(baseX + translation.x, minX, maxX);
        const displayedY = clamp(baseY + translation.y, minY, maxY);
        const dragGesture = DragGesture({ minDistance: 8, coordinateSpace: "global" })
          .onChanged((details) => {
            setTranslation({
              x: details.translation.width,
              y: details.translation.height,
            });
          })
          .onEnded((details) => {
            const finalX = clamp(baseX + details.translation.width, minX, maxX);
            const finalY = clamp(baseY + details.translation.height, minY, maxY);
            const nextPosition = {
              x: widthRange > 0 ? (finalX - minX) / widthRange : 0.5,
              y: heightRange > 0 ? (finalY - minY) / heightRange : 0.5,
            };
            setPosition(nextPosition);
            setTranslation({ x: 0, y: 0 });
            Storage.set(FLOATING_MENU_POSITION_KEY, nextPosition, { shared: true });
          });

        return (
          <Menu
            label={
              <ZStack
                frame={{ width: FLOATING_MENU_SIZE, height: FLOATING_MENU_SIZE }}
                background={SUPPORTS_GLASS_EFFECT ? undefined : "regularMaterial"}
                glassEffect={SUPPORTS_GLASS_EFFECT ? "circle" : undefined}
                clipShape="circle"
                contentShape="circle"
              >
                <Image systemName={tabs[activeTab].icon} font={21} foregroundStyle="accentColor" />
              </ZStack>
            }
            buttonStyle="plain"
            frame={{ width: FLOATING_MENU_SIZE, height: FLOATING_MENU_SIZE }}
            clipShape="circle"
            contentShape="circle"
            position={{ x: displayedX, y: displayedY }}
            simultaneousGesture={dragGesture}
            accessibilityLabel="切换 FileStore 页面"
            accessibilityHint="点击选择页面，拖动可调整位置"
            zIndex={100}
          >
            {tabs.map((tab, index) => (
              <Button
                key={tab.title}
                title={tab.title}
                systemImage={tab.icon}
                disabled={index === activeTab}
                action={() => onSwitchTab(index)}
              />
            ))}
          </Menu>
        );
      }}
    </GeometryReader>
  );
}

export default function HomeScreenDefaultUi() {
  const initialSettings = readSettings();
  const [settings, setSettings] = useState(initialSettings);
  const [activeTab, setActiveTab] = useState(initialSettings.defaultTab);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => getAllBookmarks());
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => {
    setBookmarks(getAllBookmarks());
    setRefreshKey((key) => key + 1);
  };

  const switchToTab = (tab: number) => {
    const selectedTab = tab >= 0 && tab < tabs.length ? tab : 0;
    const newSettings = { ...readSettings(), defaultTab: selectedTab };
    saveSettings(newSettings);
    setSettings(newSettings);
    setActiveTab(selectedTab);
    refresh();
  };

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Group labelStyle="titleAndIcon">
        {activeTab === 0 ? (
          <DualBrowserPage
            settings={settings}
            refreshKey={refreshKey}
            onSettingsChange={setSettings}
            bookmarks={bookmarks}
            isHomeScreenHost
            secondaryToolbarLeadingItems={
              <ToolbarItem placement="topBarLeading">
                <Button
                  title="打开 FileStore"
                  systemImage="folder.fill"
                  action={() => {
                    void Script.run({ name: "FileStore" });
                  }}
                />
              </ToolbarItem>
            }
          />
        ) : activeTab === 1 ? (
          <MountDirectoriesPage
            bookmarks={bookmarks}
            showFolderItemCounts={settings.showFolderItemCounts}
            onRefresh={refresh}
            onSettingsChange={setSettings}
          />
        ) : (
          <SettingsTabPage
            settings={settings}
            onSettingsChange={(newSettings) => {
              saveSettings(newSettings);
              setSettings(newSettings);
            }}
            bookmarks={bookmarks}
            onSwitchTab={switchToTab}
            onBookmarksChange={refresh}
          />
        )}
      </Group>
      <FloatingTabMenu activeTab={activeTab} onSwitchTab={switchToTab} />
      <ToastOverlay />
    </ZStack>
  );
}
