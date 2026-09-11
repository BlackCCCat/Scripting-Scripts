"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scripting_1 = require("scripting");
const settings_1 = require("./src/settings");
const HomePage_1 = require("./src/HomePage");
const NearbyPage_1 = require("./src/NearbyPage");
const SettingsPage_1 = require("./src/SettingsPage");
const ReleaseNotesSheet_1 = require("./src/ReleaseNotesSheet");
const theme_1 = require("./src/theme");
/** 给页面套上导航标题的容器 */
function Page({ title, children, }) {
    return (createElement(scripting_1.VStack, { navigationTitle: title, navigationBarTitleDisplayMode: "inline", frame: { maxWidth: "infinity", maxHeight: "infinity" } }, children));
}
function App() {
    const selection = (0, scripting_1.useObservable)(0);
    const releaseNotesSheet = (0, ReleaseNotesSheet_1.useMarkdownReleaseNotesSheet)({
        markdownFile: "changelog.md",
        storageKey: "today-oil-price:release-notes:last-seen-hash",
        title: "更新内容",
    });
    const [preferred, setPreferred] = (0, scripting_1.useState)((0, settings_1.getPreferredFuel)());
    const [radiusKm, setRadiusKm] = (0, scripting_1.useState)((0, settings_1.getSearchRadiusKm)());
    const [oilPriceSource, setOilPriceSourceState] = (0, scripting_1.useState)((0, settings_1.getOilPriceSource)());
    function changePreferred(code) {
        (0, settings_1.setPreferredFuel)(code);
        setPreferred(code);
        scripting_1.Widget.reloadAll();
    }
    function changeRadius(km) {
        (0, settings_1.setSearchRadiusKm)(km);
        setRadiusKm(km);
    }
    function changeOilPriceSource(source) {
        (0, settings_1.setOilPriceSource)(source);
        setOilPriceSourceState(source);
        scripting_1.Widget.reloadAll();
    }
    return (createElement(scripting_1.TabView, { selection: selection, tint: theme_1.Theme.orange, sheet: releaseNotesSheet },
        createElement(scripting_1.NavigationStack, { tabItem: createElement(scripting_1.Label, { title: "\u6CB9\u4EF7", systemImage: "fuelpump.fill" }), tag: 0 },
            createElement(Page, { title: "\u4ECA\u65E5\u6CB9\u4EF7" },
                createElement(HomePage_1.HomePage, { preferred: preferred, oilPriceSource: oilPriceSource }))),
        createElement(scripting_1.NavigationStack, { tabItem: createElement(scripting_1.Label, { title: "\u9644\u8FD1\u6CB9\u7AD9", systemImage: "mappin.and.ellipse" }), tag: 1 },
            createElement(Page, { title: "\u9644\u8FD1\u6CB9\u7AD9" },
                createElement(NearbyPage_1.NearbyPage, { radiusKm: radiusKm }))),
        createElement(scripting_1.NavigationStack, { tabItem: createElement(scripting_1.Label, { title: "\u8BBE\u7F6E", systemImage: "gearshape.fill" }), tag: 2 },
            createElement(Page, { title: "\u8BBE\u7F6E" },
                createElement(SettingsPage_1.SettingsPage, { preferred: preferred, radiusKm: radiusKm, oilPriceSource: oilPriceSource, onPreferredChange: changePreferred, onRadiusChange: changeRadius, onOilPriceSourceChange: changeOilPriceSource })))));
}
async function run() {
    await scripting_1.Navigation.present({ element: createElement(App, null) });
    scripting_1.Script.exit();
}
run();
