import {
  Button,
  FlowLayout,
  Group,
  HStack,
  ScrollView,
  ScrollViewReader,
  Text,
  useEffect,
  useMemo,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting";
import {
  type CandidateMenuAction,
  type RimeKeyboardSettings,
  TOOLBAR_LEFT_BUTTON_MAX,
} from "../settings";
import {
  CandidateButton,
  candidateButtonNaturalWidth,
  KeyFace,
} from "./components";
import { KEY_SPACING } from "./constants";
import type { KeyboardMetrics, Palette } from "./types";
import {
  type KeyboardRimeState,
  RimeViewStateController,
} from "./rimeViewState";

const PREEDIT_SCROLL_ESTIMATED_CHARACTER_WIDTH = 10;
const PREEDIT_CARET_SCROLL_KEY = "preedit-caret-anchor";
const PREEDIT_TAIL_SCROLL_KEY = "preedit-tail-anchor";
const TOOLBAR_BUTTON_WIDTH = 42;
const CANDIDATE_RIGHT_BUTTON_WIDTH = 42;
const EXPANDED_PAGER_WIDTH = 42;

export type ExpandedCandidateItem = {
  candidate: Rime.Candidate;
  absoluteIndex: number;
};

export type RimeNotificationToast = {
  id: number;
  text: string;
};

type CandidateScrollTarget = {
  key: string;
  pageNo: number;
  highlightedIdx: number;
  anchor: "leading" | "center" | "trailing";
};

export function candidateHeaderHeight(
  settings: RimeKeyboardSettings,
  metrics: KeyboardMetrics,
) {
  return settings.inlinePreedit
    ? metrics.candidateBarHeight
    : metrics.candidateBarHeight + metrics.preeditRowHeight + 2;
}

function candidateContextMenu(
  actions: CandidateMenuAction[],
  absoluteIndex: number,
  onAction: (absoluteIndex: number, action: string) => void,
) {
  if (actions.length === 0) return undefined;
  return {
    menuItems: (
      <Group>
        {actions.map((item, index) => (
          <Button
            key={`${index}-${item.name}-${item.action}`}
            title={item.name}
            action={() => onAction(absoluteIndex, item.action)}
          />
        ))}
      </Group>
    ),
  };
}

function RimeNotificationCard(props: {
  notification: RimeNotificationToast;
  metrics: KeyboardMetrics;
  palette: Palette;
}) {
  const cornerRadius = 8;
  return (
    <HStack
      key={props.notification.id}
      spacing={0}
      allowsHitTesting={false}
      padding={{ horizontal: 12 }}
      frame={{
        maxWidth: Math.min(180, props.metrics.width - 16),
        height: props.metrics.candidateButtonHeight,
      }}
      background={(props.palette.nativeKeyStyle
        ? props.palette.usesCustomColors
          ? {
            style: props.palette.keyBg as any,
            shape: { type: "rect", cornerRadius },
          }
          : "clear"
        : {
          style: props.palette.keyBg as any,
          shape: { type: "rect", cornerRadius },
        }) as any}
      glassEffect={(props.palette.nativeKeyStyle
        ? { type: "rect", cornerRadius }
        : undefined) as any}
      clipShape={{ type: "rect", cornerRadius }}
      shadow={props.palette.nativeKeyStyle
        ? undefined
        : { color: props.palette.shadow as any, radius: 1, y: 1 }}
    >
      <Text
        font={Math.max(13, props.metrics.candidateFontSize - 2)}
        lineLimit={1}
        minScaleFactor={0.75}
        foregroundStyle={props.palette.primary as any}
      >
        {props.notification.text}
      </Text>
    </HStack>
  );
}

export function CandidateHeader(props: {
  controller: RimeViewStateController;
  settings: RimeKeyboardSettings;
  metrics: KeyboardMetrics;
  palette: Palette;
  displayPreedit?: string;
  displayPreeditCursor?: number;
  error: string | null;
  composing: boolean;
  candidateExpanded: boolean;
  notificationToast: RimeNotificationToast | null;
  candidateMenuActions: CandidateMenuAction[];
  schemaMenu: any;
  onToolbarAction: (action: string) => void;
  onCandidateAction: (absoluteIndex: number, action: string) => void;
  onSelectCandidate: (absoluteIndex: number) => void;
  onRightButton: () => void;
  onRenderCommit?: () => void;
}) {
  const [rimeState, setRimeState] = useState<KeyboardRimeState>(() =>
    props.controller.getSnapshot()
  );
  const {
    preedit: rawPreedit,
    preeditCursor: rawPreeditCursor,
    candidates,
    highlightedIdx,
    pageNo,
    rimePageSize,
  } = rimeState;
  const preedit = props.displayPreedit ?? rawPreedit;
  const preeditCursor = props.displayPreeditCursor ?? rawPreeditCursor;
  const preeditScrollProxyRef = useRef<any>(null);
  const candidateScrollProxyRef = useRef<any>(null);
  const preeditScrollTimerRef = useRef<any>(null);
  const candidateScrollTimerRef = useRef<any>(null);
  const candidateScrollTargetRef = useRef<CandidateScrollTarget | null>(null);
  const showsPreeditRow = !props.settings.inlinePreedit;
  const showsPreeditCaret = !props.error && showsPreeditRow &&
    props.settings.showPreeditCaret && preedit.length > 0;
  const safePreeditCursor = Math.min(
    preedit.length,
    Math.max(0, preeditCursor),
  );
  const preeditBeforeCaret = showsPreeditCaret
    ? preedit.slice(0, safePreeditCursor)
    : props.error
    ? `Rime 错误：${props.error}`
    : props.settings.inlinePreedit
    ? ""
    : preedit;
  const preeditAfterCaret = showsPreeditCaret
    ? preedit.slice(safePreeditCursor)
    : "";
  const preeditScrollTargetKey = showsPreeditCaret
    ? PREEDIT_CARET_SCROLL_KEY
    : PREEDIT_TAIL_SCROLL_KEY;
  const preeditNeedsAutoScroll = showsPreeditRow && preedit.length > 0 &&
    preedit.length * PREEDIT_SCROLL_ESTIMATED_CHARACTER_WIDTH >
      props.metrics.width - 16;
  const height = candidateHeaderHeight(props.settings, props.metrics);
  const effectiveRightButtonMode =
    props.settings.candidateRightButtonMode === "expand" &&
      candidates.length === 0
      ? "dismiss"
      : props.settings.candidateRightButtonMode;
  const toolbarLeftButtons = useMemo(
    () =>
      props.composing
        ? []
        : props.settings.toolbarLeftButtons.filter((item) =>
          item.symbol && item.action
        ).slice(0, TOOLBAR_LEFT_BUTTON_MAX),
    [props.composing, props.settings.toolbarLeftButtons],
  );
  const rightButtonVisible = effectiveRightButtonMode !== "hidden";
  const toolbarWidth = toolbarLeftButtons.length * TOOLBAR_BUTTON_WIDTH;
  const rightButtonWidth = rightButtonVisible
    ? CANDIDATE_RIGHT_BUTTON_WIDTH
    : 0;
  const fixedButtonCount = toolbarLeftButtons.length +
    (rightButtonVisible ? 1 : 0);
  const candidateBarWidth = Math.max(
    0,
    props.metrics.width - toolbarWidth - rightButtonWidth -
      KEY_SPACING * fixedButtonCount,
  );
  const candidateItems = useMemo(
    () =>
      candidates.map((candidate, pageIndex) => ({
        candidate,
        comment: props.settings.showCandidateComment
          ? candidate.comment?.trim() ?? ""
          : "",
        pageIndex,
        absoluteIndex: pageNo * rimePageSize + pageIndex,
      })),
    [
      candidates,
      pageNo,
      rimePageSize,
      props.settings.showCandidateComment,
    ],
  );
  const highlightedCandidate = candidates[highlightedIdx];
  const highlightedComment = candidateItems[highlightedIdx]?.comment ??
    "";
  const highlightedWidth = useMemo(
    () =>
      highlightedCandidate && candidateBarWidth > 0
        ? candidateButtonNaturalWidth({
          text: highlightedCandidate.text,
          comment: highlightedComment,
          index: highlightedIdx,
          showIndex: props.settings.showCandidateComment,
          candidateFontSize: props.metrics.candidateFontSize,
          commentFontSize: props.metrics.candidateCommentFontSize,
        })
        : 0,
    [
      candidateBarWidth,
      highlightedCandidate,
      highlightedComment,
      highlightedIdx,
      props.metrics.candidateCommentFontSize,
      props.metrics.candidateFontSize,
      props.settings.showCandidateComment,
    ],
  );
  const candidateTargetKey = highlightedCandidate
    ? `${pageNo}-${highlightedIdx}`
    : null;
  const candidateContentKey = highlightedCandidate
    ? `${pageNo}-${highlightedIdx}-${highlightedCandidate.text}`
    : null;
  const candidateAnchor = highlightedWidth > candidateBarWidth
    ? "trailing"
    : highlightedIdx === 0
    ? "leading"
    : "center";
  const rightButtonImage = effectiveRightButtonMode === "expand"
    ? props.candidateExpanded
      ? "chevron.up.circle"
      : props.settings.toolbarExpandSymbol
    : props.settings.toolbarDismissSymbol;

  useEffect(() => props.controller.subscribe(setRimeState), [props.controller]);

  useEffect(() => {
    props.onRenderCommit?.();
  }, [props.onRenderCommit, rimeState]);

  useEffect(() => {
    if (preeditScrollTimerRef.current != null) {
      clearTimeout(preeditScrollTimerRef.current);
      preeditScrollTimerRef.current = null;
    }
    if (!preeditNeedsAutoScroll) return;
    preeditScrollTimerRef.current = setTimeout(() => {
      preeditScrollTimerRef.current = null;
      preeditScrollProxyRef.current?.scrollTo(
        preeditScrollTargetKey,
        "trailing",
      );
    }, 20);
    return () => {
      if (preeditScrollTimerRef.current != null) {
        clearTimeout(preeditScrollTimerRef.current);
        preeditScrollTimerRef.current = null;
      }
    };
  }, [preedit, preeditNeedsAutoScroll, preeditScrollTargetKey]);

  useEffect(() => {
    if (!candidateTargetKey || !candidateContentKey) {
      if (candidateScrollTimerRef.current != null) {
        clearTimeout(candidateScrollTimerRef.current);
        candidateScrollTimerRef.current = null;
      }
      candidateScrollTargetRef.current = null;
      return;
    }
    const currentTarget: CandidateScrollTarget = {
      key: candidateContentKey,
      pageNo,
      highlightedIdx,
      anchor: candidateAnchor,
    };
    const previousTarget = candidateScrollTargetRef.current;
    candidateScrollTargetRef.current = currentTarget;
    const targetMoved = previousTarget == null ||
      previousTarget.pageNo !== currentTarget.pageNo ||
      previousTarget.highlightedIdx !== currentTarget.highlightedIdx;
    const alignmentChanged = previousTarget?.anchor !== currentTarget.anchor;
    const changedNonLeadingCandidate = previousTarget?.key !==
        currentTarget.key && currentTarget.anchor !== "leading";
    if (!targetMoved && !alignmentChanged && !changedNonLeadingCandidate) {
      return;
    }
    if (candidateScrollTimerRef.current != null) {
      clearTimeout(candidateScrollTimerRef.current);
    }
    candidateScrollTimerRef.current = setTimeout(() => {
      candidateScrollTimerRef.current = null;
      candidateScrollProxyRef.current?.scrollTo(
        candidateTargetKey,
        candidateAnchor,
      );
    }, 20);
    return () => {
      if (candidateScrollTimerRef.current != null) {
        clearTimeout(candidateScrollTimerRef.current);
        candidateScrollTimerRef.current = null;
      }
    };
  }, [
    candidateAnchor,
    candidateBarWidth,
    candidateContentKey,
    candidateTargetKey,
    highlightedWidth,
    highlightedIdx,
    pageNo,
  ]);

  return (
    <ZStack
      frame={{
        width: props.metrics.width,
        height,
        alignment: "bottomTrailing" as any,
      }}
    >
      <VStack
        spacing={showsPreeditRow ? 2 : 0}
        frame={{
          width: props.metrics.width,
          height,
          alignment: "leading" as any,
        }}
      >
        {showsPreeditRow
          ? (
            <ScrollViewReader>
              {(proxy) => {
                preeditScrollProxyRef.current = proxy;
                return (
                  <ScrollView
                    axes="horizontal"
                    scrollIndicator="hidden"
                    frame={{
                      width: props.metrics.width,
                      height: props.metrics.preeditRowHeight,
                    }}
                  >
                    <HStack
                      spacing={1}
                      padding={{ leading: 8, trailing: 8 }}
                      frame={{
                        height: props.metrics.preeditRowHeight,
                        alignment: "bottomLeading" as any,
                      }}
                    >
                      <Text
                        font="caption"
                        lineLimit={1}
                        fixedSize={{ horizontal: true, vertical: true }}
                        foregroundStyle={props.palette.primary as any}
                      >
                        {preeditBeforeCaret}
                      </Text>
                      {showsPreeditCaret
                        ? (
                          <Text
                            font="caption2"
                            baselineOffset={-7}
                            foregroundStyle={props.palette.primary as any}
                            padding={{ bottom: -2 }}
                          >
                            ^
                          </Text>
                        )
                        : null}
                      {showsPreeditCaret
                        ? (
                          <VStack
                            key={PREEDIT_CARET_SCROLL_KEY}
                            frame={{
                              width: 1,
                              height: props.metrics.preeditRowHeight,
                            }}
                          />
                        )
                        : null}
                      {preeditAfterCaret
                        ? (
                          <Text
                            font="caption"
                            lineLimit={1}
                            fixedSize={{ horizontal: true, vertical: true }}
                            foregroundStyle={props.palette.primary as any}
                          >
                            {preeditAfterCaret}
                          </Text>
                        )
                        : null}
                      <VStack
                        key={PREEDIT_TAIL_SCROLL_KEY}
                        frame={{
                          width: 1,
                          height: props.metrics.preeditRowHeight,
                        }}
                      />
                    </HStack>
                  </ScrollView>
                );
              }}
            </ScrollViewReader>
          )
          : null}
        <HStack
          spacing={KEY_SPACING}
          frame={{
            width: props.metrics.width,
            height: props.metrics.candidateBarHeight,
          }}
        >
          {toolbarLeftButtons.map((item) => (
            <KeyFace
              key={`toolbar-left-${item.id}`}
              id={`toolbar-left-${item.id}`}
              image={item.symbol}
              palette={props.palette}
              width={TOOLBAR_BUTTON_WIDTH}
              height={props.metrics.candidateButtonHeight}
              system
              plain
              foregroundStyle={props.palette.primaryOverrides?.[
                `toolbar-left-${item.id}`
              ] ?? props.palette.primary}
              onPress={() => props.onToolbarAction(item.action)}
              contextMenu={item.action.trim() === "{schemaMenu}" &&
                  props.schemaMenu != null
                ? { menuItems: props.schemaMenu }
                : undefined}
            />
          ))}
          <ScrollViewReader>
            {(proxy) => {
              candidateScrollProxyRef.current = proxy;
              return (
                <ScrollView
                  axes="horizontal"
                  scrollIndicator="hidden"
                  frame={{
                    width: candidateBarWidth,
                    height: props.metrics.candidateBarHeight,
                  }}
                >
                  <HStack
                    spacing={5}
                    buttonStyle="plain"
                    frame={{
                      minWidth: candidateBarWidth,
                      height: props.metrics.candidateBarHeight,
                      alignment: "leading" as any,
                    }}
                    background={"rgba(0,0,0,0.001)" as any}
                    contentShape="rect"
                  >
                    {candidateItems.map((item) => (
                      <CandidateButton
                        key={`${pageNo}-${item.pageIndex}`}
                        index={item.pageIndex}
                        candidate={item.candidate}
                        comment={item.comment}
                        showIndex={props.settings.showCandidateComment}
                        selected={item.pageIndex === highlightedIdx}
                        palette={props.palette}
                        height={props.metrics.candidateButtonHeight}
                        candidateFontSize={props.metrics.candidateFontSize}
                        commentFontSize={props.metrics.candidateCommentFontSize}
                        contextMenu={candidateContextMenu(
                          props.candidateMenuActions,
                          item.absoluteIndex,
                          props.onCandidateAction,
                        )}
                        onPress={() =>
                          props.onSelectCandidate(item.absoluteIndex)}
                      />
                    ))}
                  </HStack>
                </ScrollView>
              );
            }}
          </ScrollViewReader>
          {rightButtonVisible
            ? (
              <KeyFace
                id="candidate-right"
                image={rightButtonImage}
                palette={props.palette}
                width={rightButtonWidth}
                height={props.metrics.candidateButtonHeight}
                system
                plain
                foregroundStyle={props.palette.primaryOverrides?.[
                  "candidate-right"
                ] ?? props.palette.primary}
                onPress={props.onRightButton}
              />
            )
            : null}
        </HStack>
      </VStack>
      {props.notificationToast
        ? (
          <HStack
            allowsHitTesting={false}
            frame={{
              width: props.metrics.width,
              height,
              alignment: "bottomTrailing" as any,
            }}
          >
            <RimeNotificationCard
              notification={props.notificationToast}
              metrics={props.metrics}
              palette={props.palette}
            />
          </HStack>
        )
        : null}
    </ZStack>
  );
}

export function ExpandedCandidatePanel(props: {
  controller: RimeViewStateController;
  settings: RimeKeyboardSettings;
  metrics: KeyboardMetrics;
  palette: Palette;
  panelHeight: number;
  expandedCandidates: ExpandedCandidateItem[];
  batchHasMore: boolean;
  candidateMenuActions: CandidateMenuAction[];
  onCandidateAction: (absoluteIndex: number, action: string) => void;
  onSelectCandidate: (absoluteIndex: number) => void;
  onMovePage: (direction: "up" | "down") => void;
}) {
  const [rimeState, setRimeState] = useState<KeyboardRimeState>(() =>
    props.controller.getSnapshot()
  );
  const { candidates, highlightedIdx, pageNo, rimePageSize } = rimeState;
  const contentWidth = props.metrics.width - EXPANDED_PAGER_WIDTH - KEY_SPACING;
  const highlightedAbsoluteIndex = pageNo * rimePageSize + highlightedIdx;
  const items = props.expandedCandidates.length > 0
    ? props.expandedCandidates
    : candidates.map((candidate, pageIndex) => ({
      candidate,
      absoluteIndex: pageNo * rimePageSize + pageIndex,
    }));
  useEffect(() => props.controller.subscribe(setRimeState), [props.controller]);
  return (
    <HStack
      spacing={KEY_SPACING}
      frame={{ width: props.metrics.width, height: props.panelHeight }}
      background={"rgba(0,0,0,0.001)" as any}
      contentShape="rect"
    >
      <ScrollView
        axes="vertical"
        scrollIndicator="hidden"
        frame={{ width: contentWidth, height: props.panelHeight }}
        background={"rgba(0,0,0,0.001)" as any}
        contentShape="rect"
      >
        <VStack
          spacing={KEY_SPACING}
          frame={{
            width: contentWidth,
            minHeight: props.panelHeight,
            alignment: "top" as any,
          }}
          background={"rgba(0,0,0,0.001)" as any}
          contentShape="rect"
        >
          <FlowLayout
            spacing={KEY_SPACING}
            frame={{ width: contentWidth, alignment: "leading" as any }}
          >
            {items.map(({ candidate, absoluteIndex }) => {
              const comment = props.settings.showCandidateComment
                ? candidate.comment?.trim() ?? ""
                : "";
              const naturalWidth = candidateButtonNaturalWidth({
                text: candidate.text,
                comment,
                index: absoluteIndex,
                showIndex: props.settings.showCandidateComment,
                candidateFontSize: props.metrics.candidateFontSize,
                commentFontSize: props.metrics.candidateCommentFontSize,
                expanded: true,
              });
              const width = naturalWidth > contentWidth
                ? contentWidth
                : undefined;
              return (
                <CandidateButton
                  key={`expanded-${absoluteIndex}`}
                  index={absoluteIndex}
                  candidate={candidate}
                  comment={comment}
                  showIndex={props.settings.showCandidateComment}
                  selected={absoluteIndex === highlightedAbsoluteIndex}
                  palette={props.palette}
                  width={width}
                  height={Math.max(
                    52,
                    props.metrics.candidateButtonHeight + 12,
                  )}
                  candidateFontSize={props.metrics.candidateFontSize}
                  commentFontSize={props.metrics.candidateCommentFontSize}
                  expanded
                  contextMenu={candidateContextMenu(
                    props.candidateMenuActions,
                    absoluteIndex,
                    props.onCandidateAction,
                  )}
                  onPress={() => props.onSelectCandidate(absoluteIndex)}
                />
              );
            })}
          </FlowLayout>
        </VStack>
      </ScrollView>
      <VStack
        spacing={KEY_SPACING}
        frame={{ width: EXPANDED_PAGER_WIDTH, height: props.panelHeight }}
      >
        <KeyFace
          id="expanded-page-up"
          image="chevron.up"
          palette={props.palette}
          width={EXPANDED_PAGER_WIDTH}
          height={(props.panelHeight - KEY_SPACING) / 2}
          system
          foregroundStyle={pageNo > 0
            ? props.palette.primary
            : props.palette.hint}
          onPress={pageNo > 0 ? () => props.onMovePage("up") : () => {}}
        />
        <KeyFace
          id="expanded-page-down"
          image="chevron.down"
          palette={props.palette}
          width={EXPANDED_PAGER_WIDTH}
          height={(props.panelHeight - KEY_SPACING) / 2}
          system
          foregroundStyle={props.batchHasMore
            ? props.palette.primary
            : props.palette.hint}
          onPress={props.batchHasMore
            ? () => props.onMovePage("down")
            : () => {}}
        />
      </VStack>
    </HStack>
  );
}
