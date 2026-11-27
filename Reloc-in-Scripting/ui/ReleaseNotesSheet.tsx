import {
  Button,
  Markdown,
  NavigationStack,
  Path,
  ScrollView,
  Script,
  useEffect,
  useState,
} from "scripting";
import { STORAGE_KEYS } from "../constants";
import { getStrings, loadActiveLanguage } from "../utils/i18n";
import { isIOS26OrLater } from "./theme";

const CHANGELOG_FILE = "changelog.md";

function normalizeMarkdown(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function hashContent(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function MarkdownChangelogSheet(props: {
  content: string;
  title?: string;
  onDismiss: () => void;
}) {
  const useGlass = isIOS26OrLater();
  const s = getStrings(loadActiveLanguage());

  return (
    <NavigationStack presentationBackground={useGlass ? "clear" : undefined}>
      <ScrollView
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle={props.title ?? s.config.changelogTitle}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={["medium", "large"]}
        presentationBackground={useGlass ? "clear" : undefined}
        padding={{ top: 20, leading: 18, bottom: 20, trailing: 18 }}
        toolbar={{
          topBarTrailing: <Button title={s.common.gotIt} action={props.onDismiss} />,
        }}
      >
        <Markdown
          content={props.content}
          theme="basic"
          useDefaultHighlighterTheme
          scrollable={false}
          background="clear"
        />
      </ScrollView>
    </NavigationStack>
  );
}

export function useMarkdownChangelogSheet(options?: {
  markdownFile?: string;
  storageKey?: string;
  title?: string;
}) {
  const markdownFile = options?.markdownFile ?? CHANGELOG_FILE;
  const storageKey = options?.storageKey ?? STORAGE_KEYS.changelogHash;

  const [content, setContent] = useState("");
  const [contentHash, setContentHash] = useState("");
  const [isPresented, setIsPresented] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadAndCheckFirstRun() {
      try {
        const filePath = Path.join(Script.directory, markdownFile);
        const exists = await FileManager.exists(filePath);
        if (!exists) return;

        const text = normalizeMarkdown(await FileManager.readAsString(filePath));
        if (!text || !active) return;

        const nextHash = hashContent(text);
        setContent(text);
        setContentHash(nextHash);

        const lastSeenHash = Storage.get<string>(storageKey);
        if (lastSeenHash !== nextHash) {
          setIsPresented(true);
        }
      } catch {
        // 忽略读取更新日志失败，不影响主流程启动
      }
    }
    void loadAndCheckFirstRun();
    return () => {
      active = false;
    };
  }, [markdownFile, storageKey]);

  function onChanged(nextPresented: boolean) {
    if (!nextPresented && contentHash) {
      Storage.set(storageKey, contentHash);
    }
    setIsPresented(nextPresented);
  }

  async function openManually() {
    if (!content) {
      try {
        const filePath = Path.join(Script.directory, markdownFile);
        if (await FileManager.exists(filePath)) {
          const text = normalizeMarkdown(await FileManager.readAsString(filePath));
          if (text) {
            setContent(text);
            setContentHash(hashContent(text));
          }
        }
      } catch {
        return;
      }
    }
    setIsPresented(true);
  }

  return {
    hasChangelog: content.length > 0,
    openManually,
    sheetConfig: content
      ? {
          isPresented,
          onChanged,
          content: (
            <MarkdownChangelogSheet
              content={content}
              title={options?.title}
              onDismiss={() => onChanged(false)}
            />
          ),
        }
      : undefined,
  };
}
