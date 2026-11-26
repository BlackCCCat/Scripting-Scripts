import { debugLog, describeError } from "../core/debug";

export type KeepAliveOwner = "session" | "pairing";

const owners = new Set<KeepAliveOwner>();
let locationUpdateActive = false;
let locationHighAccuracy = false;

/**
 * 申请后台保活并登记持有者；先启用低功耗音频保活，待 0xAA05 鉴权完成并开启定位订阅后再升级至 audioAndLocation。
 */
export async function retainKeepAlive(owner: KeepAliveOwner): Promise<boolean> {
  let started = false;
  if (owner === "session" && locationUpdateActive) {
    try {
      started = await BackgroundKeeper.keepAlive("audioAndLocation");
    } catch {
      started = false;
    }
    if (!started) {
      started = await BackgroundKeeper.keepAlive("audio");
    }
  } else {
    started = await BackgroundKeeper.keepAlive("audio");
  }
  owners.add(owner);
  debugLog("keepalive", `keepAlive() -> ${started}（持有者: ${[...owners].join("+")}）`);
  return started;
}

export async function releaseKeepAlive(owner: KeepAliveOwner): Promise<void> {
  if (!owners.delete(owner)) return;
  if (owners.size > 0) {
    debugLog("keepalive", `${owner} 释放，${[...owners].join("+")} 仍在使用保活`);
    return;
  }
  debugLog("keepalive", `${owner} 释放，停止 BackgroundKeeper`);
  await BackgroundKeeper.stopKeepAlive().catch((error) => {
    debugLog("keepalive", "停止 BackgroundKeeper 失败", describeError(error));
  });
}

async function applyMonitorAccuracy(highAccuracy: boolean): Promise<void> {
  locationHighAccuracy = highAccuracy;
  Location.setActivityType?.(highAccuracy ? "otherNavigation" : "other");
  await Location.setAccuracy?.(highAccuracy ? "tenMeters" : "hundredMeters")?.catch(() => undefined);
  Location.setDistanceFilter?.(highAccuracy ? -1 : 25);
}

/**
 * 启动连续 Location 订阅：默认使用低功耗 hundredMeters，避免持续满载 GNSS 芯片发热；
 * 仅在实测页面主动观测时切换为高精度。
 */
export async function startLocationMonitorUpdates(highAccuracy = false): Promise<void> {
  if (locationUpdateActive) {
    if (locationHighAccuracy !== highAccuracy) {
      await applyMonitorAccuracy(highAccuracy).catch(() => undefined);
    }
    return;
  }
  try {
    await applyMonitorAccuracy(highAccuracy);
    Location.setAllowsBackgroundLocationUpdates?.(true);
    Location.setPausesLocationUpdatesAutomatically?.(false);
    Location.setShowsBackgroundLocationIndicator?.(true);
    try {
      await Location.startUpdatingLocation({ requestAlwaysAuthorization: true });
    } catch {
      await Location.startUpdatingLocation();
    }
    locationUpdateActive = true;
    debugLog("location", `已开启位置订阅监控 (highAccuracy=${highAccuracy})`);
  } catch (error) {
    debugLog("location", "开启位置更新监控失败", describeError(error));
  }
}

export async function stopLocationMonitorUpdates(): Promise<void> {
  if (!locationUpdateActive) return;
  locationUpdateActive = false;
  locationHighAccuracy = false;
  try {
    Location.stopUpdatingLocation();
    debugLog("location", "已停止位置更新监控");
  } catch (error) {
    debugLog("location", "停止位置更新监控失败", describeError(error));
  }
}

/**
 * 用户开关系统「定位服务」(0xFFFC -> 0xFFFA) 后重建后台定位与保活会话，与 Reukix/Reloc refreshAfterLocationToggle 对齐。
 */
export async function refreshKeepAliveAfterLocationToggle(highAccuracy = false): Promise<void> {
  await stopLocationMonitorUpdates();
  await startLocationMonitorUpdates(highAccuracy);
  await retainKeepAlive("session").catch((error) => {
    debugLog("keepalive", "重建保活失败", describeError(error));
  });
}
