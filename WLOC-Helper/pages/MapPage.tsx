// 地图展示组件：相机、选点和 Marker 使用 Apple 地图显示坐标。
// 坐标显示和操作按钮已移至 index.tsx App 层；顶部工具栏已统一到 index.tsx。

import {
  useEffect,
  useObservable,
  Map,
  Marker,
  MapCompass,
  MapScaleView,
  ZStack,
  type MapSelectionValue,
} from "scripting";
import type { Coordinate, MapLayerId } from "../types";
import { DEFAULT_SPAN } from "../constants";

// 从 MapCameraPosition 中提取中心坐标
function getCoordFromPosition(pos: MapCameraPosition): Coordinate | null {
  if (pos.region) return { latitude: pos.region.center.latitude, longitude: pos.region.center.longitude };
  if (pos.camera) return { latitude: pos.camera.centerCoordinate.latitude, longitude: pos.camera.centerCoordinate.longitude };
  if (pos.rect) return { latitude: pos.rect.center.latitude, longitude: pos.rect.center.longitude };
  if (pos.item) return { latitude: pos.item.coordinate.latitude, longitude: pos.item.coordinate.longitude };
  return null;
}

interface MapPageProps {
  pendingMapCoord: Observable<Coordinate | null>;
  mapLat: Observable<number>;
  mapLng: Observable<number>;
  layer: Observable<MapLayerId>;
  onMapCoordChange: (lat: number, lng: number, userInitiated?: boolean) => void;
}

export function MapPage({
  pendingMapCoord,
  mapLat,
  mapLng,
  layer,
  onMapCoordChange,
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
        onMapCoordChange(c.latitude, c.longitude, pos.positionedByUser);
      }
      setTimeout(poll, 300);
    }
    poll();
    return () => { stopped = true; };
  }, []);

  // 外部跳转在 App 层已从 WGS-84 转为 Apple 地图显示坐标。
  useEffect(() => {
    const cb = (target: Coordinate | null) => {
      if (target) {
        moveCameraTo(target.latitude, target.longitude);
        onMapCoordChange(target.latitude, target.longitude, false);
        pendingMapCoord.setValue(null);
      }
    };
    pendingMapCoord.subscribe(cb);
    return () => pendingMapCoord.unsubscribe(cb);
  }, []);

  // POI 选点 — 使用 subscribe 保证可靠监听
  useEffect(() => {
    const cb = (sel: MapSelectionValue | null) => {
      if (sel && sel.type === "feature" && sel.coordinate) {
        moveCameraTo(sel.coordinate.latitude, sel.coordinate.longitude);
        onMapCoordChange(sel.coordinate.latitude, sel.coordinate.longitude, true);
      }
    };
    mapSelection.subscribe(cb);
    return () => mapSelection.unsubscribe(cb);
  }, []);

  const mapStyle = layerToStyle(layer.value);

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
        {(mapLat.value !== 0 || mapLng.value !== 0) && (
          <Marker
            coordinate={{ latitude: mapLat.value, longitude: mapLng.value }}
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
