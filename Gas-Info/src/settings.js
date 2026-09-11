"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLastAutoProvinceName = exports.getLastAutoProvinceName = exports.setManualProvinceName = exports.getManualProvinceName = exports.setLocationMode = exports.getLocationMode = exports.setSearchRadiusKm = exports.getSearchRadiusKm = exports.RADIUS_OPTIONS = exports.setOilPriceSource = exports.getOilPriceSource = exports.setPreferredFuel = exports.getPreferredFuel = exports.OIL_PRICE_SOURCE_OPTIONS = void 0;
/** 应用设置存取（基于 Storage 持久化） */
const KEY_PREFERRED_FUEL = "preferredFuel";
const KEY_OIL_PRICE_SOURCE = "oilPriceSource";
const KEY_SEARCH_RADIUS = "searchRadiusKm";
const KEY_LOCATION_MODE = "locationMode";
const KEY_MANUAL_PROVINCE = "manualProvince";
const KEY_LAST_AUTO_PROVINCE = "lastAutoProvince";
const PRIVATE_STORAGE = { shared: false };
exports.OIL_PRICE_SOURCE_OPTIONS = [
    { value: "soyoujia", label: "搜油价" },
    { value: "autohome", label: "汽车之家" },
    { value: "sinopec", label: "中国石化" },
    { value: "qiyoujiage", label: "汽油价格网" },
];
/** 用户选择的高亮油品，默认 95 号 */
function getPreferredFuel() {
    const v = Storage.get(KEY_PREFERRED_FUEL, PRIVATE_STORAGE);
    if (v === "92" || v === "95" || v === "98" || v === "0") {
        return v;
    }
    return "95";
}
exports.getPreferredFuel = getPreferredFuel;
function setPreferredFuel(code) {
    Storage.set(KEY_PREFERRED_FUEL, code, PRIVATE_STORAGE);
}
exports.setPreferredFuel = setPreferredFuel;
/** 油价数据首选来源，默认搜油价。 */
function getOilPriceSource() {
    const v = Storage.get(KEY_OIL_PRICE_SOURCE, PRIVATE_STORAGE);
    if (v === "soyoujia" ||
        v === "autohome" ||
        v === "sinopec" ||
        v === "qiyoujiage") {
        return v;
    }
    return "soyoujia";
}
exports.getOilPriceSource = getOilPriceSource;
function setOilPriceSource(source) {
    Storage.set(KEY_OIL_PRICE_SOURCE, source, PRIVATE_STORAGE);
}
exports.setOilPriceSource = setOilPriceSource;
/** 附近油站搜索半径（公里），默认 5 公里 */
exports.RADIUS_OPTIONS = [1, 3, 5, 10, 20];
function getSearchRadiusKm() {
    const v = Storage.get(KEY_SEARCH_RADIUS, PRIVATE_STORAGE);
    if (typeof v === "number" && exports.RADIUS_OPTIONS.includes(v)) {
        return v;
    }
    return 5;
}
exports.getSearchRadiusKm = getSearchRadiusKm;
function setSearchRadiusKm(km) {
    Storage.set(KEY_SEARCH_RADIUS, km, PRIVATE_STORAGE);
}
exports.setSearchRadiusKm = setSearchRadiusKm;
/** 首页省份来源：自动定位或手动指定 */
function getLocationMode() {
    const v = Storage.get(KEY_LOCATION_MODE, PRIVATE_STORAGE);
    return v === "manual" ? "manual" : "auto";
}
exports.getLocationMode = getLocationMode;
function setLocationMode(mode) {
    Storage.set(KEY_LOCATION_MODE, mode, PRIVATE_STORAGE);
}
exports.setLocationMode = setLocationMode;
function getManualProvinceName() {
    const v = Storage.get(KEY_MANUAL_PROVINCE, PRIVATE_STORAGE);
    return typeof v === "string" && v.trim() ? v : null;
}
exports.getManualProvinceName = getManualProvinceName;
function setManualProvinceName(name) {
    Storage.set(KEY_MANUAL_PROVINCE, name, PRIVATE_STORAGE);
}
exports.setManualProvinceName = setManualProvinceName;
/** 最近一次自动定位成功匹配到的省份，供小组件定位失败时兜底使用。 */
function getLastAutoProvinceName() {
    const v = Storage.get(KEY_LAST_AUTO_PROVINCE, PRIVATE_STORAGE);
    return typeof v === "string" && v.trim() ? v : null;
}
exports.getLastAutoProvinceName = getLastAutoProvinceName;
function setLastAutoProvinceName(name) {
    Storage.set(KEY_LAST_AUTO_PROVINCE, name, PRIVATE_STORAGE);
}
exports.setLastAutoProvinceName = setLastAutoProvinceName;
