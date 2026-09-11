"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useMarkdownReleaseNotesSheet = void 0;
const scripting_1 = require("scripting");
const DEFAULT_CHANGELOG_FILE = "changelog.md";
const PRIVATE_STORAGE = { shared: false };
function normalizeMarkdownContent(content) {
    return content.replace(/\r\n/g, "\n").trim();
}
function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
function MarkdownReleaseNotesSheet(props) {
    const useGlassPresentation = Number.parseInt(scripting_1.Device.systemVersion, 10) >= 26;
    return (createElement(scripting_1.NavigationStack, { presentationBackground: useGlassPresentation ? "clear" : undefined },
        createElement(scripting_1.ScrollView, { background: "clear", scrollContentBackground: "hidden", navigationTitle: props.title ?? "更新说明", navigationBarTitleDisplayMode: "inline", toolbarBackgroundVisibility: "hidden", presentationDragIndicator: "visible", presentationDetents: props.detents ?? ["medium", "large"], presentationBackground: useGlassPresentation ? "clear" : undefined, padding: { top: 24, leading: 18, bottom: 18, trailing: 18 } },
            createElement(scripting_1.Markdown, { content: props.content, theme: props.theme ?? "basic", useDefaultHighlighterTheme: true, scrollable: false, background: "clear" }))));
}
function useMarkdownReleaseNotesSheet(config = {}) {
    const markdownFile = config.markdownFile ?? DEFAULT_CHANGELOG_FILE;
    const storageKey = config.storageKey ?? `release-notes:${markdownFile}:last-seen-hash`;
    const markAsSeenOnDismiss = config.markAsSeenOnDismiss ?? true;
    const [releaseNotesContent, setReleaseNotesContent] = (0, scripting_1.useState)("");
    const [releaseNotesHash, setReleaseNotesHash] = (0, scripting_1.useState)("");
    const [showReleaseNotes, setShowReleaseNotes] = (0, scripting_1.useState)(false);
    (0, scripting_1.useEffect)(() => {
        async function loadReleaseNotes() {
            const filePath = scripting_1.Path.join(scripting_1.Script.directory, markdownFile);
            if (!await FileManager.exists(filePath))
                return;
            const content = normalizeMarkdownContent(await FileManager.readAsString(filePath));
            if (!content)
                return;
            const contentHash = hashString(content);
            const lastSeenHash = Storage.get(storageKey, PRIVATE_STORAGE);
            if (lastSeenHash === contentHash)
                return;
            setReleaseNotesContent(content);
            setReleaseNotesHash(contentHash);
            setShowReleaseNotes(true);
        }
        void loadReleaseNotes();
    }, []);
    function setReleaseNotesPresented(isPresented) {
        if (!isPresented && markAsSeenOnDismiss && releaseNotesHash) {
            Storage.set(storageKey, releaseNotesHash, PRIVATE_STORAGE);
        }
        setShowReleaseNotes(isPresented);
    }
    return {
        isPresented: showReleaseNotes,
        onChanged: setReleaseNotesPresented,
        content: (createElement(MarkdownReleaseNotesSheet, { content: releaseNotesContent, title: config.title, theme: config.theme, detents: config.detents })),
    };
}
exports.useMarkdownReleaseNotesSheet = useMarkdownReleaseNotesSheet;
