import { debugLog, describeError } from "../core/debug";
import { delay } from "../core/stream";

export type KeepAliveOwner = "session" | "pairing";

const owners = new Set<KeepAliveOwner>();
let locationUpdateActive = false;

/**
 * 申请后台保活并登记持有者（恢复至 v1.2.1 方式）：
 * 先启用音频保活，待 0xAA05 鉴权完成并开启定位订阅后再升级至 audioAndLocation，失败时回退到 audio。
 * 不注册 SharedAudioSession 监听、不启用轮询定时器，也不引入 AVPlayer。
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
  if (!started && typeof BackgroundKeeper.getState === "function") {
    const state = await BackgroundKeeper.getState().catch(() => null);
    if (state) {
      debugLog(
        "keepalive",
        `keepAlive 详情 status=${state.status} audio=${state.modeStates.audio.status}(${state.modeStates.audio.lastFailure ?? "-"}) location=${state.modeStates.location.status}(${state.modeStates.location.lastFailure ?? "-"})`,
      );
    }
  }
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

async function applyNavigationLocationConfig(): Promise<void> {
  Location.setActivityType?.("otherNavigation");
  await Location.setAccuracy?.("bestForNavigation")?.catch(() => undefined);
  Location.setDistanceFilter?.(-1);
}

/**
 * 启动导航级 CoreLocation 订阅（对齐上游 LiveCoreLocationMonitor）：
 * 必须使用 bestForNavigation + otherNavigation + distanceFilter=-1，iOS locationd 才会积极触发 CarKit 0xFFFA 并锁定外设 GPS。
 */
export async function startLocationMonitorUpdates(): Promise<void> {
  if (locationUpdateActive) {
    await applyNavigationLocationConfig().catch(() => undefined);
    return;
  }
  try {
    await applyNavigationLocationConfig();
    Location.setAllowsBackgroundLocationUpdates?.(true);
    Location.setPausesLocationUpdatesAutomatically?.(false);
    Location.setShowsBackgroundLocationIndicator?.(true);
    try {
      await Location.startUpdatingLocation({ requestAlwaysAuthorization: true });
    } catch {
      await Location.startUpdatingLocation();
    }
    locationUpdateActive = true;
    debugLog("location", "已开启导航级位置订阅监控 (bestForNavigation)");
  } catch (error) {
    locationUpdateActive = false;
    debugLog("location", "开启位置更新监控失败", describeError(error));
  }
}

export async function stopLocationMonitorUpdates(): Promise<void> {
  if (!locationUpdateActive) return;
  locationUpdateActive = false;
  try {
    Location.stopUpdatingLocation();
    debugLog("location", "已停止位置更新监控");
  } catch (error) {
    debugLog("location", "停止位置更新监控失败", describeError(error));
  }
}

/**
 * 轻量轻推 locationd（不销毁活跃订阅）：短暂切换 tenMeters 后切回 bestForNavigation，对齐上游 nudgeForAccessoryLock。
 */
export async function nudgeLocationSubscription(): Promise<void> {
  if (!locationUpdateActive) return;
  try {
    await Location.setAccuracy?.("tenMeters")?.catch(() => undefined);
    await delay(150);
    if (!locationUpdateActive) return;
    await applyNavigationLocationConfig();
    await Location.startUpdatingLocation().catch(() => undefined);
  } catch (error) {
    debugLog("location", "轻推位置订阅失败", describeError(error));
  }
}

/**
 * 硬脉冲重启定位订阅（stop -> 250ms -> start），对齐上游 pulseForAccessoryLock。
 */
export async function pulseLocationSubscription(): Promise<void> {
  if (!locationUpdateActive) return;
  try {
    Location.stopUpdatingLocation();
    await delay(250);
    if (!locationUpdateActive) return;
    await applyNavigationLocationConfig();
    await Location.startUpdatingLocation().catch(() => undefined);
  } catch (error) {
    debugLog("location", "脉冲重启位置订阅失败", describeError(error));
  }
}

/**
 * 用户开关系统「定位服务」(0xFFFC -> 0xFFFA) 后重同步导航级后台定位与保活会话，对齐 Reukix/Reloc refreshAfterLocationToggle。
 * 不主动调用 stopUpdatingLocation()（否则会立刻引发多余 0xFFFC 抖动），若系统权限状态仍在过渡期则短暂退避重试。
 */
export async function refreshKeepAliveAfterLocationToggle(): Promise<void> {
  locationUpdateActive = false;
  await startLocationMonitorUpdates();
  if (!locationUpdateActive) {
    await delay(500);
    await startLocationMonitorUpdates();
  }
  if (!locationUpdateActive) {
    await delay(800);
    await startLocationMonitorUpdates();
  }
  await retainKeepAlive("session").catch((error) => {
    debugLog("keepalive", "重建保活失败", describeError(error));
  });
}
