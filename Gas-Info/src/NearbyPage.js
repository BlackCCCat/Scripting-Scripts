"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NearbyPage = void 0;
const scripting_1 = require("scripting");
const theme_1 = require("./theme");
/** 单个加油站卡片 */
function StationRow({ entry, onNavigate, }) {
    const { meters } = entry;
    return (createElement(scripting_1.Button, { action: () => onNavigate(entry) },
        createElement(scripting_1.HStack, { spacing: 12, padding: 14, glassEffect: theme_1.Theme.glassCard, frame: { maxWidth: "infinity", alignment: "leading" } },
            createElement(ZStackIcon, { index: entry.index }),
            createElement(scripting_1.VStack, { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "leading" } },
                createElement(scripting_1.Text, { font: 15, fontWeight: "medium", foregroundStyle: "label", lineLimit: 2, multilineTextAlignment: "leading", frame: { maxWidth: "infinity", alignment: "leading" } }, entry.address)),
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.VStack, { alignment: "trailing", spacing: 4 },
                createElement(scripting_1.Text, { font: 15, fontWeight: "bold", foregroundStyle: theme_1.Theme.priceOrange }, MapUtils.formatDistance(meters)),
                createElement(scripting_1.HStack, { spacing: 2 },
                    createElement(scripting_1.Image, { systemName: "arrow.triangle.turn.up.right.diamond.fill", font: 11, foregroundStyle: theme_1.Theme.orange }),
                    createElement(scripting_1.Text, { font: 12, foregroundStyle: theme_1.Theme.orange }, "\u5BFC\u822A"))))));
}
/** 加油站图标小圆 */
function ZStackIcon({ index }) {
    return (createElement(scripting_1.VStack, { frame: { width: 38, height: 38 }, background: theme_1.Theme.orange, clipShape: "circle" },
        createElement(scripting_1.Text, { font: 16, fontWeight: "bold", foregroundStyle: "white" }, index)));
}
function NearbyPage({ radiusKm }) {
    const [stations, setStations] = (0, scripting_1.useState)([]);
    const [loading, setLoading] = (0, scripting_1.useState)(true);
    const [error, setError] = (0, scripting_1.useState)(null);
    const [currentCoordinate, setCurrentCoordinate] = (0, scripting_1.useState)(null);
    const camera = (0, scripting_1.useObservable)(MapCameraPosition.automatic());
    async function load() {
        setLoading(true);
        setError(null);
        try {
            const loc = await Location.requestCurrent();
            if (!loc) {
                setError("无法获取当前位置，请在系统设置中允许定位权限。");
                setLoading(false);
                return;
            }
            const here = {
                latitude: loc.latitude,
                longitude: loc.longitude,
            };
            setCurrentCoordinate(here);
            const region = {
                center: here,
                span: { latitudeDelta: 0.08, longitudeDelta: 0.08 },
            };
            camera.setValue(MapCameraPosition.region(region));
            const results = await MapSearch.locate({
                query: "加油站",
                region,
                resultTypes: ["pointOfInterest"],
                pointOfInterestFilter: { includes: ["gasStation"] },
            });
            const entries = results
                .map(item => buildStationEntry(item, here, 0))
                .sort((a, b) => a.meters - b.meters);
            // 优先展示设定半径内的油站；若半径内一个都没有，则退回显示最近的若干个
            const withinRadius = entries.filter(e => e.meters <= radiusKm * 1000);
            const finalList = withinRadius.length > 0 ? withinRadius : entries.slice(0, 10);
            const localized = await localizeStationEntries(finalList.map((entry, index) => ({ ...entry, index: index + 1 })));
            setStations(localized);
            if (finalList.length === 0) {
                setError("附近未找到加油站。");
            }
        }
        catch (e) {
            setError("搜索附近加油站失败，请稍后重试。");
        }
        finally {
            setLoading(false);
        }
    }
    (0, scripting_1.useEffect)(() => {
        load();
    }, [radiusKm]);
    async function localizeStationEntries(entries) {
        return Promise.all(entries.map(localizeStationEntry));
    }
    async function localizeStationEntry(entry) {
        try {
            const placemarks = await Location.reverseGeocode({
                latitude: entry.item.coordinate.latitude,
                longitude: entry.item.coordinate.longitude,
                locale: "zh-CN",
            });
            const placemark = placemarks?.[0];
            if (!placemark) {
                return entry;
            }
            return {
                ...entry,
                address: formatDisplayAddress(placemark, entry.item.coordinate),
            };
        }
        catch {
            return entry;
        }
    }
    async function recenterToCurrentLocation() {
        const loc = await Location.requestCurrent();
        if (!loc) {
            return;
        }
        const here = {
            latitude: loc.latitude,
            longitude: loc.longitude,
        };
        setCurrentCoordinate(here);
        camera.setValue(MapCameraPosition.region({
            center: here,
            span: { latitudeDelta: 0.08, longitudeDelta: 0.08 },
        }));
    }
    async function navigateTo(entry) {
        const item = entry.item;
        const idx = await Dialog.actionSheet({
            title: entry.address,
            actions: [
                { label: "Apple 地图导航" },
                { label: "高德地图导航" },
                { label: "百度地图导航" },
                { label: "谷歌地图导航" },
            ],
        });
        if (idx == null) {
            return;
        }
        if (idx === 0) {
            await Safari.openURL(appleNavigationURL(item.coordinate));
            return;
        }
        const name = entry.address;
        const coordinate = item.coordinate;
        if (idx === 1) {
            await openExternalURL(amapNavigationURL(coordinate, name), amapWebNavigationURL(coordinate, name));
        }
        else if (idx === 2) {
            await openExternalURL(baiduNavigationURL(coordinate, name), baiduWebNavigationURL(coordinate, name));
        }
        else if (idx === 3) {
            await openExternalURL(googleNavigationURL(coordinate), googleWebNavigationURL(coordinate));
        }
    }
    return (createElement(scripting_1.VStack, { spacing: 0, frame: { maxWidth: "infinity", maxHeight: "infinity" } },
        createElement(scripting_1.ZStack, { frame: { height: 300 } },
            createElement(scripting_1.Map, { cameraPosition: camera, frame: { height: 300 }, controls: createElement(scripting_1.MapCompass, null) },
                currentCoordinate ? (createElement(scripting_1.Marker, { coordinate: currentCoordinate, title: "\u5F53\u524D\u4F4D\u7F6E", systemImage: "location.fill", tint: "systemBlue" })) : null,
                stations.map((e, index) => (createElement(scripting_1.Marker, { coordinate: e.item.coordinate, title: "", monogram: `${index + 1}`, tint: theme_1.Theme.orange })))),
            createElement(scripting_1.VStack, { frame: { maxWidth: "infinity", maxHeight: "infinity" } },
                createElement(scripting_1.Spacer, null),
                createElement(scripting_1.HStack, { frame: { maxWidth: "infinity" }, padding: { trailing: 14, bottom: 14 } },
                    createElement(scripting_1.Spacer, null),
                    createElement(scripting_1.Button, { action: recenterToCurrentLocation },
                        createElement(scripting_1.Image, { systemName: "location.fill", font: 18, foregroundStyle: theme_1.Theme.orange, padding: 12, glassEffect: theme_1.Theme.glassCircle }))))),
        createElement(scripting_1.HStack, { padding: { horizontal: 16, vertical: 12 }, background: theme_1.Theme.pageBg, frame: { maxWidth: "infinity", alignment: "leading" } },
            createElement(scripting_1.Image, { systemName: "mappin.and.ellipse", font: 15, foregroundStyle: theme_1.Theme.orange }),
            createElement(scripting_1.Text, { font: 16, fontWeight: "semibold" }, "\u9644\u8FD1\u52A0\u6CB9\u7AD9"),
            createElement(scripting_1.Text, { font: 13, foregroundStyle: theme_1.Theme.secondary },
                radiusKm,
                " \u516C\u91CC\u5185 \u00B7 ",
                stations.length,
                " \u4E2A"),
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Button, { action: () => load() },
                createElement(scripting_1.Image, { systemName: "arrow.clockwise", font: 16, foregroundStyle: theme_1.Theme.orange }))),
        loading ? (createElement(scripting_1.VStack, { spacing: 10, frame: { maxWidth: "infinity", maxHeight: "infinity" } },
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Image, { systemName: "location.magnifyingglass", font: 30, foregroundStyle: theme_1.Theme.orange }),
            createElement(scripting_1.Text, { foregroundStyle: theme_1.Theme.secondary }, "\u6B63\u5728\u641C\u7D22\u9644\u8FD1\u52A0\u6CB9\u7AD9\u2026"),
            createElement(scripting_1.Spacer, null))) : error ? (createElement(scripting_1.VStack, { spacing: 12, padding: 24, frame: { maxWidth: "infinity", maxHeight: "infinity" } },
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Image, { systemName: "exclamationmark.triangle", font: 30, foregroundStyle: theme_1.Theme.secondary }),
            createElement(scripting_1.Text, { foregroundStyle: theme_1.Theme.secondary, multilineTextAlignment: "center" }, error),
            createElement(scripting_1.Button, { action: () => load() },
                createElement(scripting_1.Text, { font: 15, fontWeight: "semibold", foregroundStyle: "white", padding: { horizontal: 20, vertical: 10 }, background: theme_1.Theme.orange, clipShape: { type: "rect", cornerRadius: 12 } }, "\u91CD\u8BD5")),
            createElement(scripting_1.Spacer, null))) : (createElement(scripting_1.ScrollView, null,
            createElement(scripting_1.VStack, { spacing: 10, alignment: "leading", frame: { maxWidth: "infinity", alignment: "leading" }, padding: { horizontal: 16, top: 4, bottom: 24 } }, stations.map(e => (createElement(StationRow, { entry: e, onNavigate: navigateTo }))))))));
}
exports.NearbyPage = NearbyPage;
function buildStationEntry(item, from, index) {
    return {
        item,
        meters: item.distance(from),
        index,
        address: formatDisplayAddress(item.placemark, item.coordinate),
    };
}
function formatDisplayAddress(placemark, coordinate) {
    return (formatChinesePlacemarkAddress(placemark) ??
        `${formatCoordinate(coordinate)}附近加油站`);
}
function formatChinesePlacemarkAddress(placemark) {
    const parts = [
        placemark.administrativeArea,
        placemark.locality,
        placemark.subLocality,
        placemark.thoroughfare,
        placemark.subThoroughfare,
    ]
        .map(cleanChineseAddressPart)
        .filter((v) => !!v);
    return parts.length ? Array.from(new Set(parts)).join("") : null;
}
function cleanChineseAddressPart(value) {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed || !containsChinese(trimmed)) {
        return null;
    }
    return trimmed;
}
function containsChinese(value) {
    return /[\u3400-\u9fff]/.test(value);
}
function formatCoordinate(coordinate) {
    return `北纬${coordinate.latitude.toFixed(5)}，东经${coordinate.longitude.toFixed(5)}`;
}
function appleNavigationURL(coordinate) {
    return `http://maps.apple.com/?daddr=${coordinate.latitude},${coordinate.longitude}&dirflg=d`;
}
function amapNavigationURL(coordinate, name) {
    const gcj = wgs84ToGcj02(coordinate);
    return `iosamap://path?sourceApplication=${encodeURIComponent("今日油价")}&dlat=${gcj.latitude}&dlon=${gcj.longitude}&dname=${encodeURIComponent(name)}&dev=0&t=0`;
}
function amapWebNavigationURL(coordinate, name) {
    const gcj = wgs84ToGcj02(coordinate);
    return `https://uri.amap.com/navigation?to=${gcj.longitude},${gcj.latitude},${encodeURIComponent(name)}&mode=car&policy=1&src=${encodeURIComponent("今日油价")}&coordinate=gaode&callnative=1`;
}
function baiduNavigationURL(coordinate, name) {
    const gcj = wgs84ToGcj02(coordinate);
    return `baidumap://map/direction?destination=name:${encodeURIComponent(name)}|latlng:${gcj.latitude},${gcj.longitude}&mode=driving&coord_type=gcj02`;
}
function baiduWebNavigationURL(coordinate, name) {
    const gcj = wgs84ToGcj02(coordinate);
    return `https://api.map.baidu.com/direction?destination=name:${encodeURIComponent(name)}|latlng:${gcj.latitude},${gcj.longitude}&mode=driving&coord_type=gcj02&output=html&src=${encodeURIComponent("今日油价")}`;
}
function googleNavigationURL(coordinate) {
    return `comgooglemaps://?daddr=${coordinate.latitude},${coordinate.longitude}&directionsmode=driving`;
}
function googleWebNavigationURL(coordinate) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coordinate.latitude},${coordinate.longitude}&travelmode=driving`;
}
async function openExternalURL(url, fallbackURL) {
    const opened = await Safari.openURL(url);
    if (!opened) {
        await Safari.openURL(fallbackURL);
    }
}
function wgs84ToGcj02(coordinate) {
    const lat = coordinate.latitude;
    const lon = coordinate.longitude;
    if (outOfChina(lat, lon)) {
        return coordinate;
    }
    let dLat = transformLat(lon - 105.0, lat - 35.0);
    let dLon = transformLon(lon - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - 0.00669342162296594323 * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat =
        (dLat * 180.0) /
            (((6378245.0 * (1 - 0.00669342162296594323)) /
                (magic * sqrtMagic)) *
                Math.PI);
    dLon =
        (dLon * 180.0) /
            ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return {
        latitude: lat + dLat,
        longitude: lon + dLon,
    };
}
function outOfChina(lat, lon) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x, y) {
    let ret = -100.0 +
        2.0 * x +
        3.0 * y +
        0.2 * y * y +
        0.1 * x * y +
        0.2 * Math.sqrt(Math.abs(x));
    ret +=
        ((20.0 * Math.sin(6.0 * x * Math.PI) +
            20.0 * Math.sin(2.0 * x * Math.PI)) *
            2.0) /
            3.0;
    ret +=
        ((20.0 * Math.sin(y * Math.PI) +
            40.0 * Math.sin((y / 3.0) * Math.PI)) *
            2.0) /
            3.0;
    ret +=
        ((160.0 * Math.sin((y / 12.0) * Math.PI) +
            320 * Math.sin((y * Math.PI) / 30.0)) *
            2.0) /
            3.0;
    return ret;
}
function transformLon(x, y) {
    let ret = 300.0 +
        x +
        2.0 * y +
        0.1 * x * x +
        0.1 * x * y +
        0.1 * Math.sqrt(Math.abs(x));
    ret +=
        ((20.0 * Math.sin(6.0 * x * Math.PI) +
            20.0 * Math.sin(2.0 * x * Math.PI)) *
            2.0) /
            3.0;
    ret +=
        ((20.0 * Math.sin(x * Math.PI) +
            40.0 * Math.sin((x / 3.0) * Math.PI)) *
            2.0) /
            3.0;
    ret +=
        ((150.0 * Math.sin((x / 12.0) * Math.PI) +
            300.0 * Math.sin((x / 30.0) * Math.PI)) *
            2.0) /
            3.0;
    return ret;
}
