// File: components/HomeView.tsx
import {
  Button,
  Editor,
  Image,
  List,
  Navigation,
  NavigationStack,
  Script,
  Rectangle,
  RoundedRectangle,
  Section,
  Divider,
  Spacer,
  Text,
  HStack,
  VStack,
  ZStack,
  ScrollView,
  ScrollViewReader,
  ProgressView,
  useColorScheme,
  useEffect,
  useObservable,
  useRef,
  useState,
  Markdown,
  Path,
} from "scripting";

import {
  loadConfig,
  type AppConfig,
  type HomeSectionKey,
  type ProSchemeKey,
  PRO_KEYS,
} from "../utils/config";
import { SettingsView } from "./SettingsView";
import { AdaptiveHomeTabView } from "./AdaptiveHomeTabView";
import { useMarkdownReleaseNotesSheet } from "./MarkdownReleaseNotesSheet";
import { loadMetaAsync, type MetaBundle } from "../utils/meta";
import {
  detectRimeDir,
  verifyInstallPathAccess,
  collectRimeCandidates,
} from "../utils/hamster";
import {
  getCheckCacheKey,
  loadSharedCheckCache,
  saveSharedCheckCache,
} from "../utils/check_cache";
import {
  checkAllUpdates,
  updateScheme,
  updateDict,
  updateModel,
  autoUpdateAll,
  deployInputMethod,
  type AllUpdateResult,
} from "../utils/update_tasks";
import { clearWanxiangTempFiles } from "../utils/cache_cleanup";
import { normalizePath, sleep } from "../utils/common";
import { isModelUpdateAvailable, modelDisplayMark } from "../utils/model_mark";

const FULLSCREEN_SYMBOL =
  "arrow.up.left.and.down.right.and.arrow.up.right.and.down.left";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function readFraction(x: any): number | undefined {
  const toNum = (v: any) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const direct = toNum(x);
  if (direct !== undefined) return direct;

  const p1 = toNum(x?.percent);
  if (p1 !== undefined) return p1;

  const p2 = toNum(x?.fractionCompleted);
  if (p2 !== undefined) return p2;

  const p3 = toNum(x?.progress?.fractionCompleted);
  if (p3 !== undefined) return p3;

  return undefined;
}

function pctFromFraction(f?: number) {
  const v = typeof f === "number" && Number.isFinite(f) ? clamp01(f) : 0;
  return `${(v * 100).toFixed(2)}%`;
}

function selectedSchemeFromConfig(cfg: AppConfig): string {
  if (cfg.schemeEdition === "base") return "base";
  if (cfg.schemeEdition === "pure") return "pure";
  return `pro (${cfg.proSchemeKey})`;
}

function normalizeMetaScheme(
  metaScheme: MetaBundle["scheme"],
  fallback: AppConfig,
): {
  selected: string;
  schemeEdition?: AppConfig["schemeEdition"];
  proSchemeKey?: ProSchemeKey;
} {
  if (!metaScheme) return { selected: selectedSchemeFromConfig(fallback) };
  const edition = metaScheme.schemeEdition;
  const proKey = metaScheme.proSchemeKey;
  const validProKey =
    proKey && (PRO_KEYS as string[]).includes(proKey) ? proKey : undefined;
  const selected =
    metaScheme.selectedScheme ??
    (edition === "base"
      ? "base"
      : edition === "pure"
        ? "pure"
      : edition === "pro"
        ? `pro (${validProKey ?? fallback.proSchemeKey})`
        : selectedSchemeFromConfig(fallback));
  return {
    selected,
    schemeEdition: edition,
    proSchemeKey:
      edition === "pro" ? (validProKey ?? fallback.proSchemeKey) : undefined,
  };
}

function FloatingActionButton(props: {
  icon: string;
  title?: string;
  color?: string;
  disabled?: boolean;
  size?: number;
  iconSize?: string;
  onPress: () => void;
}) {
  const size = props.size ?? 58;
  const tintColor: any = props.disabled
    ? "secondaryLabel"
    : (props.color ?? "systemBlue");

  function triggerPress() {
    try {
      (globalThis as any).HapticFeedback?.mediumImpact?.();
    } catch {}
    props.onPress();
  }

  return (
    <Button
      action={triggerPress}
      disabled={props.disabled}
      buttonStyle="glass"
      buttonBorderShape="circle"
      controlSize="regular"
      tint={tintColor}
      frame={{ width: size, height: size }}
    >
      <VStack
        frame={{ width: size, height: size, alignment: "center" as any }}
      >
        <Image
          systemName={props.icon}
          font={(props.iconSize ?? "title3") as any}
          foregroundStyle={tintColor}
        />
      </VStack>
    </Button>
  );
}

type ActionClusterItem = {
  icon: string;
  title: string;
  color?: string;
  disabled?: boolean;
  onPress: () => void;
};

function FloatingActionGroup(props: {
  icon: string;
  color?: string;
  expanded: boolean;
  disabled?: boolean;
  items: ActionClusterItem[];
  onToggle: () => void;
}) {
  return (
    <HStack spacing={18} frame={{ maxWidth: "infinity", alignment: "trailing" as any }}>
      {props.expanded ? (
        <HStack spacing={18}>
          {props.items.map((item) => (
            <FloatingActionButton
              key={item.title}
              icon={item.icon}
              title={item.title}
              color={item.color}
              disabled={item.disabled}
              size={50}
              iconSize="title3"
              onPress={item.onPress}
            />
          ))}
        </HStack>
      ) : null}
      <FloatingActionButton
        icon={props.expanded ? "xmark" : props.icon}
        color={props.color}
        disabled={props.disabled}
        size={56}
        iconSize="title2"
        onPress={props.onToggle}
      />
    </HStack>
  );
}

function RowKV(props: { k: string; v: string; valueColor?: string }) {
  return (
    <HStack>
      <Text>{props.k}</Text>
      <Spacer />
      <Text foregroundStyle={(props.valueColor ?? "label") as any}>{props.v}</Text>
    </HStack>
  );
}

type AlertNode = any;
type AlertState = {
  title: string;
  isPresented: boolean;
  message: AlertNode;
  actions: AlertNode;
};

type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS";
type LogScope =
  | "SYSTEM"
  | "CHECK"
  | "SCHEME"
  | "DICT"
  | "MODEL"
  | "AUTO"
  | "DEPLOY"
  | "PATH";

type LogEntry = {
  id: string;
  at: string;
  level: LogLevel;
  scope: LogScope;
  message: string;
};

type UpdateDecision = {
  scheme: boolean;
  dict: boolean;
  model: boolean;
};

type HomeSessionState = {
  remoteSchemeVer: string;
  remoteDictMark: string;
  remoteModelMark: string;
  notes: string;
  lastCheck: AllUpdateResult | null;
  lastCheckDecision: UpdateDecision | null;
  lastCheckKey: string;
  logs: LogEntry[];
};

const MAIN_TAB = 1;

type FileBrowserEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

const DEFAULT_HOME_SESSION_STATE: HomeSessionState = {
  remoteSchemeVer: "请检查更新",
  remoteDictMark: "请检查更新",
  remoteModelMark: "请检查更新",
  notes: "请检查更新",
  lastCheck: null,
  lastCheckDecision: null,
  lastCheckKey: "",
  logs: [],
};

let homeSessionState: HomeSessionState = { ...DEFAULT_HOME_SESSION_STATE };
let launchAutoCheckHandled = false;
let lastHandledLaunchActionKey = "";

function nowTimeLabel(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function makeLogEntry(
  level: LogLevel,
  scope: LogScope,
  message: string,
): LogEntry {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: nowTimeLabel(),
    level,
    scope,
    message: String(message ?? "").trim(),
  };
}

function formatLogEntry(entry: LogEntry): string {
  return `${entry.at} [${entry.level}] [${entry.scope}] ${entry.message}`;
}

function replacePathPrefix(message: string, rootPath: string): string {
  const root = String(rootPath ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!root) return message;
  const slash = root.lastIndexOf("/");
  const rootName = slash >= 0 ? root.slice(slash + 1) : root;
  if (!rootName) return message;
  const variants = new Set<string>([root]);
  if (root.startsWith("/private/")) variants.add(root.slice("/private".length));
  else if (root.startsWith("/")) variants.add(`/private${root}`);
  let out = message;
  for (const variant of variants) {
    out = out.split(variant).join(rootName);
  }
  return out;
}

function normalizeMark(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function schemeRemoteDisplayMark(
  cfg: AppConfig,
  remote: AllUpdateResult["scheme"] | null | undefined,
): string {
  return String(
    (cfg.usePrereleaseScheme
      ? (remote?.remoteIdOrSha ?? remote?.tag ?? remote?.name)
      : (remote?.tag ?? remote?.name)) ?? "",
  ).trim();
}

function schemeLocalDisplayMark(
  cfg: AppConfig,
  metaScheme: MetaBundle["scheme"] | undefined,
): string {
  return String(
    (cfg.usePrereleaseScheme
      ? metaScheme?.remoteIdOrSha
      : metaScheme?.remoteTagOrName) ?? "",
  ).trim();
}

function schemeStoredDisplayMark(
  metaScheme: MetaBundle["scheme"] | undefined,
): string {
  return String(
    (metaScheme?.usePrereleaseScheme
      ? metaScheme?.remoteIdOrSha
      : metaScheme?.remoteTagOrName) ??
      metaScheme?.remoteTagOrName ??
      metaScheme?.remoteIdOrSha ??
      "",
  ).trim();
}

function buildUpdateDecision(
  localMeta: MetaBundle | undefined,
  remote: AllUpdateResult,
  cfg: AppConfig,
): UpdateDecision {
  const schemeRemoteMark = normalizeMark(
    schemeRemoteDisplayMark(cfg, remote.scheme),
  );
  const dictRemoteMark = normalizeMark(remote.dict?.remoteIdOrSha);
  return {
    scheme: !!(
      schemeRemoteMark &&
      normalizeMark(schemeLocalDisplayMark(cfg, localMeta?.scheme)) !==
        schemeRemoteMark
    ),
    dict: !!(
      dictRemoteMark &&
      normalizeMark(localMeta?.dict?.remoteIdOrSha) !== dictRemoteMark
    ),
    model: cfg.downloadModel && isModelUpdateAvailable(localMeta?.model, remote.model),
  };
}

function decorateLogMessage(message: string): string {
  const text = String(message ?? "").trim();
  if (!text) return text;
  if (/^(🟢|🌐|⬇️|🗑️|📝|⏭️|🚀|⏱️|❌|✅|🔎|ℹ️)\s/u.test(text)) return text;
  if (text.includes("可更新") || text.includes("有可用更新"))
    return `🟢 ${text}`;
  if (text.includes("远程")) return `🌐 ${text}`;
  if (
    text.includes("下载地址") ||
    text.includes("下载中") ||
    text.includes("资产")
  )
    return `⬇️ ${text}`;
  if (text.includes("删除") || text.includes("清理")) return `🗑️ ${text}`;
  if (text.includes("写入") || text.includes("整理")) return `📝 ${text}`;
  if (text.includes("跳过排除文件")) return `⏭️ ${text}`;
  if (text.includes("部署")) return `🚀 ${text}`;
  if (text.includes("超时")) return `⏱️ ${text}`;
  if (text.includes("失败") || text.includes("错误")) return `❌ ${text}`;
  if (text.includes("完成")) return `✅ ${text}`;
  if (text.includes("检查")) return `🔎 ${text}`;
  return `ℹ️ ${text}`;
}

function logLevelColor(level: LogLevel) {
  if (level === "SUCCESS") return "systemGreen";
  if (level === "WARN") return "systemOrange";
  if (level === "ERROR") return "systemRed";
  return "systemBlue";
}

function logScopeColor(scope: LogScope) {
  if (scope === "CHECK") return "systemBlue";
  if (scope === "AUTO") return "systemPurple";
  if (scope === "SCHEME") return "systemGreen";
  if (scope === "DICT") return "systemOrange";
  if (scope === "MODEL") return "systemPink";
  if (scope === "DEPLOY") return "systemPink";
  if (scope === "PATH") return "systemOrange";
  return "secondaryLabel";
}

function LogEntryRow(props: { entry: LogEntry; insetLeft?: number }) {
  const insetLeft = Math.max(0, Number(props.insetLeft ?? 0));
  const highlightUpdate = props.entry.message.endsWith("可更新");
  const updatePrefix = highlightUpdate
    ? props.entry.message.slice(0, -3).trimEnd()
    : props.entry.message;
  return (
    <HStack
      key={props.entry.id}
      spacing={0}
      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
    >
      {insetLeft > 0 ? (
        <Rectangle
          foregroundStyle="clear"
          frame={{ width: insetLeft, height: 1 }}
        />
      ) : null}
      <VStack
        spacing={2}
        padding={{ top: 1, bottom: 1 }}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      >
        <HStack
          spacing={8}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          <Text
            font="footnote"
            foregroundStyle="secondaryLabel"
            frame={{ alignment: "leading" as any }}
          >
            {props.entry.at}
          </Text>
          <Text
            font="footnote"
            foregroundStyle={logLevelColor(props.entry.level)}
            frame={{ alignment: "leading" as any }}
          >
            [{props.entry.level}]
          </Text>
          <Text
            font="footnote"
            foregroundStyle={logScopeColor(props.entry.scope)}
            frame={{ alignment: "leading" as any }}
          >
            [{props.entry.scope}]
          </Text>
          <Spacer />
        </HStack>
        {highlightUpdate ? (
          <HStack
            spacing={4}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            <Text
              font="body"
              frame={{ alignment: "leading" as any }}
              multilineTextAlignment="leading"
              selectionDisabled={false}
            >
              {updatePrefix}
            </Text>
            <Text
              font="body"
              foregroundStyle="systemGreen"
              frame={{ alignment: "leading" as any }}
            >
              可更新
            </Text>
            <Spacer />
          </HStack>
        ) : (
          <Text
            font="body"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
            selectionDisabled={false}
          >
            {props.entry.message}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

function FullscreenLogView(props: { logs: LogEntry[] }) {
  const dismiss = Navigation.useDismiss();
  const [visibleLogs, setVisibleLogs] = useState<LogEntry[] | null>(null);
  const copyAllLogs = () => {
    try {
      (globalThis as any).Clipboard?.copyText?.(
        props.logs.map(formatLogEntry).join("\n"),
      );
      (globalThis as any).HapticFeedback?.mediumImpact?.();
    } catch {}
  };

  useEffect(() => {
    setVisibleLogs(null);
    const timer = setTimeout(() => {
      setVisibleLogs(props.logs);
    }, 80);
    return () => clearTimeout(timer);
  }, [props.logs]);

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"详细日志"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark"
              action={() => {
                try {
                  (globalThis as any).HapticFeedback?.mediumImpact?.();
                } catch {}
                dismiss();
              }}
            />
          ),
          topBarTrailing: (
            <Button title="" systemImage="doc.on.doc" action={copyAllLogs} />
          ),
        }}
      >
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ top: 8, bottom: 8, leading: 18, trailing: 14 }}
        >
          <VStack
            spacing={2}
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
          >
            {visibleLogs == null ? (
              <VStack
                spacing={10}
                frame={{
                  maxWidth: "infinity",
                  maxHeight: "infinity",
                  alignment: "center" as any,
                }}
                padding={{ top: 20, bottom: 20 }}
              >
                <ProgressView />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  加载日志中...
                </Text>
              </VStack>
            ) : visibleLogs.length ? (
              visibleLogs.map((entry) => (
                <LogEntryRow key={entry.id} entry={entry} insetLeft={18} />
              ))
            ) : (
              <HStack
                spacing={0}
                frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
              >
                <Rectangle
                  foregroundStyle="clear"
                  frame={{ width: 18, height: 1 }}
                />
                <Text
                  font="footnote"
                  foregroundStyle="secondaryLabel"
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  multilineTextAlignment="leading"
                  selectionDisabled={false}
                >
                  暂无详细日志
                </Text>
              </HStack>
            )}
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  );
}

function FullscreenNotesView(props: { content: string }) {
  const dismiss = Navigation.useDismiss();
  const [visibleContent, setVisibleContent] = useState<string | null>(null);

  useEffect(() => {
    setVisibleContent(null);
    const timer = setTimeout(() => {
      setVisibleContent(props.content);
    }, 80);
    return () => clearTimeout(timer);
  }, [props.content]);

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"更新说明"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark"
              action={() => {
                try {
                  (globalThis as any).HapticFeedback?.mediumImpact?.();
                } catch {}
                dismiss();
              }}
            />
          ),
        }}
      >
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding
        >
          {visibleContent == null ? (
            <VStack
              spacing={10}
              frame={{
                maxWidth: "infinity",
                maxHeight: "infinity",
                alignment: "center" as any,
              }}
              padding={{ top: 20, bottom: 20 }}
            >
              <ProgressView />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                加载更新说明中...
              </Text>
            </VStack>
          ) : (
            <Markdown content={visibleContent} />
          )}
        </ScrollView>
      </VStack>
    </NavigationStack>
  );
}

function UsageGuideRow(props: {
  icon: string;
  title: string;
  detail: string;
  color?: string;
}) {
  return (
    <HStack
      spacing={14}
      padding={{ top: 10, bottom: 10, leading: 2, trailing: 2 }}
      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
    >
      <VStack
        frame={{ width: 34, height: 34, alignment: "center" as any }}
        background={{
          style: "tertiarySystemBackground",
          shape: { type: "rect", cornerRadius: 10 },
        }}
      >
        <Image
          systemName={props.icon}
          font="title3"
          foregroundStyle={(props.color ?? "systemBlue") as any}
        />
      </VStack>
      <VStack
        spacing={4}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      >
        <Text
          font="headline"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
        >
          {props.title}
        </Text>
        <Text
          font="footnote"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="leading"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {props.detail}
        </Text>
      </VStack>
    </HStack>
  );
}

function UsageGuideSection(props: {
  icon: string;
  title: string;
  detail: string;
  color?: string;
  children: any;
}) {
  return (
    <VStack
      spacing={10}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      background={{
        style: "secondarySystemBackground",
        shape: { type: "rect", cornerRadius: 16 },
      }}
    >
      <UsageGuideRow
        icon={props.icon}
        title={props.title}
        detail={props.detail}
        color={props.color}
      />
      <Divider />
      {props.children}
    </VStack>
  );
}

function UsageGuideView() {
  const dismiss = Navigation.useDismiss();

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"使用说明"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark"
              action={() => {
                try {
                  (globalThis as any).HapticFeedback?.mediumImpact?.();
                } catch {}
                dismiss();
              }}
            />
          ),
        }}
      >
        <ScrollView
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ top: 16, bottom: 24, leading: 16, trailing: 16 }}
        >
          <VStack spacing={16} frame={{ maxWidth: "infinity" }}>
            <UsageGuideSection
              icon="r.square.fill"
              title="Rime 更新"
              detail="点击右下角上方按钮，向左展开方案、词库，以及开启下载模型时的模型入口。"
              color="systemBlue"
            >
              <UsageGuideRow
                icon="doc.text"
                title="方案"
                detail="重新下载并写入当前设置中选择的方案包。"
                color="systemBlue"
              />
              <UsageGuideRow
                icon="books.vertical"
                title="词库"
                detail="重新下载并写入当前方案对应的词库文件。"
                color="systemBlue"
              />
              <UsageGuideRow
                icon="shippingbox"
                title="模型"
                detail="开启“下载模型”后，重新下载并写入语法模型文件。"
                color="systemBlue"
              />
            </UsageGuideSection>

            <UsageGuideSection
              icon="bolt.fill"
              title="更新与部署"
              detail="点击右下角下方按钮，向左展开部署、检查更新、自动更新三个入口。"
              color="systemBlue"
            >
              <UsageGuideRow
                icon="paperplane"
                title="部署"
                detail="触发当前输入法的部署逻辑。Scripting 输入法需要到工具中手动部署。"
                color="systemBlue"
              />
              <UsageGuideRow
                icon="arrow.triangle.2.circlepath"
                title="检查更新"
                detail="只检查远程方案、词库，以及开启下载模型时的模型信息，并更新可更新状态，不下载文件。"
                color="systemBlue"
              />
              <UsageGuideRow
                icon="bolt.fill"
                title="自动更新"
                detail="根据检查结果自动更新需要更新的内容，并按设置决定是否自动部署。"
                color="systemBlue"
              />
            </UsageGuideSection>

            <Text
              font="footnote"
              foregroundStyle="secondaryLabel"
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              multilineTextAlignment="leading"
            >
              提示：本地信息中显示为绿色的项目，表示当前检查结果中该项目有可用更新。
            </Text>
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  );
}

function progressStageLabel(stage: string): string {
  const text = String(stage ?? "");
  if (text.includes("下载中")) return "下载中";
  if (text.includes("清理旧文件")) return "删除中";
  if (
    text.includes("解压") ||
    text.includes("整理") ||
    text.includes("写入") ||
    text.includes("校验")
  )
    return "写入中";
  return "处理中";
}

async function listFileBrowserEntries(
  dir: string,
): Promise<FileBrowserEntry[]> {
  const fm: any = (globalThis as any).FileManager;
  if (!fm || !dir) return [];
  const base = dir.endsWith("/") ? dir : dir + "/";
  let raw: any[] = [];
  if (typeof fm.readDirectory === "function") {
    raw = await fm.readDirectory(dir);
  } else if (typeof fm.readDirectorySync === "function") {
    raw = fm.readDirectorySync(dir);
  } else {
    return [];
  }
  const names = (Array.isArray(raw) ? raw : [])
    .map(String)
    .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
    .filter((p) => p && p !== "." && p !== "..");

  const entries: FileBrowserEntry[] = [];
  for (const name of names) {
    const path = Path.join(dir, name);
    let isDirectory = false;
    try {
      if (typeof fm.isDirectory === "function")
        isDirectory = !!(await fm.isDirectory(path));
      else if (typeof fm.isDir === "function")
        isDirectory = !!(await fm.isDir(path));
      else if (typeof fm.stat === "function") {
        const st = await fm.stat(path);
        isDirectory = String(st?.type ?? "") === "directory";
      } else if (typeof fm.statSync === "function") {
        const st = fm.statSync(path);
        isDirectory = String(st?.type ?? "") === "directory";
      }
    } catch {}
    entries.push({ name, path, isDirectory });
  }
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

async function resolveEditorRootFromConfig(
  current: AppConfig,
): Promise<string> {
  const fm: any = (globalThis as any).FileManager;
  let root = String(current.hamsterRootPath ?? "").trim();
  if (current.hamsterBookmarkName && fm?.bookmarkedPath) {
    try {
      const canUseByName = fm?.bookmarkExists
        ? !!(await fm.bookmarkExists(current.hamsterBookmarkName))
        : true;
      if (canUseByName) {
        const resolved = await fm.bookmarkedPath(current.hamsterBookmarkName);
        if (resolved) root = String(resolved).trim();
      }
    } catch {}
  }
  return root;
}

function editorPathVariants(path: string): string[] {
  const normalized = normalizePath(path);
  if (!normalized) return [];
  const set = new Set<string>([normalized]);
  if (normalized.startsWith("/private/"))
    set.add(normalized.slice("/private".length));
  else if (normalized.startsWith("/")) set.add(`/private${normalized}`);
  return Array.from(set);
}

function isAtOrBelowEditorRoot(path: string, root: string): boolean {
  const pathVariants = editorPathVariants(path);
  const rootVariants = editorPathVariants(root);
  if (!pathVariants.length || !rootVariants.length) return false;
  for (const p of pathVariants) {
    for (const r of rootVariants) {
      if (p === r || p.startsWith(`${r}/`)) return true;
    }
  }
  return false;
}

function isSameEditorPath(a: string, b: string): boolean {
  if (!a || !b) return false;
  const av = editorPathVariants(a);
  const bv = new Set(editorPathVariants(b));
  return av.some((item) => bv.has(item));
}

function FileEditorSheet(props: {
  title: string;
  content: string;
  ext: string;
}) {
  const dismiss = Navigation.useDismiss();
  const [controller] = useState(
    () =>
      new EditorController({
        content: props.content,
        ext: props.ext as any,
        readOnly: false,
      }),
  );

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: (
            <Button title="取消" role="cancel" action={() => dismiss(null)} />
          ),
          topBarTrailing: (
            <Button
              title="保存"
              action={() => dismiss(String(controller.content ?? ""))}
            />
          ),
        }}
      >
        <Editor controller={controller} />
      </VStack>
    </NavigationStack>
  );
}

export function HomeView() {
  const supportsMinimization =
    typeof Script.supportsMinimization === "function" &&
    Script.supportsMinimization();
  const activeTab = useObservable<number>(MAIN_TAB);
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig());
  const logProxyRef = useRef<any>();
  const settingsSaveRef = useRef<(() => void) | null>(null);
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "release-notes.md",
    storageKey: "wanxiang-helper:release-notes:last-seen-hash",
    title: "更新内容",
  });
  const [editorRootPath, setEditorRootPath] = useState(() =>
    String(loadConfig().hamsterRootPath ?? "").trim(),
  );
  const [editorCurrentPath, setEditorCurrentPath] = useState(() =>
    String(loadConfig().hamsterRootPath ?? "").trim(),
  );
  const [editorEntries, setEditorEntries] = useState<FileBrowserEntry[]>([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [activeActionGroup, setActiveActionGroup] = useState<"rime" | "update" | null>(null);

  // 本地信息
  const [localSelectedScheme, setLocalSelectedScheme] = useState("暂无法获取");
  const [localSchemeVersion, setLocalSchemeVersion] = useState("暂无法获取");
  const [localDictMark, setLocalDictMark] = useState("暂无法获取");
  const [localModelMark, setLocalModelMark] = useState("暂无法获取");

  // 远程信息
  const [remoteSchemeVer, setRemoteSchemeVer] = useState(
    () => homeSessionState.remoteSchemeVer,
  );
  const [remoteDictMark, setRemoteDictMark] = useState(
    () => homeSessionState.remoteDictMark,
  );
  const [remoteModelMark, setRemoteModelMark] = useState(
    () => homeSessionState.remoteModelMark,
  );
  const [notes, setNotes] = useState(() => homeSessionState.notes);
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(
    () => homeSessionState.lastCheck,
  );
  const [lastCheckDecision, setLastCheckDecision] =
    useState<UpdateDecision | null>(() => homeSessionState.lastCheckDecision);
  const [lastCheckKey, setLastCheckKey] = useState(
    () => homeSessionState.lastCheckKey,
  );
  const [logs, setLogs] = useState<LogEntry[]>(() => homeSessionState.logs);

  // 状态
  const [stage, setStage] = useState("就绪");
  const [progressPct, setProgressPct] = useState("0.00%");
  const [progressValue, setProgressValue] = useState<number | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [pathUsable, setPathUsable] = useState(false);
  const [alert, setAlert] = useState<AlertState>({
    title: "",
    isPresented: false,
    message: <Text> </Text>,
    actions: <Text> </Text>,
  });

  // ✅ 只在“真正下载”时显示进度
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const root = await resolveEditorRootFromConfig(cfg);
      if (disposed) return;
      setEditorRootPath(root);
      setEditorCurrentPath(root);
    })();
    return () => {
      disposed = true;
    };
  }, [cfg.hamsterRootPath, cfg.hamsterBookmarkName]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      if (!editorCurrentPath) {
        setEditorEntries([]);
        return;
      }
      setEditorLoading(true);
      try {
        const items = await listFileBrowserEntries(editorCurrentPath);
        if (!disposed) setEditorEntries(items);
      } catch {
        if (!disposed) setEditorEntries([]);
      } finally {
        if (!disposed) setEditorLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [editorCurrentPath]);

  useEffect(() => {
    const root = normalizePath(editorRootPath);
    const current = normalizePath(editorCurrentPath);
    if (!root || !current) return;
    if (!isAtOrBelowEditorRoot(current, root)) {
      setEditorCurrentPath(root);
    }
  }, [editorCurrentPath, editorRootPath]);

  function resetRemote() {
    setRemoteSchemeVer(DEFAULT_HOME_SESSION_STATE.remoteSchemeVer);
    setRemoteDictMark(DEFAULT_HOME_SESSION_STATE.remoteDictMark);
    setRemoteModelMark(DEFAULT_HOME_SESSION_STATE.remoteModelMark);
    setNotes(DEFAULT_HOME_SESSION_STATE.notes);
    setLastCheck(DEFAULT_HOME_SESSION_STATE.lastCheck);
    setLastCheckDecision(DEFAULT_HOME_SESSION_STATE.lastCheckDecision);
    setLastCheckKey(DEFAULT_HOME_SESSION_STATE.lastCheckKey);
  }

  function checkKey(c: AppConfig) {
    return getCheckCacheKey(c);
  }

  function closeAlert() {
    setAlert((a) => ({ ...a, isPresented: false }));
  }

  function pushLog(
    level: LogLevel,
    scope: LogScope,
    message: string,
    targetCfg?: AppConfig,
  ) {
    const currentCfg = targetCfg ?? cfg;
    if (!currentCfg.showVerboseLog) return;
    let normalizedMessage = String(message ?? "").trim();
    normalizedMessage = replacePathPrefix(
      normalizedMessage,
      currentCfg.hamsterRootPath,
    );
    normalizedMessage = decorateLogMessage(normalizedMessage);
    const entry = makeLogEntry(level, scope, normalizedMessage);
    setLogs((prev) => {
      const next = prev.concat(entry);
      const trimmed = next.length > 200 ? next.slice(next.length - 200) : next;
      homeSessionState = {
        ...homeSessionState,
        logs: trimmed,
      };
      return trimmed;
    });
  }

  function setStageAndMaybeLog(
    message: string,
    scope: LogScope = "SYSTEM",
    level: LogLevel = "INFO",
    logIt = false,
  ) {
    setStage(message);
    if (logIt) pushLog(level, scope, message);
  }

  function wrapStageReporter(scope: LogScope) {
    return (message: string) => {
      setStageAndMaybeLog(message, scope, "INFO", true);
    };
  }

  function wrapDetailLogger(scope: LogScope, level: LogLevel = "INFO") {
    return (message: string) => {
      pushLog(level, scope, message);
    };
  }

  function pushCheckResultLog(
    label: string,
    remoteMark: string,
    needUpdate: boolean,
  ) {
    pushLog(
      needUpdate ? "SUCCESS" : "INFO",
      "CHECK",
      `远程${label}：${remoteMark}${needUpdate ? "  可更新" : ""}`,
    );
  }

  async function guardPathAccess(showPopup: boolean): Promise<boolean> {
    const current = loadConfig();
    const r = await verifyInstallPathAccess(current);
    if (r.ok) {
      setPathUsable(true);
      return true;
    }
    setPathUsable(false);
    setStageAndMaybeLog(
      "路径不可用，请在设置中添加或重新添加书签文件夹。",
      "PATH",
      "WARN",
      true,
    );
    if (showPopup) {
      const msg = r.reason
        ? `${r.reason}\n请在设置中添加或重新添加书签文件夹。`
        : "请在设置中添加或重新添加书签文件夹。";
      setAlert({
        title: "路径不可用",
        isPresented: true,
        message: <Text>{msg}</Text>,
        actions: (
          <HStack>
            <Button
              title="取消"
              action={() => {
                try {
                  (globalThis as any).HapticFeedback?.mediumImpact?.();
                } catch {}
                closeAlert();
              }}
            />
            <Button
              title="确认"
              action={() => {
                try {
                  (globalThis as any).HapticFeedback?.mediumImpact?.();
                } catch {}
                closeAlert();
                Script.exit();
              }}
            />
          </HStack>
        ),
      });
    }
    return false;
  }

  async function findLocalMeta(
    current: AppConfig,
  ): Promise<{ meta?: MetaBundle; candidates: string[] }> {
    const normPath = (s: string) =>
      String(s ?? "")
        .trim()
        .replace(/\/+$/, "");
    const pushCandidate = (arr: string[], p?: string) => {
      const x = normPath(String(p ?? ""));
      if (x) arr.push(x);
    };

    let installRoot = "";
    try {
      const { rimeDir } = await detectRimeDir(current);
      if (rimeDir) installRoot = rimeDir;
    } catch {}
    if (!installRoot) {
      installRoot = current.hamsterRootPath;
    }

    const candidates: string[] = [];
    pushCandidate(candidates, installRoot);
    if (
      current.hamsterRootPath &&
      normPath(current.hamsterRootPath) !== normPath(installRoot)
    ) {
      pushCandidate(candidates, current.hamsterRootPath);
    }
    if (current.hamsterRootPath) {
      const rimeCandidates = await collectRimeCandidates(
        current.hamsterRootPath,
      );
      for (const c of rimeCandidates) pushCandidate(candidates, c);
    }

    try {
      const fm: any = (globalThis as any).FileManager;
      if (
        fm?.bookmarkedPath &&
        (current.hamsterBookmarkName || current.hamsterRootPath)
      ) {
        if (current.hamsterBookmarkName) {
          const p = fm.bookmarkedPath(current.hamsterBookmarkName);
          const resolved = p && typeof p.then === "function" ? await p : p;
          if (resolved) pushCandidate(candidates, String(resolved));
        }
      }
      if (fm?.getAllFileBookmarks) {
        const r = fm.getAllFileBookmarks();
        const list = r && typeof r.then === "function" ? await r : r;
        const arr = Array.isArray(list) ? list : [];
        if (current.hamsterBookmarkName) {
          const byName = arr.find(
            (b: any) => String(b?.name ?? "") === current.hamsterBookmarkName,
          );
          if (byName?.path) pushCandidate(candidates, String(byName.path));
          if (byName?.name && fm?.bookmarkedPath) {
            const p = fm.bookmarkedPath(byName.name);
            const resolved = p && typeof p.then === "function" ? await p : p;
            if (resolved) pushCandidate(candidates, String(resolved));
          }
        }
        if (current.hamsterRootPath) {
          const target = normPath(String(current.hamsterRootPath));
          const byPath = arr.find(
            (b: any) => normPath(String(b?.path ?? "")) === target,
          );
          if (byPath?.path) pushCandidate(candidates, String(byPath.path));
          if (byPath?.name && fm?.bookmarkedPath) {
            const p = fm.bookmarkedPath(byPath.name);
            const resolved = p && typeof p.then === "function" ? await p : p;
            if (resolved) pushCandidate(candidates, String(resolved));
          }
        }
      }
    } catch {}

    const uniq = Array.from(new Set(candidates.map(normPath).filter(Boolean)));
    for (const root of uniq) {
      const m = await loadMetaAsync(root, current.hamsterBookmarkName);
      if (m.scheme || m.dict || m.model) {
        return { meta: m, candidates: uniq };
      }
    }
    if (current.hamsterBookmarkName) {
      try {
        const byBookmark = await loadMetaAsync("", current.hamsterBookmarkName);
        if (byBookmark.scheme || byBookmark.dict || byBookmark.model) {
          return { meta: byBookmark, candidates: uniq };
        }
      } catch {}
    }
    return { meta: undefined, candidates: uniq };
  }

  async function refreshLocal(current: AppConfig): Promise<boolean> {
    const selected = selectedSchemeFromConfig(current);
    setLocalSelectedScheme(selected);

    const { meta, candidates } = await findLocalMeta(current);
    if (!candidates.length || !meta) {
      setLocalSchemeVersion("暂无法获取");
      setLocalDictMark("暂无法获取");
      setLocalModelMark(current.downloadModel ? "暂无法获取" : "");
      return false;
    }

    const localScheme = normalizeMetaScheme(meta.scheme, current);
    setLocalSelectedScheme(localScheme.selected);

    setLocalSchemeVersion(schemeStoredDisplayMark(meta.scheme) || "暂无法获取");
    setLocalDictMark(meta.dict?.remoteIdOrSha ?? "暂无法获取");
    setLocalModelMark(current.downloadModel ? (modelDisplayMark(meta.model) || "暂无法获取") : "");
    return true;
  }

  async function refreshLastCheckDecision(
    current: AppConfig,
    remoteOverride?: AllUpdateResult | null,
  ) {
    const remote =
      remoteOverride ?? (lastCheckKey === checkKey(current) ? lastCheck : null);
    if (!remote) return;
    const { meta } = await findLocalMeta(current);
    const nextDecision = buildUpdateDecision(meta, remote, current);
    setRemoteModelMark(current.downloadModel ? (modelDisplayMark(remote.model, meta?.model) || "暂无法获取") : "");
    setLocalModelMark(current.downloadModel ? (modelDisplayMark(meta?.model, remote.model) || "暂无法获取") : "");
    setLastCheck(remote);
    setLastCheckDecision(nextDecision);
    setLastCheckKey(checkKey(current));
    saveSharedCheckCache(current, remote, nextDecision);
  }

  async function applySharedCheckCache(current: AppConfig) {
    const cache = loadSharedCheckCache();
    if (!cache || cache.key !== checkKey(current)) return false;
    const { meta } = await findLocalMeta(current);
    setRemoteSchemeVer(
      schemeRemoteDisplayMark(current, cache.remote.scheme) || "暂无法获取",
    );
    setRemoteDictMark(cache.remote.dict?.remoteIdOrSha ?? "暂无法获取");
    setRemoteModelMark(current.downloadModel ? (modelDisplayMark(cache.remote.model, meta?.model) || "暂无法获取") : "");
    setLocalModelMark(current.downloadModel ? (modelDisplayMark(meta?.model, cache.remote.model) || "暂无法获取") : "");
    const nextDecision = buildUpdateDecision(meta, cache.remote, current);
    setNotes(cache.remote.scheme?.body ?? "");
    setLastCheck(cache.remote);
    setLastCheckDecision(nextDecision);
    setLastCheckKey(cache.key);
    saveSharedCheckCache(current, cache.remote, nextDecision);
    return true;
  }

  useEffect(() => {
    homeSessionState = {
      remoteSchemeVer,
      remoteDictMark,
      remoteModelMark,
      notes,
      lastCheck,
      lastCheckDecision,
      lastCheckKey,
      logs,
    };
  }, [
    remoteSchemeVer,
    remoteDictMark,
    remoteModelMark,
    notes,
    lastCheck,
    lastCheckDecision,
    lastCheckKey,
    logs,
  ]);

  useEffect(() => {
    if (busy) setActiveActionGroup(null);
  }, [busy]);

  useEffect(() => {
    if (!cfg.showVerboseLog) return;
    const scrollLatest = () => {
      try {
        logProxyRef.current?.scrollTo?.("bottomView", "bottom");
      } catch {}
    };
    scrollLatest();
    const intervalId = busy
      ? (globalThis as any).setInterval?.(scrollLatest, 100)
      : undefined;
    const finalTimer = setTimeout(scrollLatest, 120);
    return () => {
      if (intervalId !== undefined)
        (globalThis as any).clearInterval?.(intervalId);
      clearTimeout(finalTimer);
    };
  }, [cfg.showVerboseLog, busy, logs.length]);

  useEffect(() => {
    void (async () => {
      const current = cfg;
      await guardPathAccess(true);
      const found = await refreshLocal(current);
      if (!found) {
        await sleep(120);
        await refreshLocal(loadConfig());
      }
      await applySharedCheckCache(current);
    })();
  }, [
    cfg.schemeEdition,
    cfg.proSchemeKey,
    cfg.releaseSource,
    cfg.hamsterRootPath,
    cfg.hamsterBookmarkName,
  ]);

  useEffect(() => {
    const current = loadConfig();
    if (String(Script.queryParameters?.action ?? "") === "autoUpdate") return;
    if (current.autoCheckOnLaunch && !launchAutoCheckHandled) {
      launchAutoCheckHandled = true;
      void (async () => {
        if (await guardPathAccess(false)) {
          await onCheckUpdate();
        }
      })();
    }
  }, []);

  useEffect(() => {
    const action = String(Script.queryParameters?.action ?? "");
    const requestId = String(Script.queryParameters?.requestId ?? "");
    const actionKey = `${action}:${requestId}`;
    if (
      action !== "autoUpdate" ||
      !requestId ||
      lastHandledLaunchActionKey === actionKey
    )
      return;
    lastHandledLaunchActionKey = actionKey;
    launchAutoCheckHandled = true;
    void (async () => {
      if (await guardPathAccess(true)) {
        await onAutoUpdate();
      }
    })();
  }, []);

  async function handleSettingsSaved(newCfg: AppConfig) {
    const before = loadConfig();
    const beforeKey = checkKey(before);
    setCfg(newCfg);
    await guardPathAccess(false);
    const hasLocal = await refreshLocal(newCfg);
    const afterKey = checkKey(newCfg);
    if (afterKey !== beforeKey) {
      resetRemote();
      const pathChanged =
        newCfg.hamsterRootPath !== before.hamsterRootPath ||
        newCfg.hamsterBookmarkName !== before.hamsterBookmarkName;
      if (pathChanged && newCfg.autoCheckOnLaunch && hasLocal) {
        await onCheckUpdate();
      }
    }
  }

  async function openEditorFile(filePath: string) {
    try {
      if (!filePath) return;
      const ext = Path.extname(filePath).slice(1) || "md";
      const content = await FileManager.readAsString(filePath, "utf-8");
      const nextContent = await Navigation.present<string | null>({
        element: (
          <FileEditorSheet
            title={Path.basename(filePath) || "编辑文件"}
            content={content}
            ext={ext}
          />
        ),
        modalPresentationStyle: "pageSheet",
      });
      if (nextContent != null && nextContent !== content) {
        await FileManager.writeAsString(filePath, nextContent, "utf-8");
      }
      const items = await listFileBrowserEntries(editorCurrentPath);
      setEditorEntries(items);
    } catch (error: any) {
      setStageAndMaybeLog(
        `打开编辑器失败：${String(error?.message ?? error)}`,
        "SYSTEM",
        "ERROR",
        true,
      );
    }
  }

  async function reselectEditorFolder() {
    try {
      const initialDirectory =
        editorCurrentPath || editorRootPath || cfg.hamsterRootPath || undefined;
      const picked = await (DocumentPicker as any).pickDirectory?.(
        initialDirectory,
      );
      const nextPath = String(picked ?? "").trim();
      if (!nextPath) return;
      setEditorRootPath(nextPath);
      setEditorCurrentPath(nextPath);
    } catch (error: any) {
      setStageAndMaybeLog(
        `选择文件夹失败：${String(error?.message ?? error)}`,
        "SYSTEM",
        "ERROR",
        true,
      );
    }
  }

  async function minimizeScript() {
    if (!supportsMinimization || busy) return;
    try {
      (globalThis as any).HapticFeedback?.mediumImpact?.();
    } catch {}
    try {
      await Script.minimize();
    } catch {}
  }

  async function cleanupAndExit() {
    try {
      await clearWanxiangTempFiles();
    } catch {}
    Script.exit();
  }

  function closeScript() {
    try {
      (globalThis as any).HapticFeedback?.mediumImpact?.();
    } catch {}
    if (!busy) {
      void cleanupAndExit();
      return;
    }
    setAlert({
      title: "退出当前更新？",
      isPresented: true,
      message: (
        <Text>
          当前有更新任务正在进行，退出后将关闭当前脚本界面。是否继续退出？
        </Text>
      ),
      actions: (
        <HStack>
          <Button
            title="取消"
            action={() => {
              try {
                (globalThis as any).HapticFeedback?.mediumImpact?.();
              } catch {}
              closeAlert();
            }}
          />
          <Button
            title="退出"
            action={() => {
              try {
                (globalThis as any).HapticFeedback?.mediumImpact?.();
              } catch {}
              closeAlert();
              void cleanupAndExit();
            }}
          />
        </HStack>
      ),
    });
  }

  function renderLeadingToolbar() {
    return (
      <HStack spacing={8}>
        <Button
          title=""
          systemImage="xmark.circle"
          foregroundStyle="systemRed"
          action={closeScript}
        />
        {supportsMinimization ? (
          <Button
            title=""
            systemImage="minus.circle"
            foregroundStyle={busy ? "secondaryLabel" : "systemBlue"}
            disabled={busy}
            action={() => {
              void minimizeScript();
            }}
          />
        ) : null}
      </HStack>
    );
  }

  function renderEditorTrailingToolbar() {
    return (
      <Button
        title=""
        systemImage="folder.badge.gearshape"
        action={() => {
          void reselectEditorFolder();
        }}
      />
    );
  }

  function renderSettingsTrailingToolbar() {
    return (
      <Button
        title=""
        systemImage="checkmark"
        action={() => {
          try {
            (globalThis as any).HapticFeedback?.mediumImpact?.();
          } catch {}
          settingsSaveRef.current?.();
        }}
      />
    );
  }

  function renderMainTrailingToolbar() {
    return (
      <Button
        title=""
        systemImage="questionmark.circle"
        action={() => {
          try {
            (globalThis as any).HapticFeedback?.mediumImpact?.();
          } catch {}
          void openUsageGuide();
        }}
      />
    );
  }

  async function openFullscreenLogs() {
    await Navigation.present({
      element: <FullscreenLogView logs={logs} />,
    });
  }

  async function openFullscreenNotes() {
    await Navigation.present({
      element: <FullscreenNotesView content={notes} />,
    });
  }

  async function openUsageGuide() {
    await Navigation.present({
      element: <UsageGuideView />,
    });
  }

  function applyProgress(p: any) {
    const toNum = (v: any): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return undefined;
    };
    const received =
      toNum(
        p?.received ?? p?.completedUnitCount ?? p?.progress?.completedUnitCount,
      ) ?? 0;
    const f = readFraction(
      p?.percent ?? p?.fractionCompleted ?? p?.progress?.fractionCompleted,
    );
    if (received > 0 || (typeof f === "number" && f > 0)) {
      setShowProgress(true);
    }
    if (typeof f === "number") {
      const v = clamp01(f);
      setProgressValue(v);
      setProgressPct(pctFromFraction(v));
    }
  }

  // ===== 操作 =====

  async function onCheckUpdate() {
    if (!(await guardPathAccess(true))) return;
    setBusy(true);
    setShowProgress(false); // ✅ 检查更新不显示进度
    setStageAndMaybeLog("检查更新中…", "CHECK", "INFO", true);
    setProgressPct("0.00%");
    setProgressValue(undefined);
    setRemoteSchemeVer("检查更新中...");
    setRemoteDictMark("检查更新中...");
    setRemoteModelMark("检查更新中...");
    setNotes("检查更新中...");
    try {
      const current = loadConfig();
      const { meta: localMeta } = await findLocalMeta(current);
      await refreshLocal(current);
      const effective = loadConfig();

      const r = await checkAllUpdates(effective, (kind, message) => {
        const label = kind === "scheme" ? "方案" : kind === "dict" ? "词库" : "模型";
        pushLog("ERROR", "CHECK", `${label}请求失败：${message}`, effective);
      });
      const decision = buildUpdateDecision(localMeta, r, effective);
      setRemoteSchemeVer(
        schemeRemoteDisplayMark(effective, r.scheme) || "暂无法获取",
      );
      setRemoteDictMark(r.dict?.remoteIdOrSha ?? "暂无法获取");
      setRemoteModelMark(effective.downloadModel ? (modelDisplayMark(r.model, localMeta?.model) || "暂无法获取") : "");
      setLocalModelMark(effective.downloadModel ? (modelDisplayMark(localMeta?.model, r.model) || "暂无法获取") : "");
      setNotes(r.scheme?.body ?? "");
      setLastCheck(r);
      setLastCheckDecision(decision);
      setLastCheckKey(checkKey(effective));
      saveSharedCheckCache(effective, r, decision);

      pushCheckResultLog(
        "方案",
        schemeRemoteDisplayMark(effective, r.scheme) || "暂无法获取",
        decision.scheme,
      );
      pushCheckResultLog(
        "词库",
        r.dict?.remoteIdOrSha ?? "暂无法获取",
        decision.dict,
      );
      if (effective.downloadModel) {
        pushCheckResultLog(
          "模型",
          modelDisplayMark(r.model, localMeta?.model) || "暂无法获取",
          decision.model,
        );
      }
      setStageAndMaybeLog("检查完成", "CHECK", "SUCCESS", true);
    } catch (e: any) {
      setStageAndMaybeLog(
        `检查失败：${String(e?.message ?? e)}`,
        "CHECK",
        "ERROR",
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  async function onAutoUpdate() {
    if (!(await guardPathAccess(true))) return;
    setBusy(true);
    setShowProgress(false); // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("自动更新中…", "AUTO", "INFO", true);
    setProgressPct("0.00%");
    setProgressValue(undefined);
    try {
      const current = loadConfig();
      const { meta: localMeta } = await findLocalMeta(current);
      await refreshLocal(current);
      const effective = loadConfig();

      const key = checkKey(effective);
      let pre = lastCheck;
      let decision = lastCheckDecision;
      let resolvedKey = lastCheckKey;
      let precheckFailed = false;
      const shared = loadSharedCheckCache();
      if ((!pre || lastCheckKey !== key) && shared && shared.key === key) {
        pre = shared.remote;
        decision = buildUpdateDecision(localMeta, shared.remote, effective);
        resolvedKey = key;
        setRemoteSchemeVer(
          schemeRemoteDisplayMark(effective, shared.remote.scheme) ||
            "暂无法获取",
        );
        setRemoteDictMark(shared.remote.dict?.remoteIdOrSha ?? "暂无法获取");
        setRemoteModelMark(effective.downloadModel ? (modelDisplayMark(shared.remote.model, localMeta?.model) || "暂无法获取") : "");
        setLocalModelMark(effective.downloadModel ? (modelDisplayMark(localMeta?.model, shared.remote.model) || "暂无法获取") : "");
        setNotes(shared.remote.scheme?.body ?? "");
        setLastCheck(shared.remote);
        setLastCheckDecision(decision);
        setLastCheckKey(key);
        saveSharedCheckCache(effective, shared.remote, decision);
      }
      if (!pre || resolvedKey !== key) {
        // 检查阶段也不显示进度（避免误导）
        setShowProgress(false);
        setStageAndMaybeLog("自动更新：检查更新中…", "AUTO", "INFO", true);
        setRemoteSchemeVer("检查更新中...");
        setRemoteDictMark("检查更新中...");
        setRemoteModelMark("检查更新中...");
        setNotes("检查更新中...");
        pre = await checkAllUpdates(effective, (kind, message) => {
          const label = kind === "scheme" ? "方案" : kind === "dict" ? "词库" : "模型";
          precheckFailed = true;
          pushLog("ERROR", "AUTO", `${label}请求失败：${message}`, effective);
        });
        setRemoteSchemeVer(
          schemeRemoteDisplayMark(effective, pre.scheme) || "暂无法获取",
        );
        setRemoteDictMark(pre.dict?.remoteIdOrSha ?? "暂无法获取");
        setRemoteModelMark(effective.downloadModel ? (modelDisplayMark(pre.model, localMeta?.model) || "暂无法获取") : "");
        setLocalModelMark(effective.downloadModel ? (modelDisplayMark(localMeta?.model, pre.model) || "暂无法获取") : "");
        setNotes(pre.scheme?.body ?? "");
        setLastCheck(pre);
        decision = buildUpdateDecision(localMeta, pre, effective);
        setLastCheckDecision(decision);
        setLastCheckKey(key);
      }
      if (pre && !decision) {
        decision = buildUpdateDecision(localMeta, pre, effective);
        setLastCheckDecision(decision);
      }

      if (decision?.scheme) pushLog("SUCCESS", "AUTO", "方案有可用更新");
      if (decision?.dict) pushLog("SUCCESS", "AUTO", "词库有可用更新");
      if (effective.downloadModel && decision?.model) pushLog("SUCCESS", "AUTO", "模型有可用更新");
      if (decision && !decision.scheme && !decision.dict && !decision.model) {
        setStageAndMaybeLog(
          precheckFailed ? "自动更新完成（部分请求失败，请查看日志）" : "自动更新完成（已是最新，无需更新）",
          "AUTO",
          precheckFailed ? "WARN" : "SUCCESS",
          true,
        );
        return;
      }

      const autoResult = await autoUpdateAll(
        effective,
        {
          onStage: wrapStageReporter("AUTO"),
          onLog: wrapDetailLogger("AUTO"),
          onProgress: (p) => applyProgress(p),
          onAfterModule: async () => {
            await refreshLocal(effective);
            await refreshLastCheckDecision(effective, pre);
          },
          hasPrecheckFailure: precheckFailed,
        },
        pre,
        decision ?? undefined,
      );

      await refreshLocal(effective);
      await refreshLastCheckDecision(effective, autoResult.remote);
      const hasFailed = precheckFailed || autoResult.failed.scheme || autoResult.failed.dict || autoResult.failed.model;
      if (!autoResult.didUpdate) {
        setStageAndMaybeLog(
          hasFailed ? "自动更新完成（全部更新失败，请查看日志）" : "自动更新完成（已是最新，无需更新）",
          "AUTO",
          hasFailed ? "ERROR" : "SUCCESS",
          true,
        );
      } else if (autoResult.didDeploy) {
        setStageAndMaybeLog(
          hasFailed ? "自动更新完成（部分失败，已部署）" : "自动更新完成（已部署）",
          "AUTO",
          hasFailed ? "WARN" : "SUCCESS",
          true,
        );
      } else {
        const currentNow = loadConfig();
        if (currentNow.inputMethod !== "scripting") {
          setStageAndMaybeLog(
            hasFailed ? "自动更新完成（部分失败，已跳过部署）" : "自动更新完成（未自动部署）",
            "AUTO",
            hasFailed ? "WARN" : "SUCCESS",
            true,
          );
        }
      }
    } catch (e: any) {
      setStageAndMaybeLog(
        `自动更新失败：${String(e?.message ?? e)}`,
        "AUTO",
        "ERROR",
        true,
      );
    } finally {
      setBusy(false);
      setShowProgress(false);
      setProgressValue(undefined);
    }
  }

  async function onUpdateScheme() {
    if (!(await guardPathAccess(true))) return;
    setBusy(true);
    setShowProgress(false); // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("更新方案中…", "SCHEME", "INFO", true);
    setProgressPct("0.00%");
    setProgressValue(undefined);
    try {
      const current = loadConfig();
      await updateScheme(current, {
        autoDeploy: false,
        onStage: wrapStageReporter("SCHEME"),
        onLog: wrapDetailLogger("SCHEME"),
        onProgress: (p) => applyProgress(p),
      });
      await refreshLocal(current);
      await refreshLastCheckDecision(current);
      setStageAndMaybeLog("更新方案完成", "SCHEME", "SUCCESS", true);
    } catch (e: any) {
      setStageAndMaybeLog(
        `更新方案失败：${String(e?.message ?? e)}`,
        "SCHEME",
        "ERROR",
        true,
      );
    } finally {
      setBusy(false);
      setShowProgress(false);
      setProgressValue(undefined);
    }
  }

  async function onUpdateDict() {
    if (!(await guardPathAccess(true))) return;
    setBusy(true);
    setShowProgress(false); // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("更新词库中…", "DICT", "INFO", true);
    setProgressPct("0.00%");
    setProgressValue(undefined);
    try {
      const current = loadConfig();
      await updateDict(current, {
        autoDeploy: false,
        onStage: wrapStageReporter("DICT"),
        onLog: wrapDetailLogger("DICT"),
        onProgress: (p) => applyProgress(p),
      });
      await refreshLocal(current);
      await refreshLastCheckDecision(current);
      setStageAndMaybeLog("更新词库完成", "DICT", "SUCCESS", true);
    } catch (e: any) {
      setStageAndMaybeLog(
        `更新词库失败：${String(e?.message ?? e)}`,
        "DICT",
        "ERROR",
        true,
      );
    } finally {
      setBusy(false);
      setShowProgress(false);
      setProgressValue(undefined);
    }
  }

  async function onUpdateModel() {
    if (!(await guardPathAccess(true))) return;
    const current = loadConfig();
    if (!current.downloadModel) {
      setStageAndMaybeLog("设置中未开启下载模型", "MODEL", "WARN", true);
      return;
    }
    setBusy(true);
    setShowProgress(false); // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("更新模型中…", "MODEL", "INFO", true);
    setProgressPct("0.00%");
    setProgressValue(undefined);
    try {
      await updateModel(current, {
        autoDeploy: false,
        onStage: (message) =>
          setStageAndMaybeLog(message, "MODEL", "INFO", true),
        onLog: (message) => pushLog("INFO", "MODEL", message),
        onProgress: (p) => applyProgress(p),
      });
      await refreshLocal(current);
      await refreshLastCheckDecision(current);
      setStageAndMaybeLog("更新模型完成", "MODEL", "SUCCESS", true);
    } catch (e: any) {
      setStageAndMaybeLog(
        `更新模型失败：${String(e?.message ?? e)}`,
        "MODEL",
        "ERROR",
        true,
      );
    } finally {
      setBusy(false);
      setShowProgress(false);
      setProgressValue(undefined);
    }
  }

  async function onDeploy() {
    if (!(await guardPathAccess(true))) return;
    setBusy(true);
    setShowProgress(false); // ✅ 部署不显示下载进度
    setStageAndMaybeLog("部署中…", "DEPLOY", "INFO", true);
    setProgressPct("0.00%");
    setProgressValue(undefined);
    try {
      const current = loadConfig();
      await deployInputMethod(
        current,
        wrapStageReporter("DEPLOY"),
        wrapDetailLogger("DEPLOY"),
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === "当前不支持自动部署，请到工具(Tools)-Rime输入法(Rime Input Method)手动部署") {
        setStageAndMaybeLog(msg, "DEPLOY", "INFO", true);
        return;
      }
      setStageAndMaybeLog(
        `部署失败：${msg}`,
        "DEPLOY",
        "ERROR",
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  function renderLogEntry(entry: LogEntry) {
    return <LogEntryRow key={entry.id} entry={entry} />;
  }

  function renderEditorTab() {
    const atRoot =
      !editorRootPath || isSameEditorPath(editorCurrentPath, editorRootPath);
    const title = editorCurrentPath
      ? Path.basename(editorCurrentPath) || "编辑"
      : "编辑";
    const goEditorParent = () => {
      const root = normalizePath(editorRootPath);
      const current = normalizePath(editorCurrentPath);
      if (!current || !root) return;
      const parent = normalizePath(Path.dirname(current));
      if (!parent || !isAtOrBelowEditorRoot(parent, root)) {
        setEditorCurrentPath(root);
        return;
      }
      setEditorCurrentPath(parent);
    };
    return (
      <NavigationStack>
        <List
          navigationTitle={title}
          navigationBarTitleDisplayMode={"inline"}
          listStyle={"insetGroup"}
          toolbar={{
            topBarLeading: renderLeadingToolbar(),
            topBarTrailing: renderEditorTrailingToolbar(),
          }}
        >
          <Section header={<Text>当前目录</Text>}>
            <Text>{editorCurrentPath || "未选择文件夹"}</Text>
          </Section>

          <Section
            header={
              <HStack
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              >
                <Text>目录内容</Text>
                <Spacer />
                {editorCurrentPath && !atRoot ? (
                  <Button action={goEditorParent}>
                    <Image
                      systemName="arrow.up.circle"
                      foregroundStyle="systemBlue"
                    />
                  </Button>
                ) : null}
              </HStack>
            }
          >
            {!editorCurrentPath ? (
              <Text foregroundStyle="secondaryLabel">
                当前没有可浏览的书签目录。
              </Text>
            ) : editorLoading ? (
              <Text foregroundStyle="secondaryLabel">加载中...</Text>
            ) : editorEntries.length ? (
              editorEntries.map((entry) => (
                <Button
                  key={entry.path}
                  action={() => {
                    try {
                      (globalThis as any).HapticFeedback?.mediumImpact?.();
                    } catch {}
                    if (entry.isDirectory) {
                      setEditorCurrentPath(entry.path);
                    } else {
                      void openEditorFile(entry.path);
                    }
                  }}
                >
                  <HStack>
                    <Image
                      systemName={entry.isDirectory ? "folder" : "doc.text"}
                      foregroundStyle={
                        entry.isDirectory ? "systemBlue" : "secondaryLabel"
                      }
                    />
                    <Text
                      frame={{
                        maxWidth: "infinity",
                        alignment: "leading" as any,
                      }}
                    >
                      {entry.name}
                    </Text>
                    {entry.isDirectory ? (
                      <Image
                        systemName="chevron.right"
                        foregroundStyle="tertiaryLabel"
                      />
                    ) : null}
                  </HStack>
                </Button>
              ))
            ) : (
              <Text foregroundStyle="secondaryLabel">当前目录为空。</Text>
            )}
          </Section>
        </List>
      </NavigationStack>
    );
  }

  function renderFloatingActions() {
    const currentCheckReady = lastCheckKey === checkKey(cfg) && !!lastCheckDecision;
    const modelEnabled = cfg.downloadModel;
    const hasModelUpdate = modelEnabled && !!lastCheckDecision?.model;
    const autoUpdateReady =
      currentCheckReady &&
      !!(lastCheckDecision?.scheme || lastCheckDecision?.dict || hasModelUpdate);
    const schemeColor = currentCheckReady && lastCheckDecision?.scheme ? "systemGreen" : "systemBlue";
    const dictColor = currentCheckReady && lastCheckDecision?.dict ? "systemGreen" : "systemBlue";
    const modelColor = currentCheckReady && hasModelUpdate ? "systemGreen" : "systemBlue";
    const rimeGroupColor =
      currentCheckReady && (lastCheckDecision?.scheme || lastCheckDecision?.dict || hasModelUpdate)
        ? "systemGreen"
        : "systemBlue";
    const autoUpdateColor = autoUpdateReady ? "systemGreen" : "systemBlue";
    const disabled = busy || !pathUsable;

    const toggleGroup = (group: "rime" | "update") => {
      try {
        (globalThis as any).HapticFeedback?.mediumImpact?.();
      } catch {}
      setActiveActionGroup((current) => (current === group ? null : group));
    };
    const runAction = (action: () => void) => {
      setActiveActionGroup(null);
      action();
    };

    return (
      <VStack
        spacing={18}
        padding={{ trailing: 18, bottom: 48, leading: 18 }}
        frame={{
          maxWidth: "infinity",
          maxHeight: "infinity",
          alignment: "bottomTrailing" as any,
        }}
      >
        <FloatingActionGroup
          icon="r.square.fill"
          color={rimeGroupColor}
          expanded={activeActionGroup === "rime"}
          disabled={disabled}
          items={[
            { icon: "doc.text", title: "方案", color: schemeColor, disabled, onPress: () => runAction(onUpdateScheme) },
            { icon: "books.vertical", title: "词库", color: dictColor, disabled, onPress: () => runAction(onUpdateDict) },
            ...(modelEnabled ? [{ icon: "shippingbox", title: "模型", color: modelColor, disabled, onPress: () => runAction(onUpdateModel) }] : []),
          ]}
          onToggle={() => toggleGroup("rime")}
        />
        <FloatingActionGroup
          icon="bolt.fill"
          color={autoUpdateColor}
          expanded={activeActionGroup === "update"}
          disabled={disabled}
          items={[
            { icon: "paperplane", title: "部署", disabled, onPress: () => runAction(onDeploy) },
            { icon: "arrow.triangle.2.circlepath", title: "检查", disabled, onPress: () => runAction(onCheckUpdate) },
            { icon: "bolt.fill", title: "自动", color: autoUpdateColor, disabled, onPress: () => runAction(onAutoUpdate) },
          ]}
          onToggle={() => toggleGroup("update")}
        />
      </VStack>
    );
  }

  function renderSection(key: HomeSectionKey) {
    if (key === "local") {
      const currentCheckReady = lastCheckKey === checkKey(cfg) && !!lastCheckDecision;
      const schemeValueColor = currentCheckReady && lastCheckDecision?.scheme ? "systemGreen" : undefined;
      const dictValueColor = currentCheckReady && lastCheckDecision?.dict ? "systemGreen" : undefined;
      const modelValueColor = currentCheckReady && cfg.downloadModel && lastCheckDecision?.model ? "systemGreen" : undefined;
      return (
        <Section key={key} header={<Text>本地信息</Text>}>
          <RowKV k="当前选择的方案" v={localSelectedScheme} />
          <RowKV k="本地方案" v={localSchemeVersion} valueColor={schemeValueColor} />
          <RowKV k="本地词库" v={localDictMark} valueColor={dictValueColor} />
          {cfg.downloadModel ? <RowKV k="本地模型" v={localModelMark} valueColor={modelValueColor} /> : null}
        </Section>
      );
    }
    if (key === "remote") {
      return (
        <Section key={key} header={<Text>远程信息</Text>}>
          <RowKV k="远程方案" v={remoteSchemeVer} />
          <RowKV k="远程词库" v={remoteDictMark} />
          {cfg.downloadModel ? <RowKV k="远程模型" v={remoteModelMark} /> : null}
        </Section>
      );
    }
    if (key === "notes") {
      return (
        <Section
          key={key}
          header={
            <HStack
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              <Text>更新说明</Text>
              <Spacer />
              <Button
                buttonStyle="plain"
                action={() => {
                  try {
                    (globalThis as any).HapticFeedback?.mediumImpact?.();
                  } catch {}
                  void openFullscreenNotes();
                }}
              >
                <Image
                  systemName={FULLSCREEN_SYMBOL}
                  foregroundStyle="systemBlue"
                />
              </Button>
            </HStack>
          }
        >
          <ScrollView frame={{ height: 220 }} padding>
            <Markdown content={notes} />
          </ScrollView>
        </Section>
      );
    }
    return (
      <Section
        key={key}
        header={
          <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
            <Text>状态</Text>
            <Spacer />
            {cfg.showVerboseLog ? (
              <Button
                buttonStyle="plain"
                disabled={busy}
                action={() => {
                  try {
                    (globalThis as any).HapticFeedback?.mediumImpact?.();
                  } catch {}
                  void openFullscreenLogs();
                }}
              >
                <Image
                  systemName={FULLSCREEN_SYMBOL}
                  foregroundStyle={busy ? "secondaryLabel" : "systemBlue"}
                />
              </Button>
            ) : null}
          </HStack>
        }
      >
        {cfg.showVerboseLog ? (
          <VStack
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            spacing={0}
          >
            <ScrollViewReader>
              {(proxy: any) => {
                logProxyRef.current = proxy;
                return (
                  <VStack
                    frame={{
                      maxWidth: "infinity",
                      alignment: "topLeading" as any,
                    }}
                    spacing={0}
                  >
                    <ScrollView
                      frame={{ height: 280, maxWidth: "infinity" as any }}
                      padding={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
                    >
                      <VStack
                        spacing={1}
                        frame={{
                          maxWidth: "infinity",
                          alignment: "topLeading" as any,
                        }}
                      >
                        {logs.length ? (
                          logs.map(renderLogEntry)
                        ) : (
                          <Text
                            font="footnote"
                            foregroundStyle="secondaryLabel"
                            frame={{
                              maxWidth: "infinity",
                              alignment: "leading" as any,
                            }}
                            multilineTextAlignment="leading"
                          >
                            暂无详细日志
                          </Text>
                        )}
                        <Rectangle
                          key="bottomView"
                          foregroundStyle="clear"
                          frame={{
                            maxWidth: "infinity",
                            alignment: "leading" as any,
                            height: 0,
                          }}
                        />
                      </VStack>
                    </ScrollView>
                  </VStack>
                );
              }}
            </ScrollViewReader>

            {busy && showProgress ? (
              <VStack spacing={8} padding={{ top: 8 }}>
                <Divider />
                <HStack alignment="center" spacing={8}>
                  <Text frame={{ alignment: "leading" as any }}>
                    {progressStageLabel(stage)}
                  </Text>
                  {typeof progressValue === "number" ? (
                    <ProgressView
                      value={progressValue}
                      total={1}
                      progressViewStyle="linear"
                      frame={{ maxWidth: "infinity" }}
                    />
                  ) : (
                    <ProgressView
                      progressViewStyle="linear"
                      frame={{ maxWidth: "infinity" }}
                    />
                  )}
                  <Text>{progressPct}</Text>
                </HStack>
              </VStack>
            ) : null}
          </VStack>
        ) : (
          <VStack spacing={8} frame={{ maxWidth: "infinity", minHeight: 128 }}>
            <Text>{stage}</Text>

            {busy && showProgress ? (
              <HStack alignment="center" spacing={8}>
                {typeof progressValue === "number" ? (
                  <ProgressView
                    value={progressValue}
                    total={1}
                    progressViewStyle="linear"
                    frame={{ maxWidth: "infinity" }}
                  />
                ) : (
                  <ProgressView
                    progressViewStyle="linear"
                    frame={{ maxWidth: "infinity" }}
                  />
                )}
                <Text>{progressPct}</Text>
              </HStack>
            ) : null}
          </VStack>
        )}
      </Section>
    );
  }

  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      alert={{
        title: alert.title,
        isPresented: alert.isPresented,
        onChanged: (v) => setAlert((a) => ({ ...a, isPresented: v })),
        message: alert.message,
        actions: alert.actions,
      }}
      sheet={releaseNotesSheet}
    >
      <AdaptiveHomeTabView
        selection={activeTab as any}
        editor={renderEditorTab()}
        main={
          <ZStack>
            <NavigationStack>
              <List
                navigationTitle={"万象工具"}
                navigationBarTitleDisplayMode={"inline"}
                listStyle={"insetGroup"}
                toolbar={{
                  topBarLeading: renderLeadingToolbar(),
                  topBarTrailing: renderMainTrailingToolbar(),
                }}
              >
                {cfg.homeSectionOrder.map(renderSection)}
              </List>
            </NavigationStack>
            {renderFloatingActions()}
          </ZStack>
        }
        settings={
          <NavigationStack>
            <SettingsView
              initial={cfg}
              leadingToolbar={renderLeadingToolbar()}
              trailingToolbar={renderSettingsTrailingToolbar()}
              registerSaveAction={(fn) => {
                settingsSaveRef.current = fn;
              }}
              onDone={(newCfg) => {
                void handleSettingsSaved(newCfg);
              }}
            />
          </NavigationStack>
        }
      />
    </VStack>
  );
}
