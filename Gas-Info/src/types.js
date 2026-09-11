"use strict";
// 油价相关数据类型定义
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFuelPrice = exports.isValidFuelPrice = exports.fuelMeta = exports.FUELS = void 0;
/** 所有支持的油品，顺序与 UI 列表一致 */
exports.FUELS = [
    { code: "92", label: "92号", fullName: "92号汽油" },
    { code: "95", label: "95号", fullName: "95号汽油" },
    { code: "98", label: "98号", fullName: "98号汽油" },
    { code: "0", label: "0号柴油", fullName: "0号柴油" },
];
function fuelMeta(code) {
    return exports.FUELS.find(f => f.code === code) ?? exports.FUELS[1];
}
exports.fuelMeta = fuelMeta;
/** 有效油价必须是大于 0 的数字；0 表示该油品暂无价格。 */
function isValidFuelPrice(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
exports.isValidFuelPrice = isValidFuelPrice;
function formatFuelPrice(value, options) {
    if (!isValidFuelPrice(value)) {
        return "--";
    }
    return `${options?.currency ? "¥" : ""}${value.toFixed(2)}`;
}
exports.formatFuelPrice = formatFuelPrice;
