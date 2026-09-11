"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomePage = void 0;
const scripting_1 = require("scripting");
const types_1 = require("./types");
const service_1 = require("./service");
const theme_1 = require("./theme");
const settings_1 = require("./settings");
/** 头部高亮油价卡片 */
function HeaderCard({ province, forecast, preferred, }) {
    const meta = (0, types_1.fuelMeta)(preferred);
    const bigPrice = province.prices[preferred];
    // 头部小卡片展示除高亮油品外的另外 3 个油品
    const others = types_1.FUELS.filter(f => f.code !== preferred);
    return (createElement(scripting_1.VStack, { spacing: 0, padding: { horizontal: 18, top: 18, bottom: 16 }, background: {
            style: (0, scripting_1.gradient)("linear", {
                colors: [...theme_1.Theme.headerGradient],
                startPoint: "topLeading",
                endPoint: "bottomTrailing",
            }),
            shape: theme_1.Theme.glassHeaderCard,
        }, glassEffect: theme_1.Theme.glassHeaderCard, frame: { maxWidth: "infinity" } },
        createElement(scripting_1.HStack, null,
            createElement(scripting_1.Image, { systemName: "location.fill", font: 15, foregroundStyle: "white" }),
            createElement(scripting_1.Text, { font: 18, fontWeight: "bold", foregroundStyle: "white" }, province.province),
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Text, { font: 12, foregroundStyle: "rgba(255,255,255,0.85)" },
                "\u66F4\u65B0\u4E8E: ",
                province.updatedAt)),
        createElement(scripting_1.VStack, { spacing: 2, padding: { top: 12, bottom: 14 } },
            createElement(scripting_1.Text, { font: 15, foregroundStyle: "rgba(255,255,255,0.92)" }, meta.fullName),
            createElement(scripting_1.HStack, { alignment: "firstTextBaseline", spacing: 0 },
                (0, types_1.isValidFuelPrice)(bigPrice) ? (createElement(scripting_1.Text, { font: 26, fontWeight: "bold", foregroundStyle: "white" }, "\u00A5")) : null,
                createElement(scripting_1.Text, { font: 56, fontWeight: "bold", foregroundStyle: "white" }, (0, types_1.formatFuelPrice)(bigPrice)),
                createElement(scripting_1.Text, { font: 16, foregroundStyle: "rgba(255,255,255,0.85)", padding: { leading: 4, bottom: 4 } }, "\u5143/\u5347"))),
        createElement(scripting_1.HStack, { spacing: 10 }, others.map(f => (createElement(scripting_1.VStack, { spacing: 3, frame: { maxWidth: "infinity" }, padding: { vertical: 10 }, background: {
                style: theme_1.Theme.headerChipBg,
                shape: theme_1.Theme.glassSmallCard,
            }, glassEffect: theme_1.Theme.glassSmallCard },
            createElement(scripting_1.Text, { font: 12, foregroundStyle: "rgba(255,255,255,0.85)" }, f.label),
            createElement(scripting_1.Text, { font: 16, fontWeight: "bold", foregroundStyle: "white" }, (0, types_1.formatFuelPrice)(province.prices[f.code], { currency: true })))))),
        createElement(scripting_1.VStack, { spacing: 4, padding: { top: 14 }, frame: { maxWidth: "infinity" } },
            createElement(scripting_1.HStack, { spacing: 6, frame: { maxWidth: "infinity", alignment: "center" } },
                createElement(scripting_1.Image, { systemName: "calendar", font: 13, foregroundStyle: "rgba(255,255,255,0.9)" }),
                createElement(scripting_1.Text, { font: 13, fontWeight: "medium", foregroundStyle: "white" },
                    "\u4E0B\u6B21\u8C03\u4EF7: ",
                    forecast.nextAdjustText,
                    " \u00B7 \u5269\u4F59 ",
                    forecast.remainingDays,
                    " \u5929")),
            createElement(scripting_1.Text, { font: 12, foregroundStyle: "rgba(255,255,255,0.85)", multilineTextAlignment: "center", frame: { maxWidth: "infinity" } }, forecast.sourceText))));
}
/** 全国油价列表中的单个省份卡片 */
function ProvinceRow({ item }) {
    return (createElement(scripting_1.VStack, { spacing: 10, padding: 14, glassEffect: theme_1.Theme.glassCard },
        createElement(scripting_1.HStack, null,
            createElement(scripting_1.Text, { font: 17, fontWeight: "semibold" }, item.province),
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Image, { systemName: "arrow.up.right.square", font: 18, foregroundStyle: theme_1.Theme.orange })),
        createElement(scripting_1.HStack, { spacing: 6 }, types_1.FUELS.map(f => (createElement(scripting_1.VStack, { spacing: 4, frame: { maxWidth: "infinity" } },
            createElement(scripting_1.Text, { font: 12, foregroundStyle: theme_1.Theme.secondary }, f.label),
            createElement(scripting_1.Text, { font: 16, fontWeight: "semibold", foregroundStyle: theme_1.Theme.priceOrange }, (0, types_1.formatFuelPrice)(item.prices[f.code]))))))));
}
function sortModeLabel(mode) {
    switch (mode) {
        case "nameAsc":
            return "名称正序";
        case "nameDesc":
            return "名称倒序";
        case "priceAsc":
            return "价格低到高";
        case "priceDesc":
            return "价格高到低";
        default:
            return "默认排序";
    }
}
function sortProvinces(provinces, mode, preferred) {
    if (mode === "default") {
        return provinces;
    }
    return [...provinces].sort((a, b) => {
        if (mode === "nameAsc" || mode === "nameDesc") {
            const result = a.province.localeCompare(b.province, "zh-Hans-CN");
            return mode === "nameAsc" ? result : -result;
        }
        const aPrice = a.prices[preferred];
        const bPrice = b.prices[preferred];
        const aValid = (0, types_1.isValidFuelPrice)(aPrice);
        const bValid = (0, types_1.isValidFuelPrice)(bPrice);
        if (aValid !== bValid) {
            return aValid ? -1 : 1;
        }
        if (!aValid || !bValid) {
            return a.province.localeCompare(b.province, "zh-Hans-CN");
        }
        const result = aPrice - bPrice;
        return mode === "priceAsc" ? result : -result;
    });
}
function SortMenu({ value, onChange, }) {
    const options = [
        { value: "default", title: "默认排序" },
        { value: "nameAsc", title: "名称正序" },
        { value: "nameDesc", title: "名称倒序" },
        { value: "priceAsc", title: "价格低到高" },
        { value: "priceDesc", title: "价格高到低" },
    ];
    return (createElement(scripting_1.Menu, { label: createElement(scripting_1.HStack, { spacing: 4 },
            createElement(scripting_1.Text, { font: 13, fontWeight: "medium", foregroundStyle: theme_1.Theme.orange }, sortModeLabel(value)),
            createElement(scripting_1.Image, { systemName: "arrow.up.arrow.down", font: 13, foregroundStyle: theme_1.Theme.orange })) }, options.map(option => (createElement(scripting_1.Button, { title: option.title, systemImage: option.value === value ? "checkmark" : undefined, action: () => onChange(option.value) })))));
}
function DetailRow({ code, price }) {
    const meta = (0, types_1.fuelMeta)(code);
    return (createElement(scripting_1.VStack, { spacing: 0 },
        createElement(scripting_1.HStack, { padding: { horizontal: 12, vertical: 14 } },
            createElement(scripting_1.Image, { systemName: "fuelpump", font: 22, foregroundStyle: theme_1.Theme.orange, frame: { width: 30 } }),
            createElement(scripting_1.Text, { font: 20, fontWeight: "medium" }, meta.fullName),
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Text, { font: 22, fontWeight: "bold", foregroundStyle: theme_1.Theme.priceOrange }, (0, types_1.formatFuelPrice)(price, { currency: true })),
            createElement(scripting_1.Text, { font: 14, foregroundStyle: theme_1.Theme.secondary, padding: { leading: 4 } }, "\u5143/\u5347")),
        createElement(scripting_1.Divider, { padding: { leading: 52 } })));
}
const TREND_COLORS = {
    "92": "#F5A623",
    "95": "#E85D3F",
    "98": "#4A90E2",
    "0": "#49A078",
};
function trendDateLabel(date) {
    const parts = date.split("-");
    return parts.length === 3
        ? `${Number(parts[1])}/${Number(parts[2])}`
        : date;
}
function OilPriceTrendCard({ province, source, }) {
    const supportsHistory = (0, service_1.supportsOilPriceHistory)(source);
    const [trend, setTrend] = (0, scripting_1.useState)(null);
    const [loading, setLoading] = (0, scripting_1.useState)(supportsHistory);
    const [message, setMessage] = (0, scripting_1.useState)(supportsHistory ? null : (0, service_1.oilPriceHistoryUnavailableText)(source));
    const [selectedLabel, setSelectedLabel] = (0, scripting_1.useState)(null);
    (0, scripting_1.useEffect)(() => {
        let cancelled = false;
        setSelectedLabel(null);
        if (!(0, service_1.supportsOilPriceHistory)(source)) {
            setTrend(null);
            setLoading(false);
            setMessage((0, service_1.oilPriceHistoryUnavailableText)(source));
            return () => {
                cancelled = true;
            };
        }
        setTrend(null);
        setLoading(true);
        setMessage(null);
        (0, service_1.fetchOilPriceHistory)(province.province, source)
            .then(result => {
            if (!cancelled) {
                setTrend(result);
            }
        })
            .catch(error => {
            if (!cancelled) {
                setMessage(error instanceof Error ? error.message : "历史趋势加载失败");
            }
        })
            .finally(() => {
            if (!cancelled) {
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [province.province, source]);
    const marks = trend
        ? trend.points.flatMap(point => types_1.FUELS.flatMap(fuel => {
            const price = point.prices[fuel.code];
            const label = trendDateLabel(point.date);
            return (0, types_1.isValidFuelPrice)(price)
                ? [
                    {
                        label,
                        value: price,
                        category: fuel.label,
                        interpolationMethod: "catmullRom",
                        symbol: "circle",
                        symbolSize: selectedLabel === label ? 42 : 18,
                        lineStyle: { lineWidth: 2 },
                    },
                ]
                : [];
        }))
        : [];
    const lastLabel = trend?.points.length
        ? trendDateLabel(trend.points[trend.points.length - 1].date)
        : "";
    const selectedPoint = trend?.points.find(point => trendDateLabel(point.date) === selectedLabel);
    return (createElement(scripting_1.VStack, { alignment: "leading", spacing: 12, padding: 16, glassEffect: theme_1.Theme.glassCard, frame: { maxWidth: "infinity", alignment: "leading" } },
        createElement(scripting_1.HStack, { spacing: 8, frame: { maxWidth: "infinity" } },
            createElement(scripting_1.Image, { systemName: "chart.xyaxis.line", font: 17, foregroundStyle: theme_1.Theme.orange }),
            createElement(scripting_1.Text, { font: 18, fontWeight: "semibold" }, "\u6CB9\u4EF7\u8D8B\u52BF"),
            createElement(scripting_1.Spacer, null),
            trend ? (createElement(scripting_1.Text, { font: 12, foregroundStyle: theme_1.Theme.secondary },
                trend.points.length,
                " \u6B21\u8C03\u4EF7")) : null),
        loading ? (createElement(scripting_1.HStack, { spacing: 8, padding: { vertical: 48 }, frame: { maxWidth: "infinity", alignment: "center" } },
            createElement(scripting_1.ProgressView, null),
            createElement(scripting_1.Text, { font: 14, foregroundStyle: theme_1.Theme.secondary }, "\u6B63\u5728\u52A0\u8F7D\u5386\u53F2\u6CB9\u4EF7\u2026"))) : trend && marks.length ? (createElement(scripting_1.VStack, { spacing: 10, frame: { maxWidth: "infinity" } },
            createElement(scripting_1.HStack, { spacing: 12, frame: { maxWidth: "infinity" } }, types_1.FUELS.map(fuel => (createElement(scripting_1.HStack, { spacing: 4, frame: { maxWidth: "infinity" } },
                createElement(scripting_1.Text, { font: 10, foregroundStyle: TREND_COLORS[fuel.code] }, "\u25CF"),
                createElement(scripting_1.Text, { font: 11, foregroundStyle: theme_1.Theme.secondary }, fuel.label))))),
            createElement(scripting_1.Chart, { chartXAxis: "visible", chartYAxis: "visible", chartLegend: "hidden", chartScrollableAxes: "horizontal", chartXVisibleDomain: 7, chartScrollPositionX: lastLabel, chartXSelection: {
                    valueType: "string",
                    value: selectedLabel,
                    onChanged: (value) => setSelectedLabel(value ?? null),
                }, chartForegroundStyleScale: {
                    "92号": TREND_COLORS["92"],
                    "95号": TREND_COLORS["95"],
                    "98号": TREND_COLORS["98"],
                    "0号柴油": TREND_COLORS["0"],
                }, frame: { height: 260, maxWidth: "infinity" } },
                createElement(scripting_1.LineCategoryChart, { labelOnYAxis: false, marks: marks })),
            selectedPoint ? (createElement(scripting_1.VStack, { spacing: 7, frame: { maxWidth: "infinity" } },
                createElement(scripting_1.Text, { font: 12, fontWeight: "semibold" },
                    selectedPoint.date,
                    " \u00B7 \u5143/\u5347"),
                createElement(scripting_1.HStack, { spacing: 8, frame: { maxWidth: "infinity" } }, types_1.FUELS.map(fuel => (createElement(scripting_1.VStack, { spacing: 2, frame: { maxWidth: "infinity" } },
                    createElement(scripting_1.Text, { font: 10, foregroundStyle: theme_1.Theme.secondary }, fuel.label),
                    createElement(scripting_1.Text, { font: 12, fontWeight: "semibold", foregroundStyle: TREND_COLORS[fuel.code] }, (0, types_1.formatFuelPrice)(selectedPoint.prices[fuel.code], {
                        currency: true,
                    })))))))) : (createElement(scripting_1.Text, { font: 11, foregroundStyle: theme_1.Theme.secondary, frame: { maxWidth: "infinity", alignment: "center" } }, "\u8F7B\u89E6\u6570\u636E\u70B9\u67E5\u770B\u4EF7\u683C \u00B7 \u5DE6\u53F3\u6ED1\u52A8\u67E5\u770B\u5168\u90E8\u5386\u53F2")))) : (createElement(scripting_1.Text, { font: 14, foregroundStyle: theme_1.Theme.secondary, multilineTextAlignment: "leading", frame: { maxWidth: "infinity", alignment: "leading" } }, message ?? "暂无历史趋势数据"))));
}
function ProvinceDetailPage({ province, forecast, preferred, source, oilPriceSource, }) {
    return (createElement(scripting_1.ScrollView, null,
        createElement(scripting_1.VStack, { navigationTitle: province.province, navigationBarTitleDisplayMode: "inline", spacing: 18, padding: { horizontal: 16, top: 12, bottom: 28 }, alignment: "leading" },
            createElement(HeaderCard, { province: province, forecast: forecast, preferred: preferred }),
            createElement(scripting_1.HStack, { frame: { maxWidth: "infinity" } },
                createElement(scripting_1.VStack, { spacing: 8, frame: { maxWidth: "infinity" } },
                    createElement(scripting_1.Text, { font: 18, fontWeight: "bold", foregroundStyle: theme_1.Theme.orange }, "\u6CB9\u4EF7\u8BE6\u60C5"),
                    createElement(scripting_1.HStack, { frame: { height: 2, maxWidth: "infinity" }, background: theme_1.Theme.orange }))),
            createElement(scripting_1.VStack, { spacing: 0, glassEffect: theme_1.Theme.glassCard, frame: { maxWidth: "infinity", alignment: "leading" } }, types_1.FUELS.map(f => (createElement(DetailRow, { code: f.code, price: province.prices[f.code] })))),
            createElement(OilPriceTrendCard, { province: province, source: oilPriceSource }),
            createElement(scripting_1.VStack, { alignment: "leading", spacing: 8, padding: 16, glassEffect: theme_1.Theme.glassCard, frame: { maxWidth: "infinity", alignment: "leading" } },
                createElement(scripting_1.HStack, { spacing: 8, frame: { maxWidth: "infinity", alignment: "leading" } },
                    createElement(scripting_1.Image, { systemName: "info.circle", font: 16, foregroundStyle: theme_1.Theme.orange }),
                    createElement(scripting_1.Text, { font: 17, fontWeight: "semibold" }, "\u8BF4\u660E")),
                createElement(scripting_1.Text, { font: 14, foregroundStyle: theme_1.Theme.secondary, frame: { maxWidth: "infinity", alignment: "leading" } },
                    "\u00B7 \u6CB9\u4EF7\u6570\u636E\u6765\u6E90\u4E8E ",
                    source),
                createElement(scripting_1.Text, { font: 14, foregroundStyle: theme_1.Theme.secondary, frame: { maxWidth: "infinity", alignment: "leading" } }, "\u00B7 \u5B9E\u9645\u4EF7\u683C\u4EE5\u52A0\u6CB9\u7AD9\u516C\u793A\u4EF7\u683C\u4E3A\u51C6")))));
}
function ProvinceSelectorPage({ provinces, autoProvince, autoLocatedName, selectedProvince, mode, onUseAuto, onSelectManual, }) {
    const dismiss = scripting_1.Navigation.useDismiss();
    const [query, setQuery] = (0, scripting_1.useState)("");
    const keyword = (0, service_1.normalizeProvinceName)(query);
    const filtered = keyword
        ? provinces.filter(p => (0, service_1.normalizeProvinceName)(p.province).includes(keyword))
        : provinces;
    function chooseAuto() {
        onUseAuto();
        dismiss();
    }
    function chooseManual(province) {
        onSelectManual(province);
        dismiss();
    }
    return (createElement(scripting_1.ScrollView, null,
        createElement(scripting_1.VStack, { navigationTitle: "\u9009\u62E9\u5730\u533A", navigationBarTitleDisplayMode: "inline", spacing: 14, padding: { horizontal: 16, top: 14, bottom: 28 }, alignment: "leading" },
            createElement(scripting_1.TextField, { title: "", value: query, onChanged: setQuery, prompt: "\u8F93\u5165\u7701\u4EFD\u540D\u79F0\u641C\u7D22\uFF0C\u5982\uFF1A\u6E56\u5317", textFieldStyle: "roundedBorder" }),
            createElement(scripting_1.Button, { action: chooseAuto },
                createElement(scripting_1.VStack, { padding: mode === "auto" ? 2 : 0, background: mode === "auto" ? theme_1.Theme.orange : "rgba(0,0,0,0.001)", clipShape: { type: "rect", cornerRadius: 14 }, frame: { maxWidth: "infinity" } },
                    createElement(scripting_1.HStack, { spacing: 14, padding: { horizontal: 16, vertical: 14 }, glassEffect: theme_1.Theme.glassSmallCard, frame: { maxWidth: "infinity" } },
                        createElement(scripting_1.Image, { systemName: "location.fill", font: 28, foregroundStyle: theme_1.Theme.orange }),
                        createElement(scripting_1.VStack, { alignment: "leading", spacing: 4 },
                            createElement(scripting_1.Text, { font: 18, fontWeight: "bold" }, "\u81EA\u52A8\u5B9A\u4F4D"),
                            createElement(scripting_1.Text, { font: 14, foregroundStyle: theme_1.Theme.secondary }, autoLocatedName ?? autoProvince.province)),
                        createElement(scripting_1.Spacer, null),
                        mode === "auto" ? (createElement(scripting_1.Image, { systemName: "checkmark", font: 20, fontWeight: "semibold", foregroundStyle: theme_1.Theme.orange })) : null))),
            createElement(scripting_1.VStack, { spacing: 10, frame: { maxWidth: "infinity" } }, filtered.map(p => {
                const selected = mode === "manual" && p.province === selectedProvince.province;
                return (createElement(scripting_1.Button, { action: () => chooseManual(p) },
                    createElement(scripting_1.HStack, { padding: { horizontal: 16, vertical: 16 }, glassEffect: theme_1.Theme.glassSmallCard, frame: { maxWidth: "infinity" } },
                        createElement(scripting_1.Text, { font: 18 }, p.province),
                        createElement(scripting_1.Spacer, null),
                        selected ? (createElement(scripting_1.Image, { systemName: "checkmark", font: 16, fontWeight: "semibold", foregroundStyle: theme_1.Theme.orange })) : null)));
            })))));
}
function HomePage({ preferred, oilPriceSource, }) {
    const [data, setData] = (0, scripting_1.useState)(null);
    const [loading, setLoading] = (0, scripting_1.useState)(true);
    const [resolvingProvince, setResolvingProvince] = (0, scripting_1.useState)(true);
    const [refreshing, setRefreshing] = (0, scripting_1.useState)(false);
    const [error, setError] = (0, scripting_1.useState)(null);
    const [autoProvince, setAutoProvince] = (0, scripting_1.useState)(null);
    const [locatedName, setLocatedName] = (0, scripting_1.useState)(null);
    const [locationModeState, setLocationModeState] = (0, scripting_1.useState)((0, settings_1.getLocationMode)());
    const [manualProvinceName, setManualProvinceNameState] = (0, scripting_1.useState)((0, settings_1.getManualProvinceName)());
    const [sortMode, setSortMode] = (0, scripting_1.useState)("default");
    async function requestCurrentProvinceName(forceRefresh) {
        try {
            const loc = await Location.requestCurrent({ forceRequest: forceRefresh });
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
    async function load(forceRefresh = false) {
        if (forceRefresh) {
            setRefreshing(true);
        }
        else {
            setLoading(true);
        }
        setResolvingProvince(true);
        setError(null);
        try {
            const provinceNamePromise = requestCurrentProvinceName(forceRefresh);
            const result = await (0, service_1.fetchOilPrices)({
                forceRefresh,
                preferredSource: oilPriceSource,
            });
            setData(result);
            const cachedAutoProvince = (0, service_1.matchProvince)(result.provinces, (0, settings_1.getLastAutoProvinceName)());
            if (locationModeState === "auto" && cachedAutoProvince) {
                setAutoProvince(cachedAutoProvince);
                setLocatedName(cachedAutoProvince.province);
            }
            const provinceName = await provinceNamePromise;
            const matched = (0, service_1.matchProvince)(result.provinces, provinceName);
            const displayProvince = matched ?? cachedAutoProvince ?? result.provinces[0];
            if (matched) {
                (0, settings_1.setLastAutoProvinceName)(matched.province);
            }
            setAutoProvince(displayProvince);
            setLocatedName(provinceName ?? displayProvince.province);
            if (forceRefresh) {
                scripting_1.Widget.reloadAll();
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "油价数据加载失败");
        }
        finally {
            setLoading(false);
            setResolvingProvince(false);
            setRefreshing(false);
        }
    }
    (0, scripting_1.useEffect)(() => {
        load();
    }, [oilPriceSource]);
    const manualProvince = data
        ? (0, service_1.matchProvince)(data.provinces, manualProvinceName)
        : null;
    const headerProvince = locationModeState === "manual"
        ? manualProvince ??
            (!resolvingProvince ? autoProvince ?? data?.provinces[0] ?? null : null)
        : autoProvince ?? (!resolvingProvince ? data?.provinces[0] ?? null : null);
    const others = data
        ? sortProvinces(data.provinces.filter(p => p.province !== headerProvince?.province), sortMode, preferred)
        : [];
    const selectorDestination = data && headerProvince ? (createElement(ProvinceSelectorPage, { provinces: data.provinces, autoProvince: autoProvince ?? data.provinces[0], autoLocatedName: locatedName, selectedProvince: headerProvince, mode: locationModeState, onUseAuto: () => {
            (0, settings_1.setLocationMode)("auto");
            setLocationModeState("auto");
            scripting_1.Widget.reloadAll();
        }, onSelectManual: province => {
            (0, settings_1.setLocationMode)("manual");
            (0, settings_1.setManualProvinceName)(province.province);
            setLocationModeState("manual");
            setManualProvinceNameState(province.province);
            scripting_1.Widget.reloadAll();
        } })) : null;
    return (createElement(scripting_1.ScrollView, { toolbar: {
            ...(selectorDestination && headerProvince
                ? {
                    topBarLeading: (createElement(scripting_1.NavigationLink, { destination: selectorDestination },
                        createElement(scripting_1.HStack, { spacing: 4 },
                            createElement(scripting_1.Image, { systemName: locationModeState === "auto"
                                    ? "location.fill"
                                    : "mappin.circle.fill", font: 13, foregroundStyle: theme_1.Theme.orange }),
                            createElement(scripting_1.Text, { font: 14, fontWeight: "semibold", foregroundStyle: theme_1.Theme.orange }, headerProvince.province),
                            createElement(scripting_1.Image, { systemName: "chevron.down", font: 10, foregroundStyle: theme_1.Theme.orange })))),
                }
                : {}),
            topBarTrailing: (createElement(scripting_1.Button, { title: "", systemImage: "arrow.clockwise", action: () => load(true), disabled: refreshing })),
        } },
        createElement(scripting_1.VStack, { spacing: 16, padding: { horizontal: 16, top: 8, bottom: 24 }, alignment: "leading" }, (loading && !data) || (data && resolvingProvince && !headerProvince) ? (createElement(scripting_1.HStack, { frame: { maxWidth: "infinity", minHeight: 200 } },
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.VStack, { spacing: 10 },
                createElement(scripting_1.Image, { systemName: "fuelpump.fill", font: 32, foregroundStyle: theme_1.Theme.orange }),
                createElement(scripting_1.Text, { foregroundStyle: theme_1.Theme.secondary }, data ? "正在确认省份…" : "加载中…")),
            createElement(scripting_1.Spacer, null))) : error ? (createElement(scripting_1.VStack, { spacing: 12, padding: { vertical: 40 }, frame: { maxWidth: "infinity" } },
            createElement(scripting_1.Image, { systemName: "exclamationmark.triangle", font: 30, foregroundStyle: theme_1.Theme.orange }),
            createElement(scripting_1.Text, { foregroundStyle: theme_1.Theme.secondary }, error),
            createElement(scripting_1.Button, { title: "\u91CD\u65B0\u52A0\u8F7D", action: () => load() }))) : data && headerProvince ? (createElement(Fragment, null,
            createElement(scripting_1.NavigationLink, { destination: createElement(ProvinceDetailPage, { province: headerProvince, forecast: data.forecast, preferred: preferred, source: data.source, oilPriceSource: oilPriceSource }) },
                createElement(HeaderCard, { province: headerProvince, forecast: data.forecast, preferred: preferred })),
            createElement(scripting_1.HStack, { padding: { top: 4 }, frame: { maxWidth: "infinity" } },
                createElement(scripting_1.Text, { font: 20, fontWeight: "bold" }, "\u5168\u56FD\u6CB9\u4EF7"),
                createElement(scripting_1.Spacer, null),
                createElement(SortMenu, { value: sortMode, onChange: setSortMode })),
            createElement(scripting_1.VStack, { spacing: 12, alignment: "leading" }, others.map(p => (createElement(scripting_1.NavigationLink, { destination: createElement(ProvinceDetailPage, { province: p, forecast: data.forecast, preferred: preferred, source: data.source, oilPriceSource: oilPriceSource }) },
                createElement(ProvinceRow, { item: p }))))))) : (createElement(scripting_1.Text, { foregroundStyle: theme_1.Theme.secondary }, "\u6682\u65E0\u6570\u636E")))));
}
exports.HomePage = HomePage;
