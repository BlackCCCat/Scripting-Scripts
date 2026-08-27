import {
  Device,
  Markdown,
  NavigationStack,
  Path,
  ScrollView,
  Script,
  useEffect,
  useState,
} from "scripting";

const CHANGELOG_FILE = "changelog.md";
const LAST_SEEN_HASH_KEY = "filestore:release-notes:last-seen-hash";

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function ReleaseNotesSheet({ content }: { content: string }) {
  const useGlassPresentation = Number.parseInt(Device.systemVersion, 10) >= 26;

  return (
    <NavigationStack presentationBackground={useGlassPresentation ? "clear" : undefined}>
      <ScrollView
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle="更新说明"
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={["medium", "large"]}
        presentationBackground={useGlassPresentation ? "clear" : undefined}
        padding={{ top: 24, leading: 18, bottom: 18, trailing: 18 }}
      >
        <Markdown
          content={content}
          theme="basic"
          useDefaultHighlighterTheme
          scrollable={false}
          background="clear"
        />
      </ScrollView>
    </NavigationStack>
  );
}

export function useReleaseNotesSheet() {
  const [content, setContent] = useState("");
  const [contentHash, setContentHash] = useState("");
  const [isPresented, setIsPresented] = useState(false);

  useEffect(() => {
    async function loadReleaseNotes() {
      try {
        const filePath = Path.join(Script.directory, CHANGELOG_FILE);
        if (!(await FileManager.exists(filePath))) return;

        const nextContent = normalizeContent(await FileManager.readAsString(filePath));
        if (!nextContent) return;

        const nextHash = hashString(nextContent);
        if (Storage.get<string>(LAST_SEEN_HASH_KEY) === nextHash) return;

        setContent(nextContent);
        setContentHash(nextHash);
        setIsPresented(true);
      } catch (error) {
        console.log("读取更新说明失败:", error);
      }
    }

    void loadReleaseNotes();
  }, []);

  function setPresented(nextValue: boolean) {
    if (!nextValue && contentHash) {
      Storage.set(LAST_SEEN_HASH_KEY, contentHash);
    }
    setIsPresented(nextValue);
  }

  return {
    isPresented,
    onChanged: setPresented,
    content: <ReleaseNotesSheet content={content} />,
  };
}
