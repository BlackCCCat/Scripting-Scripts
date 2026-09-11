"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scripting_1 = require("scripting");
const service_1 = require("./src/service");
const settings_1 = require("./src/settings");
const types_1 = require("./src/types");
const LIGHT_WIDGET_BG = "#F08A24";
const DARK_WIDGET_BG = "#151518";
const TEXT_PRIMARY = "white";
const TEXT_SECONDARY = "rgba(255,255,255,0.72)";
const TEXT_MUTED = "rgba(255,255,255,0.58)";
const CHIP_BG = "rgba(255,255,255,0.17)";
function nextDailyReloadPolicy() {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(0, 15, 0, 0);
    return { policy: "after", date: next };
}
async function resolveWidgetData() {
    const data = await (0, service_1.fetchOilPrices)();
    const preferred = (0, settings_1.getPreferredFuel)();
    const mode = (0, settings_1.getLocationMode)();
    const manualProvinceName = (0, settings_1.getManualProvinceName)();
    if (mode === "manual") {
        const province = (0, service_1.matchProvince)(data.provinces, manualProvinceName) ?? data.provinces[0];
        return { data, province, preferred };
    }
    const locatedProvinceName = await locateProvinceName();
    const locatedProvince = (0, service_1.matchProvince)(data.provinces, locatedProvinceName);
    if (locatedProvince) {
        (0, settings_1.setLastAutoProvinceName)(locatedProvince.province);
        return { data, province: locatedProvince, preferred };
    }
    const cachedProvince = (0, service_1.matchProvince)(data.provinces, (0, settings_1.getLastAutoProvinceName)());
    const province = cachedProvince ?? data.provinces[0];
    return { data, province, preferred };
}
async function locateProvinceName() {
    try {
        if (!Location.isAuthorizedForWidgetUpdates) {
            return null;
        }
        const loc = (await Location.requestCurrent({ forceRequest: true }).catch(() => null)) ?? (await Location.requestCurrent().catch(() => null));
        if (!loc) {
            return null;
        }
        const placemarks = await Location.reverseGeocode({
            latitude: loc.latitude,
            longitude: loc.longitude,
            locale: "zh-CN",
        });
        return placemarks?.[0]?.administrativeArea ?? null;
    }
    catch {
        return null;
    }
}
function WidgetRoot({ resolved }) {
    const transparent = scripting_1.Widget.isTransparentBackground;
    const size = scripting_1.Widget.displaySize;
    if (scripting_1.Widget.family === "systemMedium") {
        return (createElement(MediumOilWidget, { resolved: resolved, transparent: transparent, scale: widgetScale(329, 155) }));
    }
    if (scripting_1.Widget.family === "systemLarge" || scripting_1.Widget.family === "systemExtraLarge") {
        return (createElement(LargeOilWidget, { resolved: resolved, transparent: transparent, scale: widgetScale(329, Math.max(300, size.height)) }));
    }
    return (createElement(SmallOilWidget, { resolved: resolved, transparent: transparent, scale: widgetScale(158, 158) }));
}
function widgetScale(baseWidth, baseHeight) {
    const width = scripting_1.Widget.displaySize.width;
    const height = scripting_1.Widget.displaySize.height;
    const value = Math.min(width / baseWidth, height / baseHeight, 1);
    return { value: Math.max(0.72, value) };
}
function s(scale, value) {
    return Math.round(value * scale.value);
}
function Shell({ children, padding, transparent, radius, }) {
    return (createElement(scripting_1.VStack, { spacing: 0, contentMargins: 0, containerShape: { type: "rect", cornerRadius: radius, style: "continuous" }, clipShape: { type: "rect", cornerRadius: radius, style: "continuous" }, frame: {
            width: scripting_1.Widget.displaySize.width,
            height: scripting_1.Widget.displaySize.height,
        }, widgetBackground: transparent
            ? undefined
            : {
                style: { light: LIGHT_WIDGET_BG, dark: DARK_WIDGET_BG },
                shape: { type: "rect", cornerRadius: radius, style: "continuous" },
            } },
        createElement(scripting_1.VStack, { spacing: 0, padding: padding, frame: { maxWidth: "infinity", maxHeight: "infinity" } }, children)));
}
function TopLine({ province, date, compact, scale, }) {
    return (createElement(scripting_1.HStack, { frame: { maxWidth: "infinity" } },
        createElement(scripting_1.Image, { systemName: "location.fill", font: compact ? s(scale, 11) : s(scale, 15), foregroundStyle: TEXT_PRIMARY }),
        createElement(scripting_1.Text, { font: compact ? s(scale, 13) : s(scale, 19), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY, lineLimit: 1 }, province),
        createElement(scripting_1.Spacer, null),
        createElement(scripting_1.Text, { font: compact ? s(scale, 10) : s(scale, 14), foregroundStyle: TEXT_SECONDARY, lineLimit: 1 }, compact ? date : `更新于: ${date}`)));
}
function PriceLine({ code, price, mode, scale, }) {
    const meta = (0, types_1.fuelMeta)(code);
    const hasPrice = (0, types_1.isValidFuelPrice)(price);
    if (mode === "medium") {
        return (createElement(scripting_1.HStack, { alignment: "firstTextBaseline", spacing: s(scale, 5), frame: { maxWidth: "infinity", alignment: "center" } },
            createElement(scripting_1.Text, { font: s(scale, 15), foregroundStyle: TEXT_SECONDARY, lineLimit: 1 }, meta.fullName),
            hasPrice ? (createElement(scripting_1.Text, { font: s(scale, 21), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY }, "\u00A5")) : null,
            createElement(scripting_1.Text, { font: s(scale, 36), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY, monospacedDigit: true }, (0, types_1.formatFuelPrice)(price)),
            createElement(scripting_1.Text, { font: s(scale, 13), foregroundStyle: TEXT_SECONDARY }, "\u5143/\u5347")));
    }
    if (mode === "large") {
        return (createElement(scripting_1.VStack, { spacing: s(scale, 6), frame: { maxWidth: "infinity", alignment: "center" } },
            createElement(scripting_1.Text, { font: s(scale, 23), foregroundStyle: TEXT_SECONDARY, lineLimit: 1 },
                meta.fullName,
                "(\u5143/\u5347)"),
            createElement(scripting_1.HStack, { alignment: "firstTextBaseline", spacing: 0 },
                hasPrice ? (createElement(scripting_1.Text, { font: s(scale, 44), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY }, "\u00A5")) : null,
                createElement(scripting_1.Text, { font: s(scale, 86), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY, monospacedDigit: true }, (0, types_1.formatFuelPrice)(price)))));
    }
    return (createElement(scripting_1.VStack, { spacing: mode === "small" ? s(scale, 1) : s(scale, 4) },
        createElement(scripting_1.Text, { font: s(scale, 14), foregroundStyle: TEXT_SECONDARY, lineLimit: 1 }, mode === "small" ? meta.fullName : `${meta.fullName}(元/升)`),
        createElement(scripting_1.HStack, { alignment: "firstTextBaseline", spacing: 0 },
            hasPrice ? (createElement(scripting_1.Text, { font: s(scale, 22), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY }, "\u00A5")) : null,
            createElement(scripting_1.Text, { font: s(scale, 38), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY, monospacedDigit: true }, (0, types_1.formatFuelPrice)(price)))));
}
function FuelChip({ code, price, transparent, compact, inline, scale, }) {
    const meta = (0, types_1.fuelMeta)(code);
    const content = inline ? (createElement(scripting_1.HStack, { spacing: s(scale, 3), frame: { maxWidth: "infinity", alignment: "center" } },
        createElement(scripting_1.Text, { font: s(scale, 11), foregroundStyle: TEXT_SECONDARY, lineLimit: 1 }, meta.label),
        createElement(scripting_1.Text, { font: s(scale, 14), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY, lineLimit: 1, monospacedDigit: true }, (0, types_1.formatFuelPrice)(price, { currency: true })))) : (createElement(scripting_1.VStack, { spacing: compact ? 0 : s(scale, 4) },
        createElement(scripting_1.Text, { font: compact ? s(scale, 10) : s(scale, 16), foregroundStyle: TEXT_SECONDARY, lineLimit: 1 }, meta.label),
        createElement(scripting_1.Text, { font: compact ? s(scale, 12) : s(scale, 24), fontWeight: "bold", foregroundStyle: TEXT_PRIMARY, lineLimit: 1, monospacedDigit: true }, (0, types_1.formatFuelPrice)(price, { currency: true }))));
    return (createElement(scripting_1.VStack, { frame: {
            maxWidth: "infinity",
            height: inline ? s(scale, 34) : compact ? s(scale, 32) : s(scale, 66),
        }, padding: {
            horizontal: inline ? s(scale, 3) : compact ? s(scale, 2) : s(scale, 6),
            vertical: inline ? s(scale, 7) : compact ? s(scale, 4) : s(scale, 10),
        }, widgetBackground: transparent
            ? undefined
            : {
                style: CHIP_BG,
                shape: {
                    type: "rect",
                    cornerRadius: compact ? s(scale, 8) : s(scale, 12),
                    style: "continuous",
                },
            } }, content));
}
function OtherFuelChips({ province, preferred, transparent, compact, inline, scale, }) {
    const others = types_1.FUELS.filter(f => f.code !== preferred);
    return (createElement(scripting_1.HStack, { spacing: compact ? s(scale, 4) : s(scale, 8), frame: { maxWidth: "infinity" } }, others.map(f => (createElement(FuelChip, { code: f.code, price: province.prices[f.code], transparent: transparent, compact: compact, inline: inline, scale: scale })))));
}
function ForecastBlock({ data, size, scale, }) {
    const forecast = data.forecast;
    const primary = size === "small"
        ? `下次调价 ${forecast.nextAdjustText} 剩${forecast.remainingDays}天`
        : `下次调价: ${forecast.nextAdjustText} · 剩余 ${forecast.remainingDays} 天`;
    const secondary = forecast.perTon
        ? `预计${forecast.direction}${forecast.perTon}元/吨${forecast.perLiterRange ? ` · ${forecast.perLiterRange}` : ""}`
        : forecast.sourceText;
    return (createElement(scripting_1.VStack, { spacing: s(scale, 1), frame: { maxWidth: "infinity" } },
        createElement(scripting_1.HStack, { spacing: s(scale, 4), frame: { maxWidth: "infinity", alignment: "center" } },
            createElement(scripting_1.Text, { font: size === "small" ? s(scale, 8) : s(scale, 12), fontWeight: "semibold", foregroundStyle: TEXT_SECONDARY, lineLimit: 1, multilineTextAlignment: "center" }, primary)),
        size === "small" ? null : (createElement(scripting_1.Text, { font: s(scale, 10), foregroundStyle: TEXT_MUTED, lineLimit: 1, multilineTextAlignment: "center", frame: { maxWidth: "infinity" } }, secondary))));
}
function LargeForecastBlock({ data, scale, }) {
    const forecast = data.forecast;
    const estimate = forecast.perTon
        ? `预计${forecast.direction}${forecast.perTon}元/吨`
        : forecast.sourceText;
    const perLiter = forecast.perLiterRange
        ? `折合每升${forecast.perLiterRange}`
        : "";
    return (createElement(scripting_1.VStack, { spacing: s(scale, 3), frame: { maxWidth: "infinity" } },
        createElement(scripting_1.HStack, { spacing: s(scale, 4), frame: { maxWidth: "infinity", alignment: "center" } },
            createElement(scripting_1.Image, { systemName: "calendar.badge.clock", font: s(scale, 12), foregroundStyle: TEXT_SECONDARY }),
            createElement(scripting_1.Text, { font: s(scale, 13), fontWeight: "semibold", foregroundStyle: TEXT_SECONDARY, lineLimit: 1, multilineTextAlignment: "center" },
                "\u4E0B\u6B21\u8C03\u4EF7: ",
                forecast.nextAdjustText)),
        createElement(scripting_1.Text, { font: s(scale, 13), fontWeight: "semibold", foregroundStyle: TEXT_SECONDARY, lineLimit: 1, multilineTextAlignment: "center", frame: { maxWidth: "infinity" } },
            "\u5269\u4F59 ",
            forecast.remainingDays,
            " \u5929"),
        createElement(scripting_1.Text, { font: s(scale, 12), foregroundStyle: TEXT_MUTED, lineLimit: 1, multilineTextAlignment: "center", frame: { maxWidth: "infinity" } }, estimate),
        perLiter ? (createElement(scripting_1.Text, { font: s(scale, 11), foregroundStyle: TEXT_MUTED, lineLimit: 1, multilineTextAlignment: "center", frame: { maxWidth: "infinity" } }, perLiter)) : null));
}
function SmallOilWidget({ resolved, transparent, scale, }) {
    const { data, province, preferred } = resolved;
    return (createElement(Shell, { padding: { horizontal: s(scale, 10), vertical: s(scale, 9) }, transparent: transparent, radius: s(scale, 22) },
        createElement(scripting_1.VStack, { spacing: s(scale, 3), frame: { maxWidth: "infinity", maxHeight: "infinity" } },
            createElement(TopLine, { province: province.province, date: province.updatedAt, compact: true, scale: scale }),
            createElement(PriceLine, { code: preferred, price: province.prices[preferred], mode: "small", scale: scale }),
            createElement(OtherFuelChips, { province: province, preferred: preferred, transparent: transparent, compact: true, scale: scale }),
            createElement(ForecastBlock, { data: data, size: "small", scale: scale }))));
}
function MediumOilWidget({ resolved, transparent, scale, }) {
    const { data, province, preferred } = resolved;
    return (createElement(Shell, { padding: { horizontal: s(scale, 12), vertical: s(scale, 9) }, transparent: transparent, radius: s(scale, 24) },
        createElement(scripting_1.VStack, { spacing: s(scale, 5), frame: { maxWidth: "infinity", maxHeight: "infinity" } },
            createElement(TopLine, { province: province.province, date: province.updatedAt, scale: scale }),
            createElement(PriceLine, { code: preferred, price: province.prices[preferred], mode: "medium", scale: scale }),
            createElement(OtherFuelChips, { province: province, preferred: preferred, transparent: transparent, inline: true, scale: scale }),
            createElement(ForecastBlock, { data: data, size: "medium", scale: scale }))));
}
function LargeOilWidget({ resolved, transparent, scale, }) {
    const { data, province, preferred } = resolved;
    return (createElement(Shell, { padding: { horizontal: s(scale, 18), vertical: s(scale, 18) }, transparent: transparent, radius: s(scale, 28) },
        createElement(scripting_1.VStack, { spacing: 0, frame: { maxWidth: "infinity", maxHeight: "infinity" } },
            createElement(TopLine, { province: province.province, date: province.updatedAt, scale: scale }),
            createElement(scripting_1.Spacer, null),
            createElement(PriceLine, { code: preferred, price: province.prices[preferred], mode: "large", scale: scale }),
            createElement(scripting_1.Spacer, null),
            createElement(OtherFuelChips, { province: province, preferred: preferred, transparent: transparent, scale: scale }),
            createElement(scripting_1.Spacer, null),
            createElement(LargeForecastBlock, { data: data, scale: scale }))));
}
async function run() {
    try {
        const resolved = await resolveWidgetData();
        scripting_1.Widget.present(createElement(WidgetRoot, { resolved: resolved }), {
            reloadPolicy: nextDailyReloadPolicy(),
        });
    }
    catch (e) {
        scripting_1.Widget.present(createElement(Shell, { padding: { horizontal: 16, vertical: 16 }, transparent: scripting_1.Widget.isTransparentBackground, radius: 24 },
            createElement(scripting_1.Text, { font: 16, fontWeight: "semibold", foregroundStyle: TEXT_PRIMARY }, "\u6CB9\u4EF7\u6570\u636E\u52A0\u8F7D\u5931\u8D25"),
            createElement(scripting_1.Text, { font: 12, foregroundStyle: TEXT_SECONDARY, padding: { top: 8 } }, e instanceof Error ? e.message : "请打开脚本手动刷新一次")), { reloadPolicy: nextDailyReloadPolicy() });
    }
    scripting_1.Script.exit();
}
void run();
