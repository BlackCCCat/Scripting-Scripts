// 地图展示组件：纯地图 + 标记 + 图层切换按钮（右下角）。
// 坐标显示和操作按钮已移至 index.tsx App 层；顶部工具栏已统一到 index.tsx。

import {
  useEffect,
  useObservable,
  Map,
  Marker,
  MapUserLocationButton,
  MapCompass,
  MapScaleView,
  VStack,
  HStack,
  Button,
  Spacer,
  RoundedRectangle,
  Image,
  ZStack,
  type MapSelectionValue,
} from "scripting";
import type { AppSettings, Coordinate, ActiveLocation, MapLayerId } from "../types";
import { DEFAULT_SPAN } from "../constants";
import { clearActiveCache } from "../utils/storage";
import { queryDevice } from "../api/deviceApi";

// 从 MapCameraPosition 中提取中心坐标
function getCoordFromPosition(pos: MapCameraPosition): Coordinate | null {
  if (pos.region) return { latitude: pos.region.center.latitude, longitude: pos.region.center.longitude };
  if (pos.camera) return { latitude: pos.camera.centerCoordinate.latitude, longitude: pos.camera.centerCoordinate.longitude };
  if (pos.rect) return { latitude: pos.rect.center.latitude, longitude: pos.rect.center.longitude };
  if (pos.item) return { latitude: pos.item.coordinate.latitude, longitude: pos.item.coordinate.longitude };
  return null;
}

interface MapPageProps {
  settings: AppSettings;
  pendingCoord: Observable<Coordinate | null>;
  coordLat: Observable<number>;
  coordLng: Observable<number>;
  layer: Observable<MapLayerId>;
  onCycleLayer: () => void;
  onCoordChange: (lat: number, lng: number) => void;
  onActiveLocChange: (loc: ActiveLocation | null) => void;
}

export function MapPage({
  settings,
  pendingCoord,
  coordLat,
  coordLng,
  layer,
  onCycleLayer,
  onCoordChange,
  onActiveLocChange,
}: MapPageProps) {
  const cameraPosition = useObservable<MapCameraPosition>(MapCameraPosition.automatic());



  // POI 选点
  const mapSelection = useObservable<MapSelectionValue | null>(null);

  // 移动地图中心
  function moveCameraTo(lat: number, lng: number) {
    cameraPosition.setValue(
      MapCameraPosition.region({
        center: { latitude: lat, longitude: lng },
        span: { latitudeDelta: DEFAULT_SPAN.latitudeDelta, longitudeDelta: DEFAULT_SPAN.longitudeDelta },
      }),
    );
  }

  // 轮询：检测手势平移带来的坐标变化
  useEffect(() => {
    let lastLat = 0;
    let lastLng = 0;
    let stopped = false;

    function poll() {
      if (stopped) return;
      const pos = cameraPosition.value;
      const c = getCoordFromPosition(pos);
      if (c && (Math.abs(c.latitude - lastLat) > 0.000001 || Math.abs(c.longitude - lastLng) > 0.000001)) {
        lastLat = c.latitude;
        lastLng = c.longitude;
        onCoordChange(c.latitude, c.longitude);
      }
      setTimeout(poll, 300);
    }
    poll();
    return () => { stopped = true; };
  }, []);

  // 外部跳转（搜索/收藏/链接解析）— 使用 subscribe 保证可靠监听
  useEffect(() => {
    const cb = (target: Coordinate | null) => {
      if (target) {
        moveCameraTo(target.latitude, target.longitude);
        onCoordChange(target.latitude, target.longitude);
        pendingCoord.setValue(null);
      }
    };
    pendingCoord.subscribe(cb);
    return () => pendingCoord.unsubscribe(cb);
  }, []);

  // POI 选点 — 使用 subscribe 保证可靠监听
  useEffect(() => {
    const cb = (sel: MapSelectionValue | null) => {
      if (sel && sel.type === "feature" && sel.coordinate) {
        moveCameraTo(sel.coordinate.latitude, sel.coordinate.longitude);
        onCoordChange(sel.coordinate.latitude, sel.coordinate.longitude);
      }
    };
    mapSelection.subscribe(cb);
    return () => mapSelection.unsubscribe(cb);
  }, []);

  // 启动时：查询设备持久化坐标 → GPS 定位。当前生效坐标只以 WLOC 模块查询结果为准。
  useEffect(() => {
    (async () => {
      clearActiveCache();

      try {
        const loc = await queryDevice(settings.saveApi);
        onActiveLocChange(loc);
        if (loc) {
          moveCameraTo(loc.latitude, loc.longitude);
          onCoordChange(loc.latitude, loc.longitude);
          return;
        }
      } catch {
        onActiveLocChange(null);
      }

      try {
        const gps = await Location.requestCurrent({ forceRequest: true });
        if (gps) {
          moveCameraTo(gps.latitude, gps.longitude);
          onCoordChange(gps.latitude, gps.longitude);
        }
      } catch {}
    })();
  }, []);

  const mapStyle = layerToStyle(layer.value);

  // 图层对应图标
  function layerIcon(id: MapLayerId): string {
    switch (id) {
      case "imagery": return "globe.europe.africa.fill";
      case "hybrid": return "map.fill";
      case "standard":
      default: return "map";
    }
  }

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 地图（全屏，无工具栏覆盖） */}
      <Map
        cameraPosition={cameraPosition}
        selection={mapSelection}
        featureSelectionAccessory={null}
        mapStyle={mapStyle}
        controls={
          <>
            <MapCompass />
            <MapScaleView />
          </>
        }
      >
        {/* 坐标就绪后才显示标记，避免初始 (0,0) 位置闪烁 */}
        {(coordLat.value !== 0 || coordLng.value !== 0) && (
          <Marker
            coordinate={{ latitude: coordLat.value, longitude: coordLng.value }}
            tint="systemRed"
            systemImage="mappin.circle.fill"
          />
        )}
      </Map>


    </ZStack>
  );
}

function layerToStyle(layer: MapLayerId) {
  switch (layer) {
    case "imagery":
      return { style: "imagery" as const, elevation: "realistic" as const };
    case "hybrid":
      return { style: "hybrid" as const, elevation: "realistic" as const, showsTraffic: true };
    case "standard":
    default:
      return { style: "standard" as const, showsTraffic: true };
  }
}
