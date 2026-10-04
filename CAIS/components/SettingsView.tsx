import {
  Button,
  EmptyView,
  ForEach,
  Form,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Stepper,
  Text,
  TextField,
  Toggle,
  VStack,
  useState,
  useRef,
} from "scripting";

import type {
  CaisSettings,
  ClipboardClearRange,
  KeyboardCustomAction,
  KeyboardCustomActionMode,
  KeyboardMenuBuiltinAction,
  KeyboardMenuSettings,
} from "../types";
import { makeId } from "../utils/common";
import {
  JAVASCRIPT_ACTION_EXAMPLE,
  NETWORK_REQUEST_EXAMPLE,
  validateRegexPattern,
  validateJavaScriptTransform,
  validateNetworkRequest,
  validateRuntimeTemplate,
} from "../utils/custom_action";
import type { LanShareRuntimeStatus } from "../services/lan_share_server";
import type { NavigationZoomNamespace, NavigationZoomTransition } from "../utils/navigation_zoom";
import { FieldPrivacyRulesView } from "./FieldPrivacyRulesView";
import { LanShareSettingsView } from "./LanShareSettingsView";
import {
  groupMenuBuiltins,
  getOrderedMenuBuiltins,
  menuBuiltinSystemImage,
  menuBuiltinTitle,
} from "../utils/menu_actions";

const INTERVAL_OPTIONS = [100, 200, 300, 400, 500];
const MAX_ITEM_OPTIONS = [200, 500, 800];
const KEYBOARD_MAX_ITEM_OPTIONS = [10, 20, 30, 40, 50];
const CLIPBOARD_CLEAR_OPTIONS: Array<{ range: ClipboardClearRange; title: string }> = [
  { range: "recent", title: "最近内容" },
  { range: "threeDays", title: "近三天" },
  { range: "sevenDays", title: "近七天" },
  { range: "older", title: "更早" },
];
const APP_CONTENT_LINE_MIN = 1;
const APP_CONTENT_LINE_MAX = 12;
const JAVASCRIPT_HELP = [
  "函数名必须是 transform，只接收一个文本参数 text，返回文本或 { text }。",
  "trim(): 移除首尾空白",
  "replace(a, b): 替换内容，可配合正则使用",
  "match(regexp): 获取匹配结果",
  "split(text): 拆分字符串",
  "join(text): 合并数组为字符串",
  "toUpperCase(): 转为大写",
  "toLowerCase(): 转为小写",
  "slice(start, end): 截取字符串",
].join("\n");
const NETWORK_REQUEST_HELP = [
  "函数名必须是 request，只接收一个文本参数 text，可使用 await fetch(...)。",
  '当前内容可直接用 text，也可在字符串中写 "{{text}}"。',
  "返回文本或 { text }。",
  "返回内容为空时不会写入剪贴板，也不会保存新记录。",
].join("\n");

function MenuBuiltinGroupView(props: {
  title: string;
  actions: KeyboardMenuBuiltinAction[];
  settings: CaisSettings;
  ungrouped: KeyboardMenuBuiltinAction[];
  navigationTransition?: NavigationZoomTransition;
  onChanged: (key: KeyboardMenuBuiltinAction, value: boolean) => void;
  onPlacementChanged: (key: KeyboardMenuBuiltinAction, ungrouped: boolean) => void;
  onMove: (actions: KeyboardMenuBuiltinAction[], indices: number[], newOffset: number) => void;
}) {
  const [actions, setActions] = useState(props.actions);
  const [builtins, setBuiltins] = useState(props.settings.keyboardMenu.builtins);
  const [ungrouped, setUngrouped] = useState(props.ungrouped);

  function move(indices: number[], newOffset: number) {
    const moving = indices.map((index) => actions[index]).filter(Boolean);
    const rest = actions.filter((_, index) => !indices.includes(index));
    rest.splice(newOffset, 0, ...moving);
    setActions(rest);
    props.onMove(actions, indices, newOffset);
  }

  return (
    <List
      navigationTitle={props.title}
      navigationBarTitleDisplayMode="inline"
      navigationTransition={props.navigationTransition}
    >
      <Section>
        <ForEach
          count={actions.length}
          itemBuilder={(index) => {
            const action = actions[index];
            return action ? (
              <VStack key={action}>
                <Toggle
                  value={builtins[action]}
                  onChanged={(value: boolean) => {
                    setBuiltins({ ...builtins, [action]: value });
                    props.onChanged(action, value);
                  }}
                  toggleStyle="switch"
                >
                  <HStack>
                    <Image systemName={menuBuiltinSystemImage(action)} />
                    <Text>{menuBuiltinTitle(action)}</Text>
                  </HStack>
                </Toggle>
                <Picker
                  title="菜单位置"
                  pickerStyle="menu"
                  value={ungrouped.includes(action) ? 1 : 0}
                  onChanged={(index: number) => {
                    const next = new Set(ungrouped);
                    if (index === 1) next.add(action);
                    else next.delete(action);
                    setUngrouped([...next]);
                    props.onPlacementChanged(action, index === 1);
                  }}
                >
                  <Text tag={0}>分组</Text>
                  <Text tag={1}>外层</Text>
                </Picker>
              </VStack>
            ) : <EmptyView />;
          }}
          onMove={move}
        />
      </Section>
    </List>
  );
}

function CustomMenuActionsView(props: {
  actions: KeyboardCustomAction[];
  zoomNamespace?: NavigationZoomNamespace;
  navigationTransition?: NavigationZoomTransition;
  onEdit: (action?: KeyboardCustomAction) => void;
  onUpdate: (id: string, patch: Partial<KeyboardCustomAction>) => void;
  onRemove: (id: string) => void;
  onMove: (indices: number[], newOffset: number) => void;
}) {
  return (
    <List
      navigationTitle="自定义功能"
      navigationBarTitleDisplayMode="inline"
      navigationTransition={props.navigationTransition}
    >
      <Section>
        {props.actions.length ? (
          <ForEach
            count={props.actions.length}
            itemBuilder={(index) => {
              const action = props.actions[index];
              return action ? (
                <HStack
                  key={action.id}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button title="" systemImage="square.and.pencil" tint="systemOrange" action={() => props.onEdit(action)} />,
                      <Button title="" systemImage="trash" role="destructive" tint="systemRed" action={() => props.onRemove(action.id)} />,
                    ],
                  }}
                >
                  <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{action.title}</Text>
                  <Spacer />
                  <Toggle
                    title=""
                    value={action.enabled}
                    onChanged={(enabled: boolean) => props.onUpdate(action.id, { enabled })}
                    toggleStyle="switch"
                  />
                </HStack>
              ) : <EmptyView />;
            }}
            onMove={props.onMove}
          />
        ) : (
          <Text foregroundStyle="secondaryLabel">暂无自定义功能</Text>
        )}
        <Button
          title="添加自定义功能"
          systemImage="plus"
          matchedTransitionSource={props.zoomNamespace ? {
            id: "custom-action-add",
            namespace: props.zoomNamespace,
          } : undefined}
          action={() => props.onEdit()}
        />
      </Section>
    </List>
  );
}

function KeyboardMenuSettingsPage(props: {
  settings: CaisSettings;
  navigationTransition?: NavigationZoomTransition;
  zoomNamespace?: NavigationZoomNamespace;
  onMenuSettingsChanged: (settings: KeyboardMenuSettings) => void;
  onCustomEdit: (action: KeyboardCustomAction | undefined, onSaved: (action: KeyboardCustomAction) => void) => void;
}) {
  const [menuSettings, setMenuSettings] = useState(props.settings.keyboardMenu);
  const pageSettings = { ...props.settings, keyboardMenu: menuSettings };
  const actionGroups = groupMenuBuiltins(
    getOrderedMenuBuiltins(pageSettings).filter((key) => key !== "pin" && key !== "favorite"),
  );

  function commit(next: KeyboardMenuSettings) {
    setMenuSettings(next);
    props.onMenuSettingsChanged(next);
  }

  function updateBuiltin(key: KeyboardMenuBuiltinAction, value: boolean) {
    commit({ ...menuSettings, builtins: { ...menuSettings.builtins, [key]: value } });
  }

  function updatePlacement(key: KeyboardMenuBuiltinAction, ungrouped: boolean) {
    const next = new Set(menuSettings.ungroupedBuiltins);
    if (ungrouped) next.add(key);
    else next.delete(key);
    commit({ ...menuSettings, ungroupedBuiltins: [...next] });
  }

  function moveBuiltins(groupActions: KeyboardMenuBuiltinAction[], indices: number[], newOffset: number) {
    const ordered = getOrderedMenuBuiltins(pageSettings);
    const groupSet = new Set(groupActions);
    const groupOrder = ordered.filter((key) => groupSet.has(key));
    const moving = indices.map((index) => groupOrder[index]).filter(Boolean);
    const rest = groupOrder.filter((_, index) => !indices.includes(index));
    rest.splice(newOffset, 0, ...moving);
    let groupIndex = 0;
    const nextOrder = ordered.map((key) => groupSet.has(key) ? rest[groupIndex++] : key);
    commit({ ...menuSettings, builtinOrder: nextOrder });
  }

  function updateCustom(id: string, patch: Partial<KeyboardCustomAction>) {
    commit({ ...menuSettings, customActions: menuSettings.customActions.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }

  function removeCustom(id: string) {
    commit({ ...menuSettings, customActions: menuSettings.customActions.filter((item) => item.id !== id) });
  }

  function moveCustom(indices: number[], newOffset: number) {
    const moving = indices.map((index) => menuSettings.customActions[index]).filter(Boolean);
    const rest = menuSettings.customActions.filter((_, index) => !indices.includes(index));
    rest.splice(newOffset, 0, ...moving);
    commit({ ...menuSettings, customActions: rest });
  }

  function editCustom(action?: KeyboardCustomAction) {
    props.onCustomEdit(action, (saved) => {
      const exists = menuSettings.customActions.some((item) => item.id === saved.id);
      const customActions = exists
        ? menuSettings.customActions.map((item) => item.id === saved.id ? saved : item)
        : [...menuSettings.customActions, saved].slice(0, 12);
      commit({ ...menuSettings, customActions });
    });
  }
  return (
    <List
      navigationTitle="长按菜单"
      navigationBarTitleDisplayMode="inline"
      navigationTransition={props.navigationTransition}
    >
      <Section footer={<Text>关闭后，已启用的内置和自定义功能会平铺显示。</Text>}>
        <Toggle
          value={menuSettings.grouped}
          onChanged={(grouped) => commit({ ...menuSettings, grouped })}
          toggleStyle="switch"
        >
          <Text>按类别分组</Text>
        </Toggle>
      </Section>
      <Section header={<Text>内置功能</Text>}>
        {actionGroups.map((group) => (
          <NavigationLink
            key={group.id}
            destination={
              <MenuBuiltinGroupView
                title={group.title}
                actions={group.actions}
                settings={pageSettings}
                ungrouped={menuSettings.ungroupedBuiltins}
                navigationTransition={props.zoomNamespace ? {
                  type: "zoom",
                  sourceID: `long-press-builtin:${group.id}`,
                  namespace: props.zoomNamespace,
                } : undefined}
                onChanged={updateBuiltin}
                onPlacementChanged={updatePlacement}
                onMove={(actions, indices, newOffset) => moveBuiltins(actions, indices, newOffset)}
              />
            }
          >
            <HStack
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              background="rgba(0,0,0,0.001)"
              contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
              matchedTransitionSource={props.zoomNamespace ? {
                id: `long-press-builtin:${group.id}`,
                namespace: props.zoomNamespace,
              } : undefined}
            >
              <Image systemName={group.systemImage} />
              <Text>{group.title}</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{group.actions.length}</Text>
            </HStack>
          </NavigationLink>
        ))}
      </Section>
      <Section header={<Text>自定义功能</Text>}>
        <NavigationLink
          destination={
            <CustomMenuActionsView
              actions={menuSettings.customActions}
              zoomNamespace={props.zoomNamespace}
              navigationTransition={props.zoomNamespace ? {
                type: "zoom",
                sourceID: "long-press-custom-actions",
                namespace: props.zoomNamespace,
              } : undefined}
              onEdit={editCustom}
              onUpdate={updateCustom}
              onRemove={removeCustom}
              onMove={moveCustom}
            />
          }
        >
          <HStack
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            background="rgba(0,0,0,0.001)"
            contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
            matchedTransitionSource={props.zoomNamespace ? {
              id: "long-press-custom-actions",
              namespace: props.zoomNamespace,
            } : undefined}
          >
            <Image systemName="wand.and.stars" />
            <Text>自定义功能</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{menuSettings.customActions.length}</Text>
          </HStack>
        </NavigationLink>
      </Section>
    </List>
  );
}

function optionIndex(options: number[], value: number): number {
  const index = options.findIndex((item) => item === value);
  return index >= 0 ? index : 0;
}

function customActionModeIndex(mode: KeyboardCustomActionMode): number {
  if (mode === "regexExtract") return 1;
  if (mode === "regexRemove") return 2;
  if (mode === "javascript") return 3;
  if (mode === "networkRequest") return 4;
  return 0;
}

function customActionModeFromIndex(index: number): KeyboardCustomActionMode {
  if (index === 1) return "regexExtract";
  if (index === 2) return "regexRemove";
  if (index === 3) return "javascript";
  if (index === 4) return "networkRequest";
  return "template";
}

function CustomActionEditorView(props: {
  action?: KeyboardCustomAction;
  embedded?: boolean;
  navigationTransition?: NavigationZoomTransition;
  onCancel?: () => void;
  onSave?: (action: KeyboardCustomAction) => void;
}) {
  const dismiss = Navigation.useDismiss();
  const [title, setTitle] = useState(props.action?.title ?? "");
  const [mode, setMode] = useState<KeyboardCustomActionMode>(
    props.action?.mode ?? "template",
  );
  const [template, setTemplate] = useState(
    props.action?.template ?? "{{text}}",
  );
  const [regex, setRegex] = useState(props.action?.regex ?? "");
  const [regexRemoveAll, setRegexRemoveAll] = useState(
    Boolean(props.action?.regexRemoveAll ?? true),
  );
  const [script, setScript] = useState(
    props.action?.script ?? (props.action?.mode === "networkRequest" ? NETWORK_REQUEST_EXAMPLE : JAVASCRIPT_ACTION_EXAMPLE),
  );
  const [writeToClipboard, setWriteToClipboard] = useState(
    Boolean(props.action?.writeToClipboard ?? true),
  );

  async function save() {
    const fixedTitle = title.trim();
    const fixedTemplate = template.trim();
    const fixedRegex = regex.trim();
    const fixedScript = script.trim();
    if (!fixedTitle) {
      await Dialog.alert({ message: "请输入功能名称" });
      return;
    }
    if (mode === "template" && !fixedTemplate) {
      await Dialog.alert({ message: "请输入模板内容" });
      return;
    }
    if (mode === "networkRequest" && !fixedScript) {
      await Dialog.alert({ message: "请输入网络请求脚本" });
      return;
    }
    if ((mode === "regexExtract" || mode === "regexRemove") && !fixedRegex) {
      await Dialog.alert({ message: "请输入正则表达式" });
      return;
    }
    if (mode === "javascript" && !fixedScript) {
      await Dialog.alert({ message: "请输入 JavaScript 函数" });
      return;
    }
    if (mode === "template") {
      const templateError = validateRuntimeTemplate(fixedTemplate);
      if (templateError) {
        await Dialog.alert({ title: "模板错误", message: templateError });
        return;
      }
    }
    if (mode === "regexExtract" || mode === "regexRemove") {
      const regexError = validateRegexPattern(
        fixedRegex,
        mode === "regexRemove" && regexRemoveAll,
      );
      if (regexError) {
        await Dialog.alert({
          title: "正则表达式错误",
          message: regexError,
        });
        return;
      }
    }
    if (mode === "javascript") {
      const scriptError = validateJavaScriptTransform(fixedScript);
      if (scriptError) {
        await Dialog.alert({
          title: "JavaScript 错误",
          message: scriptError,
        });
        return;
      }
    }
    if (mode === "networkRequest") {
      const scriptError = validateNetworkRequest(fixedScript);
      if (scriptError) {
        await Dialog.alert({
          title: "网络请求错误",
          message: scriptError,
        });
        return;
      }
    }
    const next = {
      id: props.action?.id ?? makeId("menu"),
      title: fixedTitle,
      mode,
      template: mode === "template" ? fixedTemplate : "",
      regex: mode === "regexExtract" || mode === "regexRemove" ? fixedRegex : "",
      regexRemoveAll: mode === "regexRemove" ? regexRemoveAll : false,
      script: mode === "javascript" || mode === "networkRequest" ? fixedScript : "",
      writeToClipboard: mode === "networkRequest" ? writeToClipboard : true,
      enabled: props.action?.enabled ?? true,
    };
    if (props.onSave) {
      props.onSave(next);
    } else {
      dismiss(next);
    }
  }

  function cancel() {
    if (props.onCancel) {
      props.onCancel();
    } else {
      dismiss(null);
    }
  }

  const form = (
    <Form
        navigationTransition={props.navigationTransition}
        navigationTitle={props.action ? "编辑功能" : "添加功能"}
        navigationBarTitleDisplayMode="inline"
        tabBarVisibility={props.embedded ? "visible" : undefined}
        formStyle="grouped"
        presentationDetents={[0.72, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: props.embedded
            ? undefined
            : <Button title="取消" role="cancel" action={cancel} />,
          topBarTrailing: <Button title="保存" action={() => void save()} />,
        }}
      >
        <Section header={<Text>基本信息</Text>}>
          <TextField
            title="名称"
            value={title}
            prompt="例如：提取手机号"
            onChanged={setTitle}
          />
          <Picker
            title="类型"
            pickerStyle="menu"
            value={customActionModeIndex(mode)}
            onChanged={(index: number) => {
              const nextMode = customActionModeFromIndex(index);
              if (nextMode === "networkRequest" && script === JAVASCRIPT_ACTION_EXAMPLE) {
                setScript(NETWORK_REQUEST_EXAMPLE);
              } else if (nextMode === "javascript" && script === NETWORK_REQUEST_EXAMPLE) {
                setScript(JAVASCRIPT_ACTION_EXAMPLE);
              }
              setMode(nextMode);
            }}
          >
            <Text tag={0}>模板替换</Text>
            <Text tag={1}>正则提取</Text>
            <Text tag={2}>正则删除</Text>
            <Text tag={3}>JavaScript 转换</Text>
            <Text tag={4}>网络请求</Text>
          </Picker>
        </Section>

        {mode === "template" ? (
          <Section
            header={<Text>模板</Text>}
            footer={
              <Text>
                {
                  "可使用 {{text}}、{{date}}、{{time}}、{{datetime}}、{{timestamp}}。"
                }
              </Text>
            }
          >
            <TextField
              title=""
              value={template}
              prompt={'例如："{{text}}" - {{datetime}}'}
              axis="vertical"
              frame={{
                minHeight: 92,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setTemplate}
            />
          </Section>
        ) : mode === "javascript" ? (
          <Section
            header={<Text>JavaScript 函数</Text>}
            footer={
              <Text>{JAVASCRIPT_HELP}</Text>
            }
          >
            <TextField
              title=""
              value={script}
              prompt={JAVASCRIPT_ACTION_EXAMPLE}
              axis="vertical"
              frame={{
                minHeight: 170,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setScript}
            />
          </Section>
        ) : mode === "networkRequest" ? (
          <Section
            header={<Text>网络请求</Text>}
            footer={<Text>{NETWORK_REQUEST_HELP}</Text>}
          >
            <TextField
              title=""
              value={script}
              prompt={NETWORK_REQUEST_EXAMPLE}
              axis="vertical"
              frame={{
                minHeight: 170,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setScript}
            />
            <Toggle
              value={writeToClipboard}
              onChanged={(value: boolean) => setWriteToClipboard(value)}
              toggleStyle="switch"
            >
              <Text>结果写入剪贴板</Text>
            </Toggle>
          </Section>
        ) : (
          <Section
            header={<Text>正则表达式</Text>}
            footer={
              <Text>
                {mode === "regexRemove"
                  ? "应用时会移除命中的内容。"
                  : "应用时会插入第一个捕获组；没有捕获组时插入完整匹配结果。"}
              </Text>
            }
          >
            <TextField
              title=""
              value={regex}
              prompt={
                mode === "regexRemove"
                  ? "例如：\\s+"
                  : "例如：[\\w.-]+@[\\w.-]+\\.[A-Za-z]{2,}"
              }
              axis="vertical"
              frame={{
                minHeight: 92,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setRegex}
            />
            {mode === "regexRemove" ? (
              <Toggle
                title="删除全部匹配"
                value={regexRemoveAll}
                onChanged={setRegexRemoveAll}
                toggleStyle="switch"
              />
            ) : null}
          </Section>
        )}
    </Form>
  );

  return props.embedded ? form : <NavigationStack>{form}</NavigationStack>;
}

export function SettingsView(props: {
  value: CaisSettings;
  onChanged: (settings: CaisSettings) => void;
  onClearFavorites?: () => void;
  onClearClipboard?: (range: ClipboardClearRange) => void;
  lanShareStatus?: LanShareRuntimeStatus;
  onRotateLanShareToken?: () => void;
  leadingToolbar?: any;
  trailingToolbar?: any;
  embeddedNavigation?: boolean;
  keepHomeNavigationDestination?: boolean;
  zoomNamespace?: NavigationZoomNamespace;
}) {
  const settings = props.value;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [embeddedCustomAction, setEmbeddedCustomAction] = useState<KeyboardCustomAction | null | undefined>(undefined);
  const [embeddedCustomActionPresented, setEmbeddedCustomActionPresented] = useState(false);
  const [keyboardMenuPresented, setKeyboardMenuPresented] = useState(false);
  const [privacyRulesPresented, setPrivacyRulesPresented] = useState(false);
  const [privacyRulesSessionId, setPrivacyRulesSessionId] = useState("");
  const embeddedCustomActionSavedRef = useRef<((action: KeyboardCustomAction) => void) | null>(null);

  function update(next: Partial<CaisSettings>) {
    props.onChanged({ ...settingsRef.current, ...next });
  }

  function renderToolbar() {
    if (!props.leadingToolbar && !props.trailingToolbar) return undefined;
    return {
      topBarLeading: props.leadingToolbar,
      topBarTrailing: props.trailingToolbar,
    };
  }

  function saveCustomAction(action: KeyboardCustomAction) {
    const current = settingsRef.current;
    const exists = current.keyboardMenu.customActions.some(
      (item) => item.id === action.id,
    );
    update({
      keyboardMenu: {
        ...current.keyboardMenu,
        customActions: exists
          ? current.keyboardMenu.customActions.map((item) =>
              item.id === action.id ? action : item,
            )
          : [...current.keyboardMenu.customActions, action].slice(0, 12),
      },
    });
  }

  async function presentCustomActionEditor(
    action?: KeyboardCustomAction,
    onSaved?: (action: KeyboardCustomAction) => void,
  ) {
    if (props.embeddedNavigation) {
      embeddedCustomActionSavedRef.current = onSaved ?? null;
      setEmbeddedCustomAction(action ?? null);
      setEmbeddedCustomActionPresented(true);
      return;
    }
    const next = await Navigation.present<KeyboardCustomAction | null>({
      element: <CustomActionEditorView action={action} />,
      modalPresentationStyle: "pageSheet",
    });
    if (next) {
      saveCustomAction(next);
      onSaved?.(next);
    }
  }

  async function presentKeyboardMenuSettings() {
    if (props.embeddedNavigation) {
      setKeyboardMenuPresented(true);
      return;
    }
    await Navigation.present({
      element: (
        <NavigationStack>
          <KeyboardMenuSettingsPage
            settings={settings}
            onMenuSettingsChanged={(keyboardMenu) => update({ keyboardMenu })}
            onCustomEdit={(action, onSaved) => void presentCustomActionEditor(action, onSaved)}
          />
        </NavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    });
  }

  async function presentPrivacyRulesEditor() {
    if (props.embeddedNavigation) {
      setPrivacyRulesSessionId(makeId("privacy-rules"));
      setPrivacyRulesPresented(true);
      return;
    }
    const value = await Navigation.present<string | null>({
      element: <FieldPrivacyRulesView
        key={makeId("privacy-rules")}
        initial={settings.favoriteFieldPrivateKeywords}
      />,
      modalPresentationStyle: "pageSheet",
    });
    if (value != null) update({ favoriteFieldPrivateKeywords: value });
  }

  return (
    <Form
      formStyle="grouped"
      toolbar={renderToolbar()}
      navigationDestination={props.keepHomeNavigationDestination || props.embeddedNavigation ? {
        isPresented: Boolean(props.embeddedNavigation && (embeddedCustomActionPresented || privacyRulesPresented || keyboardMenuPresented)),
        onChanged: (isPresented: boolean) => {
          if (!isPresented) {
            setEmbeddedCustomActionPresented(false);
            setEmbeddedCustomAction(undefined);
            embeddedCustomActionSavedRef.current = null;
            setPrivacyRulesPresented(false);
            setKeyboardMenuPresented(false);
          }
        },
        content: privacyRulesPresented ? (
          <FieldPrivacyRulesView
            key={privacyRulesSessionId}
            initial={settings.favoriteFieldPrivateKeywords}
            embedded
            navigationTransition={props.zoomNamespace ? {
              type: "zoom",
              sourceID: "privacy-rules-global",
              namespace: props.zoomNamespace,
            } : undefined}
            onSave={(value) => {
              update({ favoriteFieldPrivateKeywords: value });
              setPrivacyRulesPresented(false);
            }}
          />
        ) : embeddedCustomAction !== undefined ? (
          <CustomActionEditorView
            action={embeddedCustomAction ?? undefined}
            embedded
            navigationTransition={embeddedCustomAction === null && props.zoomNamespace ? {
              type: "zoom",
              sourceID: "custom-action-add",
              namespace: props.zoomNamespace,
            } : undefined}
            onCancel={() => setEmbeddedCustomActionPresented(false)}
            onSave={(action) => {
              saveCustomAction(action);
              embeddedCustomActionSavedRef.current?.(action);
              embeddedCustomActionSavedRef.current = null;
              setEmbeddedCustomActionPresented(false);
            }}
          />
        ) : keyboardMenuPresented ? (
          <KeyboardMenuSettingsPage
            settings={settings}
            zoomNamespace={props.zoomNamespace}
            navigationTransition={props.zoomNamespace ? {
              type: "zoom",
              sourceID: "keyboard-menu-settings",
              namespace: props.zoomNamespace,
            } : undefined}
            onMenuSettingsChanged={(keyboardMenu) => update({ keyboardMenu })}
            onCustomEdit={(action, onSaved) => void presentCustomActionEditor(action, onSaved)}
          />
        ) : <EmptyView />,
      } : undefined}
    >
      <Section header={<Text>数据管理</Text>}>
        <Toggle
          value={settings.iCloudSync}
          onChanged={(iCloudSync: boolean) => update({ iCloudSync })}
          toggleStyle="switch"
        >
          <HStack>
            <Image systemName="icloud" foregroundStyle="systemBlue" />
            <Text>iCloud 同步</Text>
          </HStack>
        </Toggle>
        {settings.iCloudSync ? (
          <Toggle
            value={settings.iCloudSyncImages}
            onChanged={(iCloudSyncImages: boolean) => update({ iCloudSyncImages })}
            toggleStyle="switch"
          >
            <HStack>
              <Image systemName="photo" foregroundStyle="systemGreen" />
              <Text>同步图片</Text>
            </HStack>
          </Toggle>
        ) : null}
        <NavigationLink
          destination={
            <LanShareSettingsView
              value={settings}
              status={props.lanShareStatus}
              onChanged={props.onChanged}
              onRotateToken={props.onRotateLanShareToken}
            />
          }
        >
          <HStack>
            <Image systemName="network" foregroundStyle="systemIndigo" />
            <Text>局域网共享</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {settings.lanSharingEnabled ? "已开启" : "已关闭"}
            </Text>
          </HStack>
        </NavigationLink>
        <Button
          title="清空收藏数据"
          systemImage="star.slash"
          role="destructive"
          action={() => props.onClearFavorites?.()}
        />
        <Button
          title="清空剪贴板数据"
          systemImage="trash"
          action={async () => {
            const actions = CLIPBOARD_CLEAR_OPTIONS.map((opt) => ({
              label: opt.title,
              destructive: true,
            }))
            const idx = await Dialog.actionSheet({
              title: "选择清理范围",
              actions,
            })
            if (idx != null) {
              const option = CLIPBOARD_CLEAR_OPTIONS[idx]
              if (option) {
                props.onClearClipboard?.(option.range)
              }
            }
          }}
        />
      </Section>

      <Section
        header={<Text>收藏设置</Text>}
        footer={<Text>分隔符与隐私规则均可在单个字段收藏中覆盖。隐私规则仅遮挡显示，复制和数据库仍保留原值。</Text>}
      >
        <TextField
          title="默认分隔符"
          value={settings.favoriteFieldDelimiter}
          prompt=":"
          onChanged={(value: string) => update({
            favoriteFieldDelimiter: value.replace(/[\r\n]/g, "").slice(0, 8),
          })}
        />
        <Toggle
          value={settings.favoriteFieldPrivacyEnabled}
          onChanged={(favoriteFieldPrivacyEnabled: boolean) => update({ favoriteFieldPrivacyEnabled })}
          toggleStyle="switch"
        >
          <Text>字段值隐私显示</Text>
        </Toggle>
        {settings.favoriteFieldPrivacyEnabled ? (
          <Button
            buttonStyle="plain"
            matchedTransitionSource={props.zoomNamespace ? {
              id: "privacy-rules-global",
              namespace: props.zoomNamespace,
            } : undefined}
            action={() => void presentPrivacyRulesEditor()}
          >
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text>子字段名规则</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel" lineLimit={1}>
                {settings.favoriteFieldPrivateKeywords.trim().replace(/\s+/g, " ").slice(0, 26) || "未设置"}
              </Text>
              <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
            </HStack>
          </Button>
        ) : null}
      </Section>

      <Section header={<Text>采集类型</Text>}>
        <Toggle
          value={settings.captureText}
          onChanged={(captureText: boolean) => update({ captureText })}
          toggleStyle="switch"
        >
          <Text>文本</Text>
        </Toggle>
        <Toggle
          value={settings.captureImages}
          onChanged={(captureImages: boolean) => update({ captureImages })}
          toggleStyle="switch"
        >
          <Text>图片</Text>
        </Toggle>
      </Section>

      <Section header={<Text>采集策略</Text>}>
        <Picker
          title="重复内容"
          pickerStyle="menu"
          value={settings.duplicatePolicy === "skip" ? 1 : 0}
          onChanged={(index: number) =>
            update({ duplicatePolicy: index === 1 ? "skip" : "bump" })
          }
        >
          <Text tag={0}>更新到顶部</Text>
          <Text tag={1}>跳过</Text>
        </Picker>
        <Picker
          title="监听间隔"
          pickerStyle="menu"
          value={optionIndex(INTERVAL_OPTIONS, settings.monitorIntervalMs)}
          onChanged={(index: number) =>
            update({ monitorIntervalMs: INTERVAL_OPTIONS[index] ?? 500 })
          }
        >
          {INTERVAL_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>
              {value} ms
            </Text>
          ))}
        </Picker>
        <Picker
          title="最多保留"
          pickerStyle="menu"
          value={optionIndex(MAX_ITEM_OPTIONS, settings.maxItems)}
          onChanged={(index: number) =>
            update({ maxItems: MAX_ITEM_OPTIONS[index] ?? 800 })
          }
        >
          {MAX_ITEM_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>
              {value} 条
            </Text>
          ))}
        </Picker>
        <Picker
          title="键盘保留条数"
          pickerStyle="menu"
          value={optionIndex(
            KEYBOARD_MAX_ITEM_OPTIONS,
            settings.keyboardMaxItems,
          )}
          onChanged={(index: number) =>
            update({ keyboardMaxItems: KEYBOARD_MAX_ITEM_OPTIONS[index] ?? 30 })
          }
        >
          {KEYBOARD_MAX_ITEM_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>
              {value} 条
            </Text>
          ))}
        </Picker>
      </Section>

      <Section header={<Text>界面显示</Text>}>
        <Stepper
          onIncrement={() =>
            update({
              appContentLineLimit: Math.min(
                APP_CONTENT_LINE_MAX,
                settings.appContentLineLimit + 1,
              ),
            })
          }
          onDecrement={() =>
            update({
              appContentLineLimit: Math.max(
                APP_CONTENT_LINE_MIN,
                settings.appContentLineLimit - 1,
              ),
            })
          }
        >
          <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text>内容显示行数</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {settings.appContentLineLimit} 行
            </Text>
          </HStack>
        </Stepper>
        <Toggle
          value={settings.appClipRowGlassEffect}
          onChanged={(appClipRowGlassEffect: boolean) => update({ appClipRowGlassEffect })}
          toggleStyle="switch"
        >
          <Text>条目卡片玻璃效果</Text>
        </Toggle>
        <Toggle
          value={settings.homeScreenEmbeddedNavigation}
          onChanged={(homeScreenEmbeddedNavigation: boolean) => update({ homeScreenEmbeddedNavigation })}
          toggleStyle="switch"
        >
          <Text>首页使用内嵌导航</Text>
        </Toggle>
        {settings.homeScreenEmbeddedNavigation ? (
          <Toggle
            value={settings.homeScreenNavigationAnimation}
            onChanged={(homeScreenNavigationAnimation: boolean) => update({ homeScreenNavigationAnimation })}
            toggleStyle="switch"
          >
            <Text>导航动画</Text>
          </Toggle>
        ) : null}
        <Toggle
          value={settings.keyboardShowTitle}
          onChanged={(keyboardShowTitle: boolean) => update({ keyboardShowTitle })}
          toggleStyle="switch"
        >
          <Text>键盘显示标题</Text>
        </Toggle>
        <Toggle
          value={settings.keyboardNativeGlassEffect}
          onChanged={(keyboardNativeGlassEffect: boolean) => update({ keyboardNativeGlassEffect })}
          toggleStyle="switch"
        >
          <Text>键盘使用原生效果</Text>
        </Toggle>
        <Toggle
          value={settings.showRimeKeyboardSwitch}
          onChanged={(showRimeKeyboardSwitch: boolean) => update({ showRimeKeyboardSwitch })}
          toggleStyle="switch"
        >
          <Text>显示 Rime 键盘切换按钮</Text>
        </Toggle>
      </Section>

      <Section header={<Text>反馈</Text>}>
        <Toggle
          value={settings.inputClicks}
          onChanged={(inputClicks: boolean) =>
            update({
              inputClicks,
              hapticEngineClicks: inputClicks ? false : settings.hapticEngineClicks,
            })}
          toggleStyle="switch"
        >
          <Text>系统按键音</Text>
        </Toggle>
        <Toggle
          value={settings.hapticEngineClicks}
          onChanged={(hapticEngineClicks: boolean) =>
            update({
              hapticEngineClicks,
              inputClicks: hapticEngineClicks ? false : settings.inputClicks,
            })}
          toggleStyle="switch"
        >
          <Text>Core Haptics 按键音</Text>
        </Toggle>
        <Toggle
          value={settings.launchAnimationEnabled}
          onChanged={(launchAnimationEnabled: boolean) => update({ launchAnimationEnabled })}
          toggleStyle="switch"
        >
          <Text>开屏动画</Text>
        </Toggle>
      </Section>

      <Section header={<Text>长按菜单</Text>}>
        <Button
          buttonStyle="plain"
          matchedTransitionSource={props.embeddedNavigation && props.zoomNamespace ? {
            id: "keyboard-menu-settings",
            namespace: props.zoomNamespace,
          } : undefined}
          action={() => void presentKeyboardMenuSettings()}
        >
          <HStack
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            background="rgba(0,0,0,0.001)"
            contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
          >
            <Image systemName="text.badge.star" />
            <Text>长按菜单</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {settings.keyboardMenu.grouped ? "按类别分组" : "不分组"}
            </Text>
          </HStack>
        </Button>
      </Section>
    </Form>
  );
}
