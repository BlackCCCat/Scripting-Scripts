"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsPage = void 0;
const scripting_1 = require("scripting");
const types_1 = require("./types");
const settings_1 = require("./settings");
const theme_1 = require("./theme");
/** 设置区块容器 */
function SettingSection({ title, children, }) {
    return (createElement(scripting_1.VStack, { alignment: "leading", spacing: 10 },
        createElement(scripting_1.Text, { font: 13, fontWeight: "semibold", foregroundStyle: theme_1.Theme.secondary }, title),
        createElement(scripting_1.VStack, { spacing: 0, glassEffect: theme_1.Theme.glassCard, frame: { maxWidth: "infinity" } }, children)));
}
/** 单个可选行 */
function OptionRow({ label, selected, onTap, showDivider, }) {
    return (createElement(scripting_1.Button, { action: onTap },
        createElement(scripting_1.VStack, { spacing: 0 },
            createElement(scripting_1.HStack, { padding: { horizontal: 14, vertical: 13 } },
                createElement(scripting_1.Text, { font: 16, foregroundStyle: "label" }, label),
                createElement(scripting_1.Spacer, null),
                selected ? (createElement(scripting_1.Image, { systemName: "checkmark", font: 15, fontWeight: "semibold", foregroundStyle: theme_1.Theme.orange })) : null),
            showDivider ? (createElement(scripting_1.Divider, { padding: { leading: 14 } })) : null)));
}
function SettingsPage({ preferred, radiusKm, oilPriceSource, onPreferredChange, onRadiusChange, onOilPriceSourceChange, }) {
    return (createElement(scripting_1.ScrollView, null,
        createElement(scripting_1.VStack, { spacing: 22, alignment: "leading", frame: { maxWidth: "infinity", alignment: "leading" }, padding: { horizontal: 16, top: 12, bottom: 28 } },
            createElement(SettingSection, { title: "\u9996\u9875\u653E\u5927\u663E\u793A\u7684\u6CB9\u54C1" }, types_1.FUELS.map((f, i) => (createElement(OptionRow, { label: f.fullName, selected: f.code === preferred, onTap: () => onPreferredChange(f.code), showDivider: i < types_1.FUELS.length - 1 })))),
            createElement(SettingSection, { title: "\u9644\u8FD1\u52A0\u6CB9\u7AD9\u641C\u7D22\u534A\u5F84" }, settings_1.RADIUS_OPTIONS.map((km, i) => (createElement(OptionRow, { label: `${km} 公里`, selected: km === radiusKm, onTap: () => onRadiusChange(km), showDivider: i < settings_1.RADIUS_OPTIONS.length - 1 })))),
            createElement(SettingSection, { title: "\u6CB9\u4EF7\u6570\u636E\u6E90" }, settings_1.OIL_PRICE_SOURCE_OPTIONS.map((source, i) => (createElement(OptionRow, { label: source.label, selected: source.value === oilPriceSource, onTap: () => onOilPriceSourceChange(source.value), showDivider: i < settings_1.OIL_PRICE_SOURCE_OPTIONS.length - 1 })))),
            createElement(scripting_1.VStack, { alignment: "leading", spacing: 6, padding: { horizontal: 4 } },
                createElement(scripting_1.Text, { font: 12, foregroundStyle: theme_1.Theme.secondary }, "\u6CB9\u4EF7\u6570\u636E\u6765\u81EA\u516C\u5F00\u9875\u9762\uFF0C\u4EC5\u4F9B\u53C2\u8003\u3002"),
                createElement(scripting_1.Text, { font: 12, foregroundStyle: theme_1.Theme.secondary }, "\u5B9E\u9645\u4EF7\u683C\u4EE5\u52A0\u6CB9\u7AD9\u516C\u793A\u4EF7\u683C\u4E3A\u51C6\u3002")))));
}
exports.SettingsPage = SettingsPage;
