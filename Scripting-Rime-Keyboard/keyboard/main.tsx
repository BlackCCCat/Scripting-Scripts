import {
  Button,
  Device,
  DragGesture,
  FlowLayout,
  GeometryReader,
  Group,
  HStack,
  Script,
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting";
import {
  type ActionSendMode,
  DEFAULT_CANDIDATE_MENU_ACTIONS,
  loadRimeKeyboardSettings,
  type RimeKeyboardSettings,
} from "../settings";
import {
  KEY_BACKSPACE,
  KEY_DOWN,
  KEY_ESCAPE,
  KEY_PAGE_DOWN,
  KEY_PAGE_UP,
  KEY_RETURN,
  KEY_SPACE,
  KEY_TAB,
  KEY_UP,
  MOD_CONTROL,
  parseRimeKeySpec,
} from "../rimeKeys";
import {
  BACKSLASH_SYMBOLS,
  LETTER_ROWS,
  NUMERIC_SYMBOLS,
} from "../keyboardLayout";
import {
  CandidateButton,
  candidateButtonNaturalWidth,
  KeyFace,
} from "./components";
import { KEY_SPACING, SIDE_PADDING } from "./constants";
import { keyboardMetrics } from "./metrics";
import { type KeyboardAppearance, paletteFor } from "./palette";
import type { KeyHitTarget } from "./types";
import {
  createTouchIntentMachine,
  hapticInterval,
  inputClickInterval,
  nearestHitTarget,
  playConfiguredClick,
  playConfiguredHaptic,
} from "./utils";

function currentKeyboardAppearance(): KeyboardAppearance {
  const value = CustomKeyboard.traits?.keyboardAppearance;
  return value === "dark" || value === "light" ? value : "default";
}

let globalRepeatingDeleteTimer: any = null;
let globalRepeatingDeleteSafetyTimer: any = null;
let globalRepeatingDeleteToken = 0;
const SPACE_CURSOR_DRAG_STEP = 12;
const SPACE_CANDIDATE_DRAG_STEP = 24;
const DELETE_LONG_PRESS_DURATION = 920;
const DELETE_REPEAT_SAFETY_DURATION = 4200;
const CURSOR_REPEAT_DURATION = 420;
const PRESSED_RELEASE_DELAY = 260;
const LONG_PRESS_PRESSED_RELEASE_DELAY = 2600;
const EXPANDED_RIME_PAGE_BATCH = 4;
const LETTER_LONG_PRESS_LAYER_GRACE_MS = 900;

type ExpandedCandidateItem = {
  candidate: Rime.Candidate;
  absoluteIndex: number;
};

type SelectAllSnapshot = {
  text: string;
  cursorBefore: number;
};

function stopGlobalRepeatingDelete() {
  globalRepeatingDeleteToken += 1;
  if (globalRepeatingDeleteTimer != null) {
    clearTimeout(globalRepeatingDeleteTimer);
  }
  if (globalRepeatingDeleteSafetyTimer != null) {
    clearTimeout(globalRepeatingDeleteSafetyTimer);
  }
  globalRepeatingDeleteTimer = null;
  globalRepeatingDeleteSafetyTimer = null;
}

export function KeyboardView() {
  return (
    <GeometryReader>
      {(proxy) => (
        <KeyboardContent
          availableHeight={Number(proxy.size.height || 0) || undefined}
          availableWidth={Number(proxy.size.width || 0) || undefined}
        />
      )}
    </GeometryReader>
  );
}

function KeyboardContent(props: {
  availableHeight?: number;
  availableWidth?: number;
}) {
  const [settings] = useState<RimeKeyboardSettings>(() =>
    loadRimeKeyboardSettings()
  );
  const [keyboardAppearance, setKeyboardAppearance] = useState<
    KeyboardAppearance
  >(() => currentKeyboardAppearance());
  const palette = paletteFor(settings, keyboardAppearance);
  const sessionRef = useRef<Rime.Session | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [rimeState, setRimeState] = useState({
    preedit: "",
    preeditCursor: 0,
    candidates: [] as Rime.Candidate[],
    highlightedIdx: 0,
    pageNo: 0,
    rimePageSize: 5,
    isLastPage: true,
    ascii: false,
    currentSchemaId: null as string | null,
  });
  const {
    preedit,
    preeditCursor,
    candidates,
    highlightedIdx,
    pageNo,
    rimePageSize,
    isLastPage,
    ascii,
    currentSchemaId,
  } = rimeState;
  const [shifted, setShifted] = useState(false);
  const [capsLocked, setCapsLocked] = useState(false);
  const [symbolLayer, setSymbolLayer] = useState(false);
  const [backslashWrapMode, setBackslashWrapMode] = useState(false);
  const [rimeReady, setRimeReady] = useState(false);
  const [candidateExpanded, setCandidateExpanded] = useState(false);
  const [expandedCandidates, setExpandedCandidates] = useState<
    ExpandedCandidateItem[]
  >([]);
  const [expandedBatchHasMore, setExpandedBatchHasMore] = useState(false);
  const [selectAllActive, setSelectAllActive] = useState(false);
  const [pressedKeyIds, setPressedKeyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [schemas, setSchemas] = useState<Rime.Schema[]>([]);
  const lastShiftTapRef = useRef(0);
  const deletedTextRef = useRef("");
  const selectAllSnapshotRef = useRef<SelectAllSnapshot | null>(null);
  const cursorRepeatTimerRef = useRef<any>(null);
  const cursorRepeatTokenRef = useRef(0);
  const pressedKeyIdsRef = useRef<Set<string>>(new Set());
  const pressedReleaseTimersRef = useRef(new Map<string, any>());
  const activeHitTargetRef = useRef(new Map<string, KeyHitTarget>());
  const rowGestureMachineRef = useRef(new Map<string, any>());
  const rowSpaceDragConsumedRef = useRef(new Map<string, boolean>());
  const spaceCursorDragXRef = useRef<number | null>(null);
  const lastPressFeedbackAtRef = useRef(0);
  const lastPressRequestAtRef = useRef(0);
  const pressBurstCountRef = useRef(0);
  const lastCursorFeedbackAtRef = useRef(0);
  const lastDeleteClickAtRef = useRef(0);
  const lastDeleteHapticAtRef = useRef(0);
  const hapticQueueTimerRef = useRef<any>(null);
  const pendingPressHapticRef = useRef(false);
  const swipeTriggerDistanceRef = useRef(settings.swipeTriggerDistance);
  const lastSwipeSettingsReloadAtRef = useRef(0);
  const suppressLetterLongPressUntilRef = useRef(
    Date.now() +
      LETTER_LONG_PRESS_LAYER_GRACE_MS,
  );
  const rimeSetupStartedRef = useRef(false);
  const disposedRef = useRef(false);
  const metrics = keyboardMetrics(
    settings,
    props.availableHeight,
    props.availableWidth,
  );

  useEffect(() => {
    stopRepeatingBackspace();
    const syncKeyboardAppearance = (
      traits?: CustomKeyboard.TextInputTraits,
    ) => {
      const value = traits?.keyboardAppearance ??
        CustomKeyboard.traits?.keyboardAppearance;
      setKeyboardAppearance(
        value === "dark" || value === "light" ? value : "default",
      );
    };
    syncKeyboardAppearance();
    CustomKeyboard.addListener("textDidChange", syncKeyboardAppearance);
    CustomKeyboard.addListener("selectionDidChange", syncKeyboardAppearance);
    void setupRimeSession();

    return () => {
      disposedRef.current = true;
      CustomKeyboard.removeListener("textDidChange", syncKeyboardAppearance);
      CustomKeyboard.removeListener(
        "selectionDidChange",
        syncKeyboardAppearance,
      );
      try {
        CustomKeyboard.unmarkText();
      } catch {}
      for (const machine of rowGestureMachineRef.current.values()) {
        machine?.dispose?.();
      }
      rowGestureMachineRef.current.clear();
      rowSpaceDragConsumedRef.current.clear();
      stopRepeatingCursorMove();
      for (const timer of pressedReleaseTimersRef.current.values()) {
        clearTimeout(timer);
      }
      pressedReleaseTimersRef.current.clear();
      pressedKeyIdsRef.current = new Set();
      setPressedKeyIds(new Set());
      stopRepeatingBackspace();
      if (hapticQueueTimerRef.current) {
        clearTimeout(hapticQueueTimerRef.current);
      }
      hapticQueueTimerRef.current = null;
      pendingPressHapticRef.current = false;
      pressBurstCountRef.current = 0;
      sessionRef.current?.close();
      sessionRef.current = null;
      setRimeReady(false);
    };
  }, []);

  async function setupRimeSession() {
    if (
      disposedRef.current || rimeSetupStartedRef.current || sessionRef.current
    ) {
      return;
    }
    rimeSetupStartedRef.current = true;
    try {
      const result = await Thread.runInBackground(async () => {
        await Rime.setup();
        if (settings.autoDeployOnLaunch) {
          await Rime.deploy({ fullCheck: false });
        }
        const list = await Rime.listSchemas();
        const session = new Rime.Session();
        return { list, session };
      });
      if (disposedRef.current) return;
      setSchemas(result.list);
      const s = result.session;
      if (disposedRef.current) {
        s.close();
        return;
      }
      sessionRef.current = s;
      refresh(s);
      setRimeReady(true);
    } catch (e) {
      setRimeReady(false);
      setError((e as Error).message ?? String(e));
    }
  }

  function updateMarkedText(ctx: Rime.Context | null, committed: boolean) {
    if (!settings.inlinePreedit || committed || !ctx?.preedit) {
      try {
        CustomKeyboard.unmarkText();
      } catch {}
      return;
    }
    try {
      CustomKeyboard.setMarkedText(
        ctx.preedit,
        ctx.cursorPos ?? ctx.preedit.length,
        0,
      );
    } catch {}
  }

  function displayedPreeditCursor(preedit: string, cursor: number) {
    const safeCursor = Math.min(preedit.length, Math.max(0, cursor));
    const tipStart = preedit.indexOf("〔");
    if (tipStart > 0 && preedit.indexOf("〕", tipStart + 1) > tipStart) {
      return Math.min(safeCursor, tipStart);
    }
    return safeCursor;
  }

  function refresh(session = sessionRef.current) {
    if (!session) return;
    const ctx = session.context;
    const menu = ctx?.menu;
    const commit = session.commit;
    if (commit) insertTextReplacingSelectAll(commit);
    updateMarkedText(ctx, Boolean(commit));
    const nextPreedit = ctx?.preedit ?? "";
    const nextCursor = displayedPreeditCursor(
      nextPreedit,
      ctx?.cursorPos ?? nextPreedit.length,
    );
    setRimeState({
      preedit: nextPreedit,
      preeditCursor: nextCursor,
      candidates: menu?.candidates ?? [],
      highlightedIdx: menu?.highlightedIndex ?? 0,
      pageNo: menu?.pageNo ?? 0,
      rimePageSize: menu?.pageSize ?? 5,
      isLastPage: menu?.isLastPage ?? true,
      currentSchemaId: session.currentSchema?.id ?? null,
      ascii: session.getOption("ascii_mode"),
    });
    if (!nextPreedit) setBackslashWrapMode(false);
    if (!nextPreedit) {
      setCandidateExpanded(false);
      setExpandedCandidates([]);
      setExpandedBatchHasMore(false);
    }
  }

  function runWithFeedback(action: () => void) {
    stopRepeatingBackspace();
    stopRepeatingCursorMove();
    action();
    playReleaseFeedback();
    playPressFeedback();
  }

  function cancelPendingPressFeedback() {
    if (hapticQueueTimerRef.current) {
      clearTimeout(hapticQueueTimerRef.current);
      hapticQueueTimerRef.current = null;
    }
    pendingPressHapticRef.current = false;
  }

  function playPressFeedback() {
    if (!settings.haptics) return;
    const now = Date.now();
    const elapsed = now - lastPressRequestAtRef.current;
    pressBurstCountRef.current = elapsed > 110
      ? 0
      : Math.min(10, pressBurstCountRef.current + 1);
    lastPressRequestAtRef.current = now;
    pendingPressHapticRef.current = true;
    if (hapticQueueTimerRef.current) return;
    hapticQueueTimerRef.current = setTimeout(
      flushPressHaptic,
      pressBurstCountRef.current >= 4 ? 32 : 18,
    );
  }

  function flushPressHaptic() {
    hapticQueueTimerRef.current = null;
    if (!pendingPressHapticRef.current || !settings.haptics) return;
    const now = Date.now();
    const burst = pressBurstCountRef.current;
    const minInterval = burst >= 7
      ? 220
      : burst >= 4
      ? 160
      : burst >= 2
      ? 115
      : Math.max(75, hapticInterval(settings));
    const remaining = minInterval - (now - lastPressFeedbackAtRef.current);
    if (remaining > 0) {
      hapticQueueTimerRef.current = setTimeout(
        flushPressHaptic,
        Math.min(remaining, 64),
      );
      return;
    }
    pendingPressHapticRef.current = false;
    lastPressFeedbackAtRef.current = now;
    const level = burst >= 4 ? 1 : Math.min(settings.hapticLevel, 2);
    playConfiguredHaptic(settings, level);
  }

  function playReleaseFeedback() {
    playConfiguredClick(settings);
  }

  function playCursorMoveFeedback() {
    const now = Date.now();
    if (now - lastCursorFeedbackAtRef.current < hapticInterval(settings)) {
      return;
    }
    lastCursorFeedbackAtRef.current = now;
    playConfiguredHaptic(settings);
  }

  function playRepeatingDeleteFeedback() {
    const now = Date.now();
    if (now - lastDeleteHapticAtRef.current >= hapticInterval(settings)) {
      lastDeleteHapticAtRef.current = now;
      playConfiguredHaptic(settings);
    }
    if (now - lastDeleteClickAtRef.current >= inputClickInterval(settings)) {
      lastDeleteClickAtRef.current = now;
      playConfiguredClick(settings);
    }
  }

  function clearPressedReleaseTimer(id: string) {
    const timer = pressedReleaseTimersRef.current.get(id);
    if (timer != null) clearTimeout(timer);
    pressedReleaseTimersRef.current.delete(id);
  }

  function schedulePressedFallbackRelease(id: string, delay: number) {
    clearPressedReleaseTimer(id);
    pressedReleaseTimersRef.current.set(
      id,
      setTimeout(() => {
        pressedReleaseTimersRef.current.delete(id);
        cleanupContinuousActionForKey(id);
        setKeyPressed(id, false);
      }, delay),
    );
  }

  function schedulePressedRelease(id: string) {
    schedulePressedFallbackRelease(id, PRESSED_RELEASE_DELAY);
  }

  function setKeyPressed(id: string, pressed: boolean, fallback = true) {
    const current = pressedKeyIdsRef.current;
    if (pressed) {
      if (fallback) schedulePressedRelease(id);
      else clearPressedReleaseTimer(id);
    } else clearPressedReleaseTimer(id);
    if (pressed === current.has(id)) return;
    const next = new Set(current);
    if (pressed) next.add(id);
    else next.delete(id);
    pressedKeyIdsRef.current = next;
    setPressedKeyIds(next);
  }

  function holdKeyPressedUntilRelease(id: string) {
    setKeyPressed(id, true, false);
    schedulePressedFallbackRelease(id, LONG_PRESS_PRESSED_RELEASE_DELAY);
  }

  function releaseAllPressedKeys() {
    for (const timer of pressedReleaseTimersRef.current.values()) {
      clearTimeout(timer);
    }
    pressedReleaseTimersRef.current.clear();
    if (pressedKeyIdsRef.current.size === 0) return;
    pressedKeyIdsRef.current = new Set();
    setPressedKeyIds(new Set());
  }

  function cleanupContinuousActionForKey(id: string) {
    if (id === "backspace" || id === "numeric-backspace") {
      stopRepeatingBackspace();
    } else if (
      id === "idle-left" || id === "idle-right" || id === "func-left" ||
      id === "func-right"
    ) {
      stopRepeatingCursorMove();
    }
  }

  function isPressed(id: string) {
    return pressedKeyIds.has(id);
  }

  function suppressLetterLongPress(
    duration = LETTER_LONG_PRESS_LAYER_GRACE_MS,
  ) {
    suppressLetterLongPressUntilRef.current = Date.now() + duration;
  }

  function letterLongPressEnabled() {
    return rimeReady && Date.now() >= suppressLetterLongPressUntilRef.current;
  }

  function switchToLetterLayer() {
    suppressLetterLongPress();
    clearAllRowGestureState();
    releaseAllPressedKeys();
    setSymbolLayer(false);
  }

  function toggleSymbolLayer() {
    if (symbolLayer) switchToLetterLayer();
    else {
      releaseAllPressedKeys();
      setSymbolLayer(true);
    }
  }

  function beginKeyTouch(id: string) {
    stopRepeatingBackspace();
    stopRepeatingCursorMove();
    setKeyPressed(id, true, false);
    playPressFeedback();
  }

  function endKeyTouch(id: string) {
    if (id === "backspace" || id === "numeric-backspace") {
      stopRepeatingBackspace();
    }
    playReleaseFeedback();
    setKeyPressed(id, false);
  }

  function currentSwipeTriggerDistance() {
    const now = Date.now();
    if (now - lastSwipeSettingsReloadAtRef.current > 1000) {
      lastSwipeSettingsReloadAtRef.current = now;
      swipeTriggerDistanceRef.current =
        loadRimeKeyboardSettings().swipeTriggerDistance;
    }
    return swipeTriggerDistanceRef.current;
  }

  function isSpaceCursorKey(id: string | undefined) {
    return id === "space" || id === "numeric-space";
  }

  function hitTargetFromGesture(details: any, targets: KeyHitTarget[]) {
    const x = Number(details?.startLocation?.x ?? details?.location?.x ?? 0);
    const y = Number(details?.startLocation?.y ?? details?.location?.y ?? 0);
    return nearestHitTarget(x, y, targets);
  }

  function horizontalHitFrame(
    x: number,
    width: number,
    index: number,
    count: number,
    leadingInset = 0,
    trailingInset = 0,
  ) {
    const leading = index === 0 ? leadingInset : KEY_SPACING / 2;
    const trailing = index === count - 1 ? trailingInset : KEY_SPACING / 2;
    return { x: x - leading, width: width + leading + trailing };
  }

  function verticalHitFrame(
    y: number,
    height: number,
    index: number,
    count: number,
    spacing = KEY_SPACING,
  ) {
    const leading = index === 0 ? 0 : spacing / 2;
    const trailing = index === count - 1 ? 0 : spacing / 2;
    return { y: y - leading, height: height + leading + trailing };
  }

  function verticalTouchFrame(
    index: number,
    count: number,
    height: number,
    spacing: number,
  ) {
    const top = index === 0 ? 0 : spacing / 2;
    const bottom = index === count - 1 ? 0 : spacing / 2;
    return {
      touchHeight: height + top + bottom,
      visualOffsetY: top,
    };
  }

  function getRowGestureMachine(rowId: string) {
    let machine = rowGestureMachineRef.current.get(rowId);
    if (machine) return machine;
    machine = createTouchIntentMachine({
      longPressDuration: () =>
        activeHitTargetRef.current.get(rowId)?.longPressDuration ?? 360,
      swipeTriggerDistance: () => currentSwipeTriggerDistance(),
      safetyReleaseDelay: () => {
        const target = activeHitTargetRef.current.get(rowId);
        return target?.safetyReleaseDelay ??
          (target?.onLongPress ? 1500 : 520);
      },
      longPressSafetyReleaseDelay: () => LONG_PRESS_PRESSED_RELEASE_DELAY,
      shouldCancelLongPress: (details: any) => {
        const target = activeHitTargetRef.current.get(rowId);
        const isSpace = isSpaceCursorKey(target?.id);
        return isSpace
          ? isVerticalDragIntent(details)
          : isLongPressDragIntent(details);
      },
      onTouchEnd: () => {
        clearRowTracking(rowId);
      },
      onLongPress: () => {
        const target = activeHitTargetRef.current.get(rowId);
        if (!target?.onLongPress) return;
        if (target.onLongPressEnd) {
          holdKeyPressedUntilRelease(target.id);
        }
        target.onLongPress();
      },
      onLongPressEnd: () => {
        const target = activeHitTargetRef.current.get(rowId);
        if (!target) return;
        target.onLongPressEnd?.();
      },
      onLongPressMove: (details: any) => {
        const activeId = activeHitTargetRef.current.get(rowId)?.id;
        if (isSpaceCursorKey(activeId)) {
          void updateSpaceLongPressDrag(details);
        } else if (
          activeId === "backspace" || activeId === "numeric-backspace"
        ) {
          backspaceLongPressMove(details);
        }
      },
      onSwipeStart: () => {
        cancelPendingPressFeedback();
      },
      onResolveSwipe: (
        direction: "up" | "down" | "left" | "right",
      ) => {
        const target = activeHitTargetRef.current.get(rowId);
        if (!target) return false;
        const action = direction === "up" && target.onSwipeUp
          ? target.onSwipeUp
          : direction === "down" && target.onSwipeDown
          ? target.onSwipeDown
          : direction === "left" && target.onSwipeLeft
          ? target.onSwipeLeft
          : direction === "right" && target.onSwipeRight
          ? target.onSwipeRight
          : null;
        if (!action) return false;
        playReleaseFeedback();
        setKeyPressed(target.id, false);
        clearRowTracking(rowId, true);
        action();
        return true;
      },
      onPress: () => {
        const target = activeHitTargetRef.current.get(rowId);
        if (!target) return;
        playReleaseFeedback();
        setKeyPressed(target.id, false);
        clearRowTracking(rowId, true);
        target.onPress();
      },
    });
    rowGestureMachineRef.current.set(rowId, machine);
    return machine;
  }

  function clearAllRowGestureState() {
    for (const machine of rowGestureMachineRef.current.values()) {
      machine?.cancel?.();
    }
    rowGestureMachineRef.current.clear();
    rowSpaceDragConsumedRef.current.clear();
    activeHitTargetRef.current.clear();
    spaceCursorDragXRef.current = null;
  }

  function clearRowTracking(rowId: string, keepVisual = false) {
    const target = activeHitTargetRef.current.get(rowId);
    if (target && !keepVisual) setKeyPressed(target.id, false);
    rowSpaceDragConsumedRef.current.delete(rowId);
    activeHitTargetRef.current.delete(rowId);
    if (target?.id === "backspace" || target?.id === "numeric-backspace") {
      stopRepeatingBackspace();
    }
    if (
      target?.id === "idle-left" || target?.id === "idle-right" ||
      target?.id === "func-left" || target?.id === "func-right"
    ) {
      stopRepeatingCursorMove();
    }
    if (isSpaceCursorKey(target?.id)) spaceCursorDragXRef.current = null;
  }

  function cancelRowGesture(rowId: string, keepVisual = false) {
    const machine = rowGestureMachineRef.current.get(rowId);
    machine?.cancel?.();
    clearRowTracking(rowId, keepVisual);
  }

  function isLongPressDragIntent(details: any) {
    const dx = Math.abs(Number(details?.translation?.width ?? 0));
    const dy = Math.abs(Number(details?.translation?.height ?? 0));
    const vx = Math.abs(Number(details?.velocity?.width ?? 0));
    const vy = Math.abs(Number(details?.velocity?.height ?? 0));
    const predictedDx = Math.abs(
      Number(details?.predictedEndTranslation?.width ?? 0),
    );
    const predictedDy = Math.abs(
      Number(details?.predictedEndTranslation?.height ?? 0),
    );
    return (
      dx >= 4 ||
      dy >= 4 ||
      vx >= 8 ||
      vy >= 8 ||
      predictedDx >= 8 ||
      predictedDy >= 8
    );
  }

  function isVerticalDragIntent(details: any) {
    const dy = Math.abs(Number(details?.translation?.height ?? 0));
    const vy = Math.abs(Number(details?.velocity?.height ?? 0));
    const predictedDy = Math.abs(
      Number(details?.predictedEndTranslation?.height ?? 0),
    );
    return dy >= 4 || vy >= 8 || predictedDy >= 8;
  }

  function cancelRowLongPressIfDragging(rowId: string, details: any) {
    const machine = getRowGestureMachine(rowId);
    if (machine.getState() !== "pending") {
      return;
    }
    const target = activeHitTargetRef.current.get(rowId);
    const isSpace = isSpaceCursorKey(target?.id);
    if (
      isSpace ? !isVerticalDragIntent(details) : !isLongPressDragIntent(details)
    ) {
      return;
    }
    cancelPendingPressFeedback();
    machine.update(details);
  }

  function moveHighlightedCandidateBySpaceDrag(steps: number) {
    const s = sessionRef.current;
    if (!s) return;
    const count = Math.min(8, Math.abs(steps));
    const key = steps > 0 ? KEY_DOWN : KEY_UP;
    for (let i = 0; i < count; i += 1) {
      s.processKey(key);
    }
    refresh(s);
    playCursorMoveFeedback();
  }

  function updateSpaceLongPressDrag(details: any) {
    const x = Number(details?.location?.x ?? details?.startLocation?.x ?? 0);
    if (spaceCursorDragXRef.current == null) {
      spaceCursorDragXRef.current = Number(details?.startLocation?.x ?? x);
    }
    const hasCandidateNavigation = preedit.length > 0 && candidates.length > 0;
    const stepSize = hasCandidateNavigation
      ? SPACE_CANDIDATE_DRAG_STEP
      : SPACE_CURSOR_DRAG_STEP;
    const dx = x - spaceCursorDragXRef.current;
    const steps = Math.trunc(dx / stepSize);
    if (steps === 0) return false;
    if (hasCandidateNavigation) {
      moveHighlightedCandidateBySpaceDrag(steps);
    } else {
      moveCursorSafely(steps);
      playCursorMoveFeedback();
    }
    spaceCursorDragXRef.current += steps * stepSize;
    return true;
  }

  function trackImmediateSpaceDrag(rowId: string, details: any) {
    const dx = Math.abs(Number(details?.translation?.width ?? 0));
    const dy = Math.abs(Number(details?.translation?.height ?? 0));
    if (dx < SPACE_CURSOR_DRAG_STEP || dx < dy) return;
    if (updateSpaceLongPressDrag(details)) {
      cancelPendingPressFeedback();
      getRowGestureMachine(rowId).update(details);
      rowSpaceDragConsumedRef.current.set(rowId, true);
    }
  }

  function handleHitRowGestureChanged(
    rowId: string,
    details: any,
    targets: KeyHitTarget[],
  ) {
    const machine = getRowGestureMachine(rowId);
    if (machine.getState() === "longpress_locked") {
      machine.update(details);
      return;
    }
    const activeTarget = activeHitTargetRef.current.get(rowId);
    if (activeTarget) {
      machine.update(details);
      if (isSpaceCursorKey(activeTarget.id)) {
        trackImmediateSpaceDrag(rowId, details);
        if (rowSpaceDragConsumedRef.current.get(rowId)) return;
      }
      cancelRowLongPressIfDragging(rowId, details);
      return;
    }
    const target = hitTargetFromGesture(details, targets);
    if (target) activeHitTargetRef.current.set(rowId, target);
    else activeHitTargetRef.current.delete(rowId);
    if (target) {
      setKeyPressed(target.id, true, false);
      playPressFeedback();
      rowSpaceDragConsumedRef.current.set(rowId, false);
      spaceCursorDragXRef.current = null;
      machine.start();
      machine.update(details);
    }
  }

  function handleHitRowGestureEnded(
    rowId: string,
    details: any,
    targets: KeyHitTarget[],
  ) {
    const machine = getRowGestureMachine(rowId);
    const target = activeHitTargetRef.current.get(rowId) ??
      hitTargetFromGesture(details, targets);
    if (!target) {
      machine.cancel();
      clearRowTracking(rowId);
      return;
    }
    if (
      isSpaceCursorKey(target.id) && rowSpaceDragConsumedRef.current.get(rowId)
    ) {
      cancelPendingPressFeedback();
      setKeyPressed(target.id, false);
      machine.cancel();
      clearRowTracking(rowId, true);
      return;
    }
    machine.end(details);
  }

  function hitRowGesture(rowId: string, targets: KeyHitTarget[]) {
    return {
      gesture: DragGesture({
        minDistance: 0,
        coordinateSpace: "local",
      })
        .onChanged((details: any) =>
          handleHitRowGestureChanged(rowId, details, targets)
        )
        .onEnded((details: any) =>
          handleHitRowGestureEnded(rowId, details, targets)
        ),
      mask: "gesture" as any,
    };
  }

  function processKey(
    keyCode: number,
    fallback?: string,
    replaceSelectAll = false,
  ) {
    if (replaceSelectAll) consumeSelectAllForReplacement();
    else clearSelectAllStateForExternalAction();
    const s = sessionRef.current;
    if (!s) {
      if (fallback) insertTextReplacingSelectAll(fallback);
      return;
    }
    const consumed = s.processKey(keyCode);
    refresh(s);
    if (!consumed && fallback) insertTextReplacingSelectAll(fallback);
  }

  function processKeyWithModifiers(keyCode: number, modifiers: number) {
    clearSelectAllStateForExternalAction();
    const s = sessionRef.current;
    if (!s) return;
    s.processKey(keyCode, modifiers);
    refresh(s);
  }

  function processRimeKeySpec(action: string): boolean {
    const spec = parseRimeKeySpec(action);
    if (!spec) return false;
    processKeyWithModifiers(spec.keyCode, spec.modifiers);
    return true;
  }

  function insertConfiguredText(action: string) {
    const text = action
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
    if (text) {
      insertTextReplacingSelectAll(text);
    }
  }

  function processText(text: string) {
    if (!text) return;
    if (processRimeKeySpec(text)) return;
    if (text === "\t") {
      processKey(KEY_TAB, "\t");
      return;
    }
    for (const ch of text) processKey(ch.charCodeAt(0), ch, true);
  }

  function pressLetter(ch: string) {
    const typed = shifted || capsLocked ? ch.toUpperCase() : ch;
    if (ascii) {
      insertTextReplacingSelectAll(typed);
      if (shifted && !capsLocked) setShifted(false);
      return;
    }
    processKey(typed.charCodeAt(0), typed, true);
    if (backslashWrapMode) setBackslashWrapMode(false);
    if (shifted && !capsLocked) setShifted(false);
  }

  function pressUppercaseLetter(ch: string) {
    const typed = ch.toUpperCase();
    if (ascii) {
      insertTextReplacingSelectAll(typed);
      return;
    }
    processKey(typed.charCodeAt(0), typed, true);
    if (backslashWrapMode) setBackslashWrapMode(false);
  }

  function pressSymbol(text: string) {
    if (ascii || preedit.length === 0) {
      insertTextReplacingSelectAll(text);
      return;
    }
    processText(text);
  }

  function pressNumericDot() {
    if (!ascii && preedit.length > 0) {
      processText(".");
      return;
    }
    insertTextReplacingSelectAll(".");
  }

  function pressRimePunctuation(text: string) {
    if (ascii) insertTextReplacingSelectAll(text);
    else processText(text);
  }

  function pressBackspace() {
    const s = sessionRef.current;
    if (s && (s.context?.preedit?.length ?? 0) > 0) {
      s.processKey(KEY_BACKSPACE);
      refresh(s);
    } else {
      if (consumeSelectAllForDeletion()) return;
      const before = CustomKeyboard.textBeforeCursor ?? "";
      deletedTextRef.current = before.slice(-1) || deletedTextRef.current;
      CustomKeyboard.deleteBackward();
    }
  }

  function stopRepeatingBackspace() {
    stopGlobalRepeatingDelete();
  }

  function stopRepeatingCursorMove() {
    cursorRepeatTokenRef.current += 1;
    if (cursorRepeatTimerRef.current != null) {
      clearTimeout(cursorRepeatTimerRef.current);
    }
    cursorRepeatTimerRef.current = null;
  }

  function startRepeatingBackspace(
    id: "backspace" | "numeric-backspace" = "backspace",
  ) {
    stopRepeatingBackspace();
    stopRepeatingCursorMove();
    cancelPendingPressFeedback();
    const repeatToken = ++globalRepeatingDeleteToken;
    lastDeleteClickAtRef.current = 0;
    lastDeleteHapticAtRef.current = 0;
    pressBackspace();
    playRepeatingDeleteFeedback();
    const repeat = () => {
      if (repeatToken !== globalRepeatingDeleteToken) return;
      pressBackspace();
      playRepeatingDeleteFeedback();
      if (repeatToken !== globalRepeatingDeleteToken) return;
      globalRepeatingDeleteTimer = setTimeout(repeat, 82);
    };
    globalRepeatingDeleteTimer = setTimeout(repeat, 82);
    globalRepeatingDeleteSafetyTimer = setTimeout(() => {
      if (repeatToken !== globalRepeatingDeleteToken) return;
      stopRepeatingBackspace();
      setKeyPressed(id, false);
    }, DELETE_REPEAT_SAFETY_DURATION);
  }

  function startRepeatingCursorMove(offset: number) {
    stopRepeatingCursorMove();
    stopRepeatingBackspace();
    cancelPendingPressFeedback();
    const repeatToken = ++cursorRepeatTokenRef.current;
    const repeat = () => {
      if (repeatToken !== cursorRepeatTokenRef.current) return;
      if (!moveCursorSafely(offset)) return;
      playCursorMoveFeedback();
      cursorRepeatTimerRef.current = setTimeout(repeat, 72);
    };
    repeat();
  }

  function clearComposition() {
    stopRepeatingBackspace();
    const s = sessionRef.current;
    if (s) {
      try {
        s.clearComposition();
        s.processKey(KEY_ESCAPE);
      } catch {}
      refresh(s);
    }
    setRimeState((prev) => ({
      ...prev,
      preedit: "",
      preeditCursor: 0,
      candidates: [],
      highlightedIdx: 0,
      pageNo: 0,
      isLastPage: true,
    }));
    setCandidateExpanded(false);
    setExpandedCandidates([]);
    setExpandedBatchHasMore(false);
    setBackslashWrapMode(false);
    try {
      CustomKeyboard.setMarkedText("", 0, 0);
      CustomKeyboard.unmarkText();
    } catch {}
  }

  function pressSpace() {
    const s = sessionRef.current;
    if (ascii) {
      insertTextReplacingSelectAll(" ");
      return;
    }
    if (s && (s.context?.preedit?.length ?? 0) > 0) {
      s.processKey(KEY_SPACE);
      refresh(s);
    } else {
      insertTextReplacingSelectAll(" ");
    }
  }

  function pressReturn() {
    processKey(KEY_RETURN, "\n", true);
  }

  function insertNewline() {
    insertTextReplacingSelectAll("\n");
  }

  function backspaceLongPressMove(details: any) {
    const dx = Math.abs(Number(details?.translation?.width ?? 0));
    const dy = Math.abs(Number(details?.translation?.height ?? 0));
    const vx = Math.abs(Number(details?.velocity?.width ?? 0));
    const vy = Math.abs(Number(details?.velocity?.height ?? 0));
    const predictedDx = Math.abs(
      Number(details?.predictedEndTranslation?.width ?? 0),
    );
    const predictedDy = Math.abs(
      Number(details?.predictedEndTranslation?.height ?? 0),
    );
    if (
      dx >= 5 || dy >= 5 || vx >= 8 || vy >= 8 || predictedDx >= 8 ||
      predictedDy >= 8
    ) {
      cancelPendingPressFeedback();
      stopRepeatingBackspace();
    }
  }

  function backspaceSwipeLeft() {
    cancelPendingPressFeedback();
    stopRepeatingBackspace();
    runConfiguredAction(
      settings.backspaceSwipeLeft,
      settings.backspaceSwipeLeftMode,
    );
  }

  function backspaceSwipeUp() {
    cancelPendingPressFeedback();
    stopRepeatingBackspace();
    runConfiguredAction(
      settings.backspaceSwipeUp,
      settings.backspaceSwipeUpMode,
    );
  }

  function backspaceSwipeDown() {
    cancelPendingPressFeedback();
    stopRepeatingBackspace();
    runConfiguredAction(
      settings.backspaceSwipeDown,
      settings.backspaceSwipeDownMode,
    );
  }

  function cancelBackspaceSwipeStart() {
    cancelPendingPressFeedback();
    stopRepeatingBackspace();
  }

  function toggleAscii() {
    const s = sessionRef.current;
    if (!s) return;
    if (preedit) clearComposition();
    const next = !ascii;
    s.setOption("ascii_mode", next);
    setShifted(false);
    setCapsLocked(false);
    refresh(s);
  }

  function pressShift() {
    if (composing && settings.shiftComposingEnabled) {
      runConfiguredAction(
        settings.shiftComposingKey,
        settings.shiftComposingKeyMode,
      );
      return;
    }
    const now = Date.now();
    if (capsLocked) {
      setCapsLocked(false);
      setShifted(false);
    } else if (now - lastShiftTapRef.current < 430) {
      setCapsLocked(true);
      setShifted(true);
    } else {
      setShifted((value) => !value);
    }
    lastShiftTapRef.current = now;
  }

  function switchSchema(id: string) {
    const s = sessionRef.current;
    if (!s) return;
    s.clearComposition();
    s.selectSchema(id);
    refresh(s);
  }

  function selectCandidateOnPage(index: number) {
    const s = sessionRef.current;
    if (!s) return;
    if (s.selectCandidateOnCurrentPage(index)) refresh(s);
  }

  function selectCandidateByKey(key: string): boolean {
    const s = sessionRef.current;
    if (!s || !s.context?.preedit) return false;
    const selectKeys = s.context.selectKeys || "1234567890";
    const index = selectKeys.indexOf(key);
    if (index < 0) return false;
    if (!s.context.menu?.candidates[index]) return false;
    if (!s.selectCandidateOnCurrentPage(index)) return false;
    refresh(s);
    return true;
  }

  function selectCandidateAbsolute(index: number) {
    const s = sessionRef.current;
    if (!s) return;
    if (s.selectCandidate(index)) refresh(s);
  }

  function highlightCandidateAbsolute(index: number): boolean {
    const s = sessionRef.current;
    let menu = s?.context?.menu;
    if (!s || !menu) return false;
    const pageSize = Math.max(1, menu.pageSize || rimePageSize || 1);
    const targetPage = Math.floor(index / pageSize);
    const targetIndex = index % pageSize;

    while (menu.pageNo < targetPage) {
      if (menu.isLastPage || !s.processKey(KEY_PAGE_DOWN)) break;
      menu = s.context?.menu ?? null;
      if (!menu) return false;
    }
    while (menu.pageNo > targetPage) {
      if (!s.processKey(KEY_PAGE_UP)) break;
      menu = s.context?.menu ?? null;
      if (!menu) return false;
    }
    if (menu.pageNo !== targetPage) {
      refresh(s);
      return false;
    }
    if (!menu.candidates[targetIndex]) {
      refresh(s);
      return false;
    }

    let current = menu.highlightedIndex ?? 0;
    const key = targetIndex > current ? KEY_DOWN : KEY_UP;
    while (current !== targetIndex) {
      if (!s.processKey(key)) break;
      menu = s.context?.menu ?? null;
      if (!menu) return false;
      current = menu.highlightedIndex ?? current;
      if (menu.pageNo !== targetPage) break;
    }
    refresh(s);
    return s.context?.menu?.pageNo === targetPage &&
      s.context?.menu?.highlightedIndex === targetIndex;
  }

  function processSpaceSwipeCandidate(numberKey: "2" | "3") {
    if (preedit) {
      if (selectCandidateByKey(numberKey)) return;
      processKey(numberKey.charCodeAt(0), numberKey);
      return;
    }
    selectCandidateOnPage(numberKey === "2" ? 1 : 2);
  }

  function canSpaceSwipeCandidate(numberKey: "2" | "3") {
    const index = numberKey === "2" ? 1 : 2;
    return preedit.length > 0 && candidates.length > index;
  }

  function pressNumericDigit(value: string) {
    pressSymbol(value);
  }

  function commitComposition() {
    const s = sessionRef.current;
    if (!s) return;
    const result = s.commitComposition();
    if (result?.text) insertTextReplacingSelectAll(result.text);
    void s.commit;
    refresh(s);
  }

  async function pasteText() {
    try {
      const text = await Pasteboard.getString();
      if (text) insertTextReplacingSelectAll(text);
    } catch {}
  }

  async function copySelectedText() {
    try {
      if (CustomKeyboard.selectedText) {
        await Pasteboard.setString(CustomKeyboard.selectedText);
        clearSelectAllStateForExternalAction();
      }
    } catch {}
  }

  async function cutSelectedText() {
    try {
      if (!CustomKeyboard.selectedText) return;
      await Pasteboard.setString(CustomKeyboard.selectedText);
      clearSelectAllStateForExternalAction();
      CustomKeyboard.deleteBackward();
    } catch {}
  }

  function clearSelectAllState() {
    selectAllSnapshotRef.current = null;
    setSelectAllActive(false);
  }

  function clearSelectAllStateForExternalAction() {
    if (!selectAllActive && !selectAllSnapshotRef.current) return;
    clearSelectAllState();
  }

  function selectedTextSnapshot() {
    const before = CustomKeyboard.textBeforeCursor ?? "";
    const after = CustomKeyboard.textAfterCursor ?? "";
    const joined = `${before}${after}`;
    return joined || CustomKeyboard.allText || "";
  }

  function deleteDeletableTextAroundCursor(): string {
    const text = selectedTextSnapshot();
    if (!text) return "";
    const before = CustomKeyboard.textBeforeCursor ?? "";
    const after = CustomKeyboard.textAfterCursor ?? "";
    const deleteCount = before.length + after.length || text.length;
    if (after.length > 0) CustomKeyboard.moveCursor(after.length);
    for (let i = 0; i < deleteCount; i += 1) CustomKeyboard.deleteBackward();
    return text;
  }

  function consumeSelectAllForReplacement() {
    if (!selectAllActive && !selectAllSnapshotRef.current) return;
    try {
      if (CustomKeyboard.selectedText) {
        CustomKeyboard.deleteBackward();
      } else {
        try {
          CustomKeyboard.setMarkedText("", 0, 0);
          CustomKeyboard.unmarkText();
        } catch {}
        deleteDeletableTextAroundCursor();
      }
    } catch {}
    clearSelectAllState();
  }

  function consumeSelectAllForDeletion() {
    if (!selectAllActive && !selectAllSnapshotRef.current) return false;
    const deleted = deleteDeletableTextAroundCursor() ||
      selectAllSnapshotRef.current?.text ||
      "";
    if (deleted) deletedTextRef.current = deleted;
    clearSelectAllState();
    return true;
  }

  function insertTextReplacingSelectAll(text: string) {
    if (!text) return;
    consumeSelectAllForReplacement();
    CustomKeyboard.insertText(text);
  }

  function textSnapshot() {
    return CustomKeyboard.allText || selectedTextSnapshot();
  }

  async function selectAllBestEffort() {
    try {
      const text = textSnapshot();
      if (!text) {
        clearSelectAllState();
        return false;
      }
      selectAllSnapshotRef.current = {
        text,
        cursorBefore: CustomKeyboard.textBeforeCursor?.length ?? 0,
      };

      const keyboard = CustomKeyboard as any;
      if (typeof keyboard.selectAll === "function") {
        keyboard.selectAll();
        setSelectAllActive(true);
        return true;
      }
      if (typeof keyboard.setSelectionRange === "function") {
        keyboard.setSelectionRange(0, CustomKeyboard.allText?.length ?? 0);
        setSelectAllActive(true);
        return true;
      }
      if (typeof keyboard.selectText === "function") {
        keyboard.selectText(0, CustomKeyboard.allText?.length ?? 0);
        setSelectAllActive(true);
        return true;
      }

      const after = CustomKeyboard.textAfterCursor?.length ?? 0;
      if (after > 0) moveCursorSafely(after, true);
      for (let i = 0; i < text.length; i += 1) {
        CustomKeyboard.deleteBackward();
      }
      CustomKeyboard.setMarkedText(text, 0, text.length);
      setSelectAllActive(true);
      return true;
    } catch {}
    clearSelectAllState();
    return false;
  }

  function cancelSelectAllBestEffort() {
    try {
      const snapshot = selectAllSnapshotRef.current;
      if (!snapshot) {
        clearSelectAllState();
        return;
      }
      if (CustomKeyboard.selectedText === snapshot.text) {
        CustomKeyboard.insertText(snapshot.text);
        const cursorFromEnd = snapshot.text.length - snapshot.cursorBefore;
        if (cursorFromEnd !== 0) moveCursorSafely(-cursorFromEnd, true);
      } else {
        try {
          CustomKeyboard.unmarkText();
        } catch {}
      }
    } catch {}
    clearSelectAllState();
  }

  function toggleSelectAll() {
    if (selectAllActive) {
      cancelSelectAllBestEffort();
    } else {
      void selectAllBestEffort();
    }
  }

  function clearSelectAllForCursorMove(offset = 0) {
    if (!selectAllActive && !selectAllSnapshotRef.current) return false;
    try {
      const snapshot = selectAllSnapshotRef.current;
      if (snapshot) {
        CustomKeyboard.insertText(snapshot.text);
        if (offset < 0) {
          CustomKeyboard.moveCursor(-snapshot.text.length);
        }
      } else {
        try {
          CustomKeyboard.unmarkText();
        } catch {}
      }
    } catch {}
    clearSelectAllState();
    return true;
  }

  function moveCursorSafely(offset: number, force = false) {
    if (!force && clearSelectAllForCursorMove(offset)) return false;
    CustomKeyboard.moveCursor(offset);
    return true;
  }

  function deleteAllText() {
    stopRepeatingBackspace();
    try {
      const text = selectedTextSnapshot();
      if (!text) {
        clearSelectAllStateForExternalAction();
        return;
      }
      clearSelectAllStateForExternalAction();
      deletedTextRef.current = text;
      deleteDeletableTextAroundCursor();
    } catch {}
  }

  function restoreDeletedText() {
    stopRepeatingBackspace();
    if (!deletedTextRef.current) return;
    insertTextReplacingSelectAll(deletedTextRef.current);
  }

  function activateWrapDisplayMode() {
    if (!settings.composingFunctionWrapDisplayEnabled) return;
    setBackslashWrapMode(true);
  }

  function runConfiguredAction(action: string, mode: ActionSendMode = "auto") {
    if (!action) return;
    if (mode === "direct") {
      insertConfiguredText(action);
      return;
    }
    if (mode === "rime") {
      processText(action);
      return;
    }
    switch (action) {
      case "":
        return;
      case "{left}":
        moveCursorSafely(-1);
        return;
      case "{right}":
        moveCursorSafely(1);
        return;
      case "{home}":
        if (clearSelectAllForCursorMove(-1)) return;
        CustomKeyboard.moveCursor(
          -(CustomKeyboard.textBeforeCursor?.length ?? 0),
        );
        return;
      case "{end}":
        if (clearSelectAllForCursorMove(1)) return;
        CustomKeyboard.moveCursor(CustomKeyboard.textAfterCursor?.length ?? 0);
        return;
      case "{selectAll}":
        void selectAllBestEffort();
        return;
      case "{toggleSelectAll}":
        toggleSelectAll();
        return;
      case "{cut}":
        void cutSelectedText();
        return;
      case "{copy}":
        void copySelectedText();
        return;
      case "{paste}":
        void pasteText();
        return;
      case "{rimeUp}":
        processKey(KEY_UP);
        return;
      case "{rimeDown}":
        processKey(KEY_DOWN);
        return;
      case "{rimePageUp}":
        processKey(KEY_PAGE_UP);
        return;
      case "{rimePageDown}":
        processKey(KEY_PAGE_DOWN);
        return;
      case "{deleteAll}":
        deleteAllText();
        return;
      case "{restoreDeleted}":
        restoreDeletedText();
        return;
      case "{clearComposition}":
        clearComposition();
        return;
      case "{commitComposition}":
        commitComposition();
        return;
      case "{backslashWrap}":
        processText("\\");
        activateWrapDisplayMode();
        return;
      case "{backslash}":
      case "backslash":
      case "\\":
        processText("\\");
        return;
      default:
        if (processRimeKeySpec(action)) return;
        processText(action);
    }
  }

  function runLetterSwipe(direction: "up" | "down", key: string) {
    const actions = direction === "up"
      ? settings.letterSwipeUp
      : settings.letterSwipeDown;
    const modes = direction === "up"
      ? settings.letterSwipeUpModes
      : settings.letterSwipeDownModes;
    const action = actions[key];
    runConfiguredAction(action, modes[key]);
  }

  function runIdleFunctionSwipe(direction: "up" | "down", key: string) {
    const actions = direction === "up"
      ? settings.idleFunctionSwipeUp
      : settings.idleFunctionSwipeDown;
    const modes = direction === "up"
      ? settings.idleFunctionSwipeUpModes
      : settings.idleFunctionSwipeDownModes;
    runConfiguredAction(actions[key], modes[key]);
  }

  function runIdleFunctionPress(key: string) {
    runConfiguredAction(
      settings.idleFunctionPress[key],
      settings.idleFunctionPressModes[key],
    );
  }

  function runComposingFunctionSwipe(direction: "up" | "down", key: string) {
    const actions = direction === "up"
      ? settings.composingFunctionSwipeUp
      : settings.composingFunctionSwipeDown;
    const modes = direction === "up"
      ? settings.composingFunctionSwipeUpModes
      : settings.composingFunctionSwipeDownModes;
    runConfiguredAction(actions[key], modes[key]);
  }

  function runComposingFunctionPress(key: string) {
    const action = settings.composingFunctionPress[key];
    const mode = settings.composingFunctionPressModes[key];
    runConfiguredAction(action, mode);
    if (
      key === "filter" &&
      action.trim().length > 0 &&
      settings.composingFunctionWrapDisplayEnabled
    ) {
      setBackslashWrapMode(true);
    }
  }

  function runCandidateMenuAction(absoluteIndex: number, action: string) {
    if (!highlightCandidateAbsolute(absoluteIndex)) return;
    runConfiguredAction(action, "rime");
    if (candidateExpanded) collectExpandedCandidateBatch();
  }

  function openRimeSchemaMenu() {
    processKeyWithModifiers("`".charCodeAt(0), MOD_CONTROL);
  }

  function candidateComment(candidate: Rime.Candidate): string {
    return settings.showCandidateComment
      ? (candidate.comment?.trim() ?? "")
      : "";
  }

  const composing = preedit.length > 0;
  const usesComposingFunctionRow = composing && !symbolLayer &&
    settings.composingFunctionRowEnabled;
  const schemaMenu = schemas.length > 1
    ? (
      <Group>
        {schemas.map((schema) => (
          <Button
            key={schema.id}
            title={`${schema.id === currentSchemaId ? "✓ " : ""}${schema.name}${
              schema.name === schema.id ? "" : ` (${schema.id})`
            }`}
            action={() => switchSchema(schema.id)}
          />
        ))}
      </Group>
    )
    : null;
  const candidateMenuActions =
    (settings.candidateMenuCustomEnabled
      ? settings.candidateMenuActions
      : DEFAULT_CANDIDATE_MENU_ACTIONS).filter((item) =>
        item.name.trim().length > 0 && item.action.trim().length > 0
      );
  function candidateContextMenu(absoluteIndex: number) {
    return candidateMenuActions.length > 0
      ? (
        <Group>
          {candidateMenuActions.map((item, index) => (
            <Button
              key={`${index}-${item.name}-${item.action}`}
              title={item.name}
              action={() => runCandidateMenuAction(absoluteIndex, item.action)}
            />
          ))}
        </Group>
      )
      : null;
  }

  function candidateContextMenuProps(absoluteIndex: number) {
    const menuItems = candidateContextMenu(absoluteIndex);
    return menuItems != null ? { menuItems } : undefined;
  }
  const showsPreeditCaret = !error &&
    !settings.inlinePreedit &&
    settings.showPreeditCaret &&
    preedit.length > 0;
  const safePreeditCursor = Math.min(
    preedit.length,
    Math.max(0, preeditCursor),
  );
  const preeditBeforeCaret = showsPreeditCaret
    ? preedit.slice(0, safePreeditCursor)
    : error
    ? `Rime 错误：${error}`
    : settings.inlinePreedit
    ? ""
    : preedit;
  const preeditAfterCaret = showsPreeditCaret
    ? preedit.slice(safePreeditCursor)
    : "";
  const showsPreeditRow = !settings.inlinePreedit;
  const candidateHeaderHeight = settings.inlinePreedit
    ? metrics.candidateBarHeight
    : metrics.candidateBarHeight + metrics.preeditRowHeight + 2;
  const effectiveCandidateRightButtonMode =
    settings.candidateRightButtonMode === "expand" && candidates.length === 0
      ? "dismiss"
      : settings.candidateRightButtonMode;
  const candidateHomeButtonVisible = !composing;
  const candidateHomeButtonWidth = 42;
  const candidateSettingsButtonWidth = candidateHomeButtonVisible ? 42 : 0;
  const candidateSchemaButtonWidth = candidateHomeButtonVisible ? 42 : 0;
  const candidateRightButtonVisible =
    effectiveCandidateRightButtonMode !== "hidden";
  const candidateRightButtonWidth = candidateRightButtonVisible ? 42 : 0;
  const candidateFixedButtonWidth =
    (candidateHomeButtonVisible ? candidateHomeButtonWidth : 0) +
    candidateSettingsButtonWidth +
    candidateSchemaButtonWidth +
    candidateRightButtonWidth;
  const candidateFixedButtonCount = (candidateHomeButtonVisible ? 1 : 0) +
    (candidateSettingsButtonWidth > 0 ? 1 : 0) +
    (candidateSchemaButtonWidth > 0 ? 1 : 0) +
    (candidateRightButtonVisible ? 1 : 0);
  const candidateFixedButtonGaps = KEY_SPACING * candidateFixedButtonCount;
  const candidateBarWidth = metrics.width - candidateFixedButtonWidth -
    candidateFixedButtonGaps;
  const candidateRightButtonImage =
    effectiveCandidateRightButtonMode === "expand"
      ? candidateExpanded ? "chevron.up.circle" : "chevron.down.circle"
      : "keyboard.chevron.compact.down";
  const highlightedAbsoluteIndex = pageNo * rimePageSize + highlightedIdx;
  const expandedPagerWidth = 42;
  const expandedCandidateWidth = metrics.width - expandedPagerWidth -
    KEY_SPACING;
  const showNextKeyboardButton = Device.isiPad;
  const bottomSplitButtonWidth = Math.max(
    20,
    (metrics.bottom.numbers - KEY_SPACING) / 2,
  );
  const bodyRowSpacing = 6;
  const visibleBodyRowCount = (settings.showFunctionRow ? 1 : 0) + 4;
  const normalKeyboardBodyHeight =
    (settings.showFunctionRow
      ? metrics.functionKeyHeight + bodyRowSpacing
      : 0) +
    metrics.keyHeight * 4 +
    bodyRowSpacing * 3;
  const expandedPanelHeight = normalKeyboardBodyHeight;

  function shiftSwipeUp() {
    if (composing && settings.shiftComposingEnabled) {
      runConfiguredAction(
        settings.shiftComposingSwipeUp,
        settings.shiftComposingSwipeUpMode,
      );
    } else {
      processText("'");
    }
  }

  function composingFunctionHitTargets(): KeyHitTarget[] {
    const step = metrics.functionWidth8 + KEY_SPACING;
    const frame = (index: number) =>
      horizontalHitFrame(step * index, metrics.functionWidth8, index, 8);
    return [
      {
        id: "func-left",
        ...frame(0),
        onPress: () => runComposingFunctionPress("left"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "left"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "left"),
      },
      {
        id: "func-page-down",
        ...frame(1),
        onPress: () => runComposingFunctionPress("page"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "page"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "page"),
      },
      {
        id: "tone-1",
        ...frame(2),
        onPress: () => runComposingFunctionPress("tone1"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone1"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone1"),
      },
      {
        id: "tone-2",
        ...frame(3),
        onPress: () => runComposingFunctionPress("tone2"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone2"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone2"),
      },
      {
        id: "tone-3",
        ...frame(4),
        onPress: () => runComposingFunctionPress("tone3"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone3"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone3"),
      },
      {
        id: "tone-4",
        ...frame(5),
        onPress: () => runComposingFunctionPress("tone4"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone4"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone4"),
      },
      {
        id: "func-backslash",
        ...frame(6),
        onPress: () => runComposingFunctionPress("filter"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "filter"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "filter"),
      },
      {
        id: "func-right",
        ...frame(7),
        onPress: () => runComposingFunctionPress("right"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "right"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "right"),
      },
    ];
  }

  function idleFunctionHitTargets(): KeyHitTarget[] {
    const step = metrics.functionWidth8 + KEY_SPACING;
    const frame = (index: number) =>
      horizontalHitFrame(step * index, metrics.functionWidth8, index, 8);
    return [
      {
        id: "idle-left",
        ...frame(0),
        onPress: () => runIdleFunctionPress("left"),
        onLongPress: () => startRepeatingCursorMove(-1),
        onLongPressEnd: stopRepeatingCursorMove,
        longPressDuration: CURSOR_REPEAT_DURATION,
        onSwipeUp: () => runIdleFunctionSwipe("up", "left"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "left"),
      },
      {
        id: "idle-head",
        ...frame(1),
        onPress: () => runIdleFunctionPress("head"),
        onSwipeUp: () => runIdleFunctionSwipe("up", "head"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "head"),
      },
      {
        id: "idle-schema",
        ...frame(2),
        onPress: () => runIdleFunctionPress("select"),
        onSwipeUp: () => runIdleFunctionSwipe("up", "select"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "select"),
      },
      {
        id: "idle-cut",
        ...frame(3),
        onPress: () => runIdleFunctionPress("cut"),
        onSwipeUp: () => runIdleFunctionSwipe("up", "cut"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "cut"),
      },
      {
        id: "idle-copy",
        ...frame(4),
        onPress: () => runIdleFunctionPress("copy"),
        onSwipeUp: () => runIdleFunctionSwipe("up", "copy"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "copy"),
      },
      {
        id: "idle-paste",
        ...frame(5),
        onPress: () => runIdleFunctionPress("paste"),
        onSwipeUp: () => runIdleFunctionSwipe("up", "paste"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "paste"),
      },
      {
        id: "idle-tail",
        ...frame(6),
        onPress: () => runIdleFunctionPress("tail"),
        onSwipeUp: () => runIdleFunctionSwipe("up", "tail"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "tail"),
      },
      {
        id: "idle-right",
        ...frame(7),
        onPress: () => runIdleFunctionPress("right"),
        onLongPress: () => startRepeatingCursorMove(1),
        onLongPressEnd: stopRepeatingCursorMove,
        longPressDuration: CURSOR_REPEAT_DURATION,
        onSwipeUp: () => runIdleFunctionSwipe("up", "right"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "right"),
      },
    ];
  }

  function bottomRowHitTargets(): KeyHitTarget[] {
    let x = 0;
    const targets: KeyHitTarget[] = [];
    if (showNextKeyboardButton) {
      targets.push({
        id: "next-keyboard",
        x,
        width: bottomSplitButtonWidth,
        onPress: () => CustomKeyboard.nextKeyboard(),
      });
      x += bottomSplitButtonWidth + KEY_SPACING;
      targets.push({
        id: "numbers",
        x,
        width: bottomSplitButtonWidth,
        onPress: toggleSymbolLayer,
        onSwipeUp: () => pressSymbol("`"),
      });
      x += bottomSplitButtonWidth + KEY_SPACING;
    } else {
      targets.push({
        id: "numbers",
        x,
        width: metrics.bottom.numbers,
        onPress: toggleSymbolLayer,
        onSwipeUp: () => pressSymbol("`"),
      });
      x += metrics.bottom.numbers + KEY_SPACING;
    }
    targets.push({
      id: "comma",
      x,
      width: metrics.bottom.comma,
      onPress: () => pressRimePunctuation(","),
      onSwipeUp: () => pressRimePunctuation("."),
    });
    x += metrics.bottom.comma + KEY_SPACING;
    targets.push({
      id: "space",
      x,
      width: metrics.bottom.space,
      onPress: pressSpace,
      onLongPress: () => {
        spaceCursorDragXRef.current = null;
      },
      onLongPressEnd: () => {
        spaceCursorDragXRef.current = null;
      },
      onSwipeUp: canSpaceSwipeCandidate("2")
        ? () => processSpaceSwipeCandidate("2")
        : undefined,
      onSwipeDown: canSpaceSwipeCandidate("3")
        ? () => processSpaceSwipeCandidate("3")
        : undefined,
      onSwipeLeft: () => moveCursorSafely(-1),
      onSwipeRight: () => moveCursorSafely(1),
    });
    x += metrics.bottom.space + KEY_SPACING;
    targets.push({
      id: "mode",
      x,
      width: metrics.bottom.mode,
      safetyReleaseDelay: 180,
      onPress: () => {
        if (composing && settings.modeComposingEnabled) {
          runConfiguredAction(
            settings.modeComposingAction,
            settings.modeComposingActionMode,
          );
        } else {
          toggleAscii();
        }
      },
      onSwipeUp: composing && settings.modeComposingEnabled
        ? () =>
          runConfiguredAction(
            settings.modeComposingSwipeUp,
            settings.modeComposingSwipeUpMode,
          )
        : undefined,
      onSwipeDown: composing && settings.modeComposingEnabled
        ? () =>
          runConfiguredAction(
            settings.modeComposingSwipeDown,
            settings.modeComposingSwipeDownMode,
          )
        : undefined,
    });
    x += metrics.bottom.mode + KEY_SPACING;
    targets.push({
      id: "enter",
      x,
      width: metrics.bottom.enter,
      onPress: pressReturn,
      onSwipeUp: insertNewline,
    });
    return targets.map((target, index) => ({
      ...target,
      ...horizontalHitFrame(target.x, target.width, index, targets.length),
    }));
  }

  function numericRowHitTargets(row: string[]): KeyHitTarget[] {
    return row.map((value, index) => {
      const displayX = index * (numericKeyWidth + KEY_SPACING);
      return {
        id: value === "ABC"
          ? "numeric-abc"
          : value === "space"
          ? "numeric-space"
          : `numeric-${value}`,
        ...horizontalHitFrame(displayX, numericKeyWidth, index, row.length),
        onPress: () => {
          if (value === "ABC") switchToLetterLayer();
          else if (value === "space") pressSpace();
          else pressNumericDigit(value);
        },
        onLongPress: value === "space"
          ? () => {
            spaceCursorDragXRef.current = null;
          }
          : undefined,
        onLongPressEnd: value === "space"
          ? () => {
            spaceCursorDragXRef.current = null;
          }
          : undefined,
        onSwipeUp: value === "space" && canSpaceSwipeCandidate("2")
          ? () => processSpaceSwipeCandidate("2")
          : undefined,
        onSwipeDown: value === "space" && canSpaceSwipeCandidate("3")
          ? () => processSpaceSwipeCandidate("3")
          : undefined,
        onSwipeLeft: value === "space" ? () => moveCursorSafely(-1) : undefined,
        onSwipeRight: value === "space" ? () => moveCursorSafely(1) : undefined,
      };
    });
  }

  function numericRightHitTargets(): KeyHitTarget[] {
    const frame = (index: number) =>
      verticalHitFrame(
        (metrics.keyHeight + numericRowSpacing) * index,
        metrics.keyHeight,
        index,
        4,
        numericRowSpacing,
      );
    return [
      {
        id: "numeric-backspace",
        x: 0,
        width: numericRightWidth,
        ...frame(0),
        onPress: pressBackspace,
        onLongPress: () => startRepeatingBackspace("numeric-backspace"),
        onLongPressEnd: stopRepeatingBackspace,
        longPressDuration: DELETE_LONG_PRESS_DURATION,
        onSwipeLeft: backspaceSwipeLeft,
        onSwipeUp: backspaceSwipeUp,
        onSwipeDown: backspaceSwipeDown,
      },
      {
        id: "numeric-dot",
        x: 0,
        width: numericRightWidth,
        ...frame(1),
        onPress: pressNumericDot,
      },
      {
        id: "numeric-equal",
        x: 0,
        width: numericRightWidth,
        ...frame(2),
        onPress: () => pressSymbol("="),
        onSwipeUp: () =>
          runConfiguredAction(settings.numericEqualsSwipeUp, "rime"),
      },
      {
        id: "numeric-enter",
        x: 0,
        width: numericRightWidth,
        ...frame(3),
        onPress: pressReturn,
        onSwipeUp: insertNewline,
      },
    ];
  }

  function collectExpandedCandidateBatch(session = sessionRef.current) {
    const menu = session?.context?.menu;
    if (!session || !menu) {
      setExpandedCandidates([]);
      setExpandedBatchHasMore(false);
      return;
    }

    const originalPage = menu.pageNo;
    const items: ExpandedCandidateItem[] = [];
    let hasMore = false;

    for (let page = 0; page < EXPANDED_RIME_PAGE_BATCH; page += 1) {
      const currentMenu = session.context?.menu;
      if (!currentMenu) break;
      currentMenu.candidates.forEach((candidate, index) => {
        items.push({
          candidate,
          absoluteIndex: currentMenu.pageNo * currentMenu.pageSize + index,
        });
      });
      if (currentMenu.isLastPage) break;
      if (page === EXPANDED_RIME_PAGE_BATCH - 1) {
        hasMore = true;
        break;
      }
      if (!session.processKey(KEY_PAGE_DOWN)) break;
    }

    const currentPage = session.context?.menu?.pageNo ?? originalPage;
    for (let page = currentPage; page > originalPage; page -= 1) {
      session.processKey(KEY_PAGE_UP);
    }

    setExpandedCandidates(items);
    setExpandedBatchHasMore(hasMore);
    refresh(session);
  }

  function moveExpandedCandidateBatch(direction: "up" | "down") {
    const s = sessionRef.current;
    if (!s) return;
    stopRepeatingBackspace();
    stopRepeatingCursorMove();
    clearAllRowGestureState();
    releaseAllPressedKeys();

    if (direction === "up") {
      const menu = s.context?.menu;
      const steps = Math.min(EXPANDED_RIME_PAGE_BATCH, menu?.pageNo ?? 0);
      for (let i = 0; i < steps; i += 1) {
        s.processKey(KEY_PAGE_UP);
      }
    } else {
      for (let i = 0; i < EXPANDED_RIME_PAGE_BATCH; i += 1) {
        const menu = s.context?.menu;
        if (!menu || menu.isLastPage) break;
        if (!s.processKey(KEY_PAGE_DOWN)) break;
      }
    }
    collectExpandedCandidateBatch(s);
  }

  function pressCandidateRightButton() {
    stopRepeatingBackspace();
    stopRepeatingCursorMove();
    clearAllRowGestureState();
    releaseAllPressedKeys();
    if (effectiveCandidateRightButtonMode === "expand") {
      if (candidateExpanded) {
        setCandidateExpanded(false);
        setExpandedCandidates([]);
        setExpandedBatchHasMore(false);
      } else {
        collectExpandedCandidateBatch();
        setCandidateExpanded(true);
      }
    } else if (effectiveCandidateRightButtonMode === "dismiss") {
      CustomKeyboard.dismiss();
    }
  }

  function pressCandidateHomeButton() {
    CustomKeyboard.dismissToHome();
  }

  function pressCandidateSettingsButton() {
    const url = Script.createRunSingleURLScheme(Script.name, {
      source: "keyboard-settings",
    });
    try {
      CustomKeyboard.dismiss();
    } catch {}
    setTimeout(() => {
      void Safari.openURL(url);
    }, 80);
  }

  const numericRowSpacing = 6;
  const numericPanelHeight = metrics.keyHeight * 4 + numericRowSpacing * 3;
  const numericLeftWidth = Math.max(40, Math.min(56, metrics.width * 0.14));
  const numericRightWidth = Math.max(48, Math.min(72, metrics.width * 0.18));
  const numericCenterWidth = metrics.width - numericLeftWidth -
    numericRightWidth - KEY_SPACING * 2;
  const numericKeyWidth = (numericCenterWidth - KEY_SPACING * 2) / 3;
  const numericPanelTopInset = settings.showFunctionRow
    ? bodyRowSpacing / 2
    : 0;
  const numericTouchFrame = (index: number) =>
    verticalTouchFrame(index, 4, metrics.keyHeight, numericRowSpacing);
  const numericBottomTouch = numericTouchFrame(3);
  const bodyTouchFrame = (index: number, height: number) =>
    verticalTouchFrame(
      index,
      visibleBodyRowCount,
      height,
      bodyRowSpacing,
    );
  const functionRowTouch = bodyTouchFrame(0, metrics.functionKeyHeight);
  const bottomRowTouch = bodyTouchFrame(
    visibleBodyRowCount - 1,
    metrics.keyHeight,
  );

  return (
    <VStack
      spacing={6}
      padding={{ horizontal: SIDE_PADDING, top: 4, bottom: 2 }}
      frame={{
        width: metrics.width + SIDE_PADDING * 2,
        maxHeight: "infinity" as any,
      }}
    >
      <VStack
        spacing={showsPreeditRow ? 2 : 0}
        frame={{
          width: metrics.width,
          height: candidateHeaderHeight,
          alignment: "leading" as any,
        }}
      >
        {showsPreeditRow
          ? (
            <HStack
              spacing={1}
              padding={{ leading: 8 }}
              frame={{
                width: metrics.width,
                height: metrics.preeditRowHeight,
                alignment: "bottomLeading" as any,
              }}
            >
              <Text
                font="caption"
                lineLimit={1}
                foregroundStyle={palette.primary as any}
              >
                {preeditBeforeCaret}
              </Text>
              {showsPreeditCaret
                ? (
                  <Text
                    font="caption2"
                    baselineOffset={-7}
                    foregroundStyle={palette.primary as any}
                    padding={{ bottom: -2 }}
                  >
                    ^
                  </Text>
                )
                : null}
              {preeditAfterCaret
                ? (
                  <Text
                    font="caption"
                    lineLimit={1}
                    foregroundStyle={palette.primary as any}
                  >
                    {preeditAfterCaret}
                  </Text>
                )
                : null}
            </HStack>
          )
          : null}
        <HStack
          spacing={KEY_SPACING}
          frame={{ width: metrics.width, height: metrics.candidateBarHeight }}
        >
          {candidateHomeButtonVisible
            ? (
              <KeyFace
                id="candidate-home"
                image="house"
                palette={palette}
                width={candidateHomeButtonWidth}
                height={metrics.candidateButtonHeight}
                system
                plain
                foregroundStyle={palette.primary}
                onPress={() => runWithFeedback(pressCandidateHomeButton)}
              />
            )
            : null}
          {candidateHomeButtonVisible
            ? (
              <KeyFace
                id="candidate-settings"
                image="gearshape"
                palette={palette}
                width={candidateSettingsButtonWidth}
                height={metrics.candidateButtonHeight}
                system
                plain
                foregroundStyle={palette.primary}
                onPress={() => runWithFeedback(pressCandidateSettingsButton)}
              />
            )
            : null}
          {candidateHomeButtonVisible
            ? (
              <KeyFace
                id="candidate-schema"
                image="list.bullet.rectangle"
                palette={palette}
                width={candidateSchemaButtonWidth}
                height={metrics.candidateButtonHeight}
                system
                plain
                foregroundStyle={palette.primary}
                onPress={() => runWithFeedback(openRimeSchemaMenu)}
                contextMenu={schemaMenu != null
                  ? { menuItems: schemaMenu }
                  : undefined}
              />
            )
            : null}
          <ScrollView
            axes="horizontal"
            scrollIndicator="hidden"
            frame={{
              width: candidateBarWidth,
              height: metrics.candidateBarHeight,
            }}
          >
            <HStack spacing={5} buttonStyle="plain">
              {candidates.map((candidate, idx) => (
                <CandidateButton
                  key={`${pageNo}-${idx}-${candidate.text}`}
                  index={idx}
                  candidate={candidate}
                  comment={candidateComment(candidate)}
                  showIndex={settings.showCandidateComment}
                  selected={idx === highlightedIdx}
                  palette={palette}
                  height={metrics.candidateButtonHeight}
                  candidateFontSize={metrics.candidateFontSize}
                  commentFontSize={metrics.candidateCommentFontSize}
                  contextMenu={candidateContextMenuProps(
                    pageNo * rimePageSize + idx,
                  )}
                  onPress={() =>
                    runWithFeedback(() =>
                      selectCandidateAbsolute(pageNo * rimePageSize + idx)
                    )}
                />
              ))}
            </HStack>
          </ScrollView>
          {candidateRightButtonVisible
            ? (
              <KeyFace
                id="candidate-right"
                image={candidateRightButtonImage}
                palette={palette}
                width={candidateRightButtonWidth}
                height={metrics.candidateButtonHeight}
                system
                plain
                foregroundStyle={palette.primary}
                onPress={() => runWithFeedback(pressCandidateRightButton)}
              />
            )
            : null}
        </HStack>
      </VStack>

      <ZStack frame={{ width: metrics.width, height: expandedPanelHeight }}>
        <VStack
          spacing={0}
          frame={{
            width: metrics.width,
            height: expandedPanelHeight,
            alignment: "top" as any,
          }}
          opacity={candidateExpanded ? 0 : 1}
        >
          <Group>
            {settings.showFunctionRow
              ? (
                usesComposingFunctionRow
                  ? (
                    <HStack
                      spacing={KEY_SPACING}
                      frame={{
                        width: metrics.width,
                        height: functionRowTouch.touchHeight,
                      }}
                      contentShape="rect"
                      highPriorityGesture={hitRowGesture(
                        "func-comp",
                        composingFunctionHitTargets(),
                      )}
                    >
                      <KeyFace
                        id="func-left"
                        image={settings.composingFunctionSymbols.left}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("func-left")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("left")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "left")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "left")
                          )}
                      />
                      <KeyFace
                        id="func-page-down"
                        image={settings.composingFunctionSymbols.page}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("func-page-down")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("page")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "page")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "page")
                          )}
                      />
                      <KeyFace
                        id="tone-1"
                        image={settings.composingFunctionSymbols.tone1}
                        imageScale="medium"
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("tone-1")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("tone1")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "tone1")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "tone1")
                          )}
                      />
                      <KeyFace
                        id="tone-2"
                        image={settings.composingFunctionSymbols.tone2}
                        imageScale="medium"
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("tone-2")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("tone2")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "tone2")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "tone2")
                          )}
                      />
                      <KeyFace
                        id="tone-3"
                        image={settings.composingFunctionSymbols.tone3}
                        imageScale="medium"
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("tone-3")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("tone3")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "tone3")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "tone3")
                          )}
                      />
                      <KeyFace
                        id="tone-4"
                        image={settings.composingFunctionSymbols.tone4}
                        imageScale="medium"
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("tone-4")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("tone4")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "tone4")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "tone4")
                          )}
                      />
                      <KeyFace
                        id="func-backslash"
                        image={settings.composingFunctionSymbols.filter}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("func-backslash")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("filter")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "filter")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "filter")
                          )}
                      />
                      <KeyFace
                        id="func-right"
                        image={settings.composingFunctionSymbols.right}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("func-right")}
                        onPress={() =>
                          runWithFeedback(() =>
                            runComposingFunctionPress("right")
                          )}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("up", "right")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runComposingFunctionSwipe("down", "right")
                          )}
                      />
                    </HStack>
                  )
                  : (
                    <HStack
                      spacing={KEY_SPACING}
                      frame={{
                        width: metrics.width,
                        height: functionRowTouch.touchHeight,
                      }}
                      contentShape="rect"
                      highPriorityGesture={hitRowGesture(
                        "func-idle",
                        idleFunctionHitTargets(),
                      )}
                    >
                      <KeyFace
                        id="idle-left"
                        image={settings.idleFunctionSymbols.left}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-left")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("left"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "left")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "left")
                          )}
                      />
                      <KeyFace
                        id="idle-head"
                        image={settings.idleFunctionSymbols.head}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-head")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("head"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "head")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "head")
                          )}
                      />
                      <KeyFace
                        id="idle-schema"
                        image={selectAllActive &&
                            settings.idleFunctionSymbols.select ===
                              "selection.pin.in.out"
                          ? "xmark.circle"
                          : settings.idleFunctionSymbols.select}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-schema")}
                        selected={selectAllActive}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("select"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "select")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "select")
                          )}
                      />
                      <KeyFace
                        id="idle-cut"
                        image={settings.idleFunctionSymbols.cut}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-cut")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("cut"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "cut")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "cut")
                          )}
                      />
                      <KeyFace
                        id="idle-copy"
                        image={settings.idleFunctionSymbols.copy}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-copy")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("copy"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "copy")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "copy")
                          )}
                      />
                      <KeyFace
                        id="idle-paste"
                        image={settings.idleFunctionSymbols.paste}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-paste")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("paste"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "paste")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "paste")
                          )}
                      />
                      <KeyFace
                        id="idle-tail"
                        image={settings.idleFunctionSymbols.tail}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-tail")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("tail"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "tail")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "tail")
                          )}
                      />
                      <KeyFace
                        id="idle-right"
                        image={settings.idleFunctionSymbols.right}
                        palette={palette}
                        width={metrics.functionWidth8}
                        height={metrics.functionKeyHeight}
                        touchHeight={functionRowTouch.touchHeight}
                        visualOffsetY={functionRowTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("idle-right")}
                        onPress={() =>
                          runWithFeedback(() => runIdleFunctionPress("right"))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("up", "right")
                          )}
                        onSwipeDown={() =>
                          runWithFeedback(() =>
                            runIdleFunctionSwipe("down", "right")
                          )}
                      />
                    </HStack>
                  )
              )
              : null}

            {symbolLayer
              ? (
                <VStack
                  spacing={0}
                  frame={{
                    width: metrics.width,
                    height: numericPanelHeight + numericPanelTopInset,
                    alignment: "topLeading" as any,
                  }}
                >
                  {numericPanelTopInset > 0
                    ? (
                      <VStack
                        frame={{
                          width: metrics.width,
                          height: numericPanelTopInset,
                        }}
                      />
                    )
                    : null}
                  <HStack
                    spacing={KEY_SPACING}
                    frame={{ width: metrics.width, height: numericPanelHeight }}
                  >
                    <VStack
                      frame={{
                        width: numericLeftWidth,
                        height: numericPanelHeight,
                      }}
                      background={palette.keyBg as any}
                      foregroundStyle={palette.primary as any}
                      clipShape={{ type: "rect", cornerRadius: 8 }}
                      shadow={{
                        color: palette.shadow as any,
                        radius: 1,
                        y: 1,
                      }}
                    >
                      <ScrollView
                        axes="vertical"
                        scrollIndicator="hidden"
                        frame={{
                          width: numericLeftWidth,
                          height: numericPanelHeight,
                        }}
                      >
                        <VStack
                          spacing={0}
                          frame={{
                            width: numericLeftWidth,
                            alignment: "top" as any,
                          }}
                        >
                          {NUMERIC_SYMBOLS.map((item) => (
                            <Text
                              key={`numeric-symbol-${item.label}`}
                              font={18}
                              frame={{
                                width: numericLeftWidth,
                                height: numericPanelHeight / 5,
                                alignment: "center" as any,
                              }}
                              contentShape="rect"
                              onTapGesture={() =>
                                runWithFeedback(() => pressSymbol(item.value))}
                            >
                              {item.label}
                            </Text>
                          ))}
                        </VStack>
                      </ScrollView>
                    </VStack>

                    <VStack
                      spacing={0}
                      frame={{
                        width: numericCenterWidth,
                        height: numericPanelHeight,
                      }}
                    >
                      {[
                        ["1", "2", "3"],
                        ["4", "5", "6"],
                        ["7", "8", "9"],
                      ].map((row, rowIndex) => {
                        const hitTargets = numericRowHitTargets(row);
                        const rowTouch = numericTouchFrame(rowIndex);
                        return (
                          <HStack
                            key={`numeric-row-${rowIndex}`}
                            spacing={KEY_SPACING}
                            frame={{
                              width: numericCenterWidth,
                              height: rowTouch.touchHeight,
                            }}
                            contentShape="rect"
                            highPriorityGesture={hitRowGesture(
                              `num-row-${rowIndex}`,
                              hitTargets,
                            )}
                          >
                            {row.map((value) => (
                              <KeyFace
                                key={`numeric-${value}`}
                                id={`numeric-${value}`}
                                label={value}
                                palette={palette}
                                width={numericKeyWidth}
                                height={metrics.keyHeight}
                                touchHeight={rowTouch.touchHeight}
                                visualOffsetY={rowTouch.visualOffsetY}
                                labelFontSize={24}
                                passive
                                active={isPressed(`numeric-${value}`)}
                                onPress={() =>
                                  runWithFeedback(() =>
                                    pressNumericDigit(value)
                                  )}
                              />
                            ))}
                          </HStack>
                        );
                      })}
                      <HStack
                        spacing={KEY_SPACING}
                        frame={{
                          width: numericCenterWidth,
                          height: numericBottomTouch.touchHeight,
                        }}
                        contentShape="rect"
                        highPriorityGesture={hitRowGesture(
                          "num-row-zero",
                          numericRowHitTargets(["ABC", "0", "space"]),
                        )}
                      >
                        <KeyFace
                          id="numeric-abc"
                          label="ABC"
                          palette={palette}
                          width={numericKeyWidth}
                          height={metrics.keyHeight}
                          touchHeight={numericBottomTouch.touchHeight}
                          visualOffsetY={numericBottomTouch.visualOffsetY}
                          system
                          labelFontSize={16}
                          passive
                          active={isPressed("numeric-abc")}
                          onPress={() => runWithFeedback(switchToLetterLayer)}
                        />
                        <KeyFace
                          id="numeric-0"
                          label="0"
                          palette={palette}
                          width={numericKeyWidth}
                          height={metrics.keyHeight}
                          touchHeight={numericBottomTouch.touchHeight}
                          visualOffsetY={numericBottomTouch.visualOffsetY}
                          labelFontSize={24}
                          passive
                          active={isPressed("numeric-0")}
                          onPress={() =>
                            runWithFeedback(() => pressNumericDigit("0"))}
                        />
                        <KeyFace
                          id="numeric-space"
                          image="space"
                          palette={palette}
                          width={numericKeyWidth}
                          height={metrics.keyHeight}
                          touchHeight={numericBottomTouch.touchHeight}
                          visualOffsetY={numericBottomTouch.visualOffsetY}
                          system
                          passive
                          active={isPressed("numeric-space")}
                          onPress={() => runWithFeedback(pressSpace)}
                        />
                      </HStack>
                    </VStack>

                    <VStack
                      spacing={0}
                      frame={{
                        width: numericRightWidth,
                        height: numericPanelHeight,
                      }}
                      contentShape="rect"
                      highPriorityGesture={hitRowGesture(
                        "num-row-right",
                        numericRightHitTargets(),
                      )}
                    >
                      <KeyFace
                        id="numeric-backspace"
                        image="delete.left"
                        palette={palette}
                        width={numericRightWidth}
                        height={metrics.keyHeight}
                        touchHeight={numericTouchFrame(0).touchHeight}
                        visualOffsetY={numericTouchFrame(0).visualOffsetY}
                        system
                        passive
                        active={isPressed("numeric-backspace")}
                        onPress={() => runWithFeedback(pressBackspace)}
                        onSwipeLeft={() => runWithFeedback(backspaceSwipeLeft)}
                        onSwipeUp={() => runWithFeedback(backspaceSwipeUp)}
                        onSwipeDown={() => runWithFeedback(backspaceSwipeDown)}
                      />
                      <KeyFace
                        id="numeric-dot"
                        label="."
                        palette={palette}
                        width={numericRightWidth}
                        height={metrics.keyHeight}
                        touchHeight={numericTouchFrame(1).touchHeight}
                        visualOffsetY={numericTouchFrame(1).visualOffsetY}
                        passive
                        active={isPressed("numeric-dot")}
                        onPress={() => runWithFeedback(pressNumericDot)}
                      />
                      <KeyFace
                        id="numeric-equal"
                        label="="
                        palette={palette}
                        width={numericRightWidth}
                        height={metrics.keyHeight}
                        touchHeight={numericTouchFrame(2).touchHeight}
                        visualOffsetY={numericTouchFrame(2).visualOffsetY}
                        passive
                        active={isPressed("numeric-equal")}
                        onPress={() => runWithFeedback(() => pressSymbol("="))}
                        onSwipeUp={() =>
                          runWithFeedback(() =>
                            runConfiguredAction(
                              settings.numericEqualsSwipeUp,
                              "rime",
                            )
                          )}
                      />
                      <KeyFace
                        id="numeric-enter"
                        image="paperplane.fill"
                        palette={palette}
                        width={numericRightWidth}
                        height={metrics.keyHeight}
                        touchHeight={numericBottomTouch.touchHeight}
                        visualOffsetY={numericBottomTouch.visualOffsetY}
                        system
                        passive
                        active={isPressed("numeric-enter")}
                        onPress={() => runWithFeedback(pressReturn)}
                        onSwipeUp={() => runWithFeedback(insertNewline)}
                      />
                    </VStack>
                  </HStack>
                </VStack>
              )
              : (
                LETTER_ROWS.map((row, rowIndex) => {
                  const sideInset = rowIndex === 1 ? metrics.secondRowInset : 0;
                  const rowTouch = bodyTouchFrame(
                    (settings.showFunctionRow ? 1 : 0) + rowIndex,
                    metrics.keyHeight,
                  );
                  const letterTouchWidth = (index: number) => {
                    if (rowIndex === 0) {
                      return metrics.letterWidth +
                        (index === 0 || index === row.length - 1
                          ? KEY_SPACING / 2
                          : KEY_SPACING);
                    }
                    if (rowIndex === 2) {
                      return metrics.letterWidth + KEY_SPACING;
                    }
                    if (index === 0) {
                      return sideInset + metrics.letterWidth + KEY_SPACING / 2;
                    }
                    if (index === row.length - 1) {
                      return metrics.letterWidth + sideInset + KEY_SPACING / 2;
                    }
                    return metrics.letterWidth + KEY_SPACING;
                  };
                  const letterVisualOffset = (index: number) =>
                    rowIndex === 0
                      ? index === 0 ? 0 : KEY_SPACING / 2
                      : rowIndex === 2
                      ? KEY_SPACING / 2
                      : index === 0
                      ? sideInset
                      : KEY_SPACING / 2;
                  return (
                    <HStack
                      key={`row-${rowIndex}`}
                      spacing={0}
                      frame={{
                        width: metrics.width,
                        height: rowTouch.touchHeight,
                      }}
                    >
                      {rowIndex === 2
                        ? (
                          <KeyFace
                            id="shift"
                            image={composing && settings.shiftComposingEnabled
                              ? settings.shiftComposingIcon
                              : capsLocked
                              ? "capslock.fill"
                              : shifted
                              ? "shift.fill"
                              : "shift"}
                            palette={palette}
                            width={metrics.shiftWidth}
                            height={metrics.keyHeight}
                            touchWidth={metrics.shiftWidth + KEY_SPACING / 2}
                            touchHeight={rowTouch.touchHeight}
                            visualOffsetX={0}
                            visualOffsetY={rowTouch.visualOffsetY}
                            system
                            selected={shifted || capsLocked}
                            active={isPressed("shift")}
                            onPress={pressShift}
                            onTouchStart={() => beginKeyTouch("shift")}
                            onTouchEnd={() => endKeyTouch("shift")}
                            onSwipeUp={shiftSwipeUp}
                            onSwipeStart={cancelBackspaceSwipeStart}
                            swipeTriggerDistance={currentSwipeTriggerDistance}
                          />
                        )
                        : null}
                      {row.map((ch, index) => (
                        <KeyFace
                          key={ch}
                          id={ch}
                          label={backslashWrapMode
                            ? BACKSLASH_SYMBOLS[ch]
                            : shifted || capsLocked
                            ? ch.toUpperCase()
                            : ch}
                          labelFontSize={backslashWrapMode
                            ? BACKSLASH_SYMBOLS[ch].length > 2 ? 16 : 22
                            : shifted || capsLocked
                            ? 24
                            : 27}
                          topLeft={!backslashWrapMode &&
                              settings.showHintSymbols &&
                              !settings.letterSwipeUpSymbols[ch]
                            ? settings.letterSwipeUp[ch]
                            : undefined}
                          topLeftImage={!backslashWrapMode &&
                              settings.showHintSymbols
                            ? settings.letterSwipeUpSymbols[ch] || undefined
                            : undefined}
                          topRight={!backslashWrapMode &&
                              settings.showHintSymbols &&
                              !settings.letterSwipeDownSymbols[ch]
                            ? settings.letterSwipeDown[ch]
                            : undefined}
                          topRightImage={!backslashWrapMode &&
                              settings.showHintSymbols
                            ? settings.letterSwipeDownSymbols[ch] || undefined
                            : undefined}
                          palette={palette}
                          width={metrics.letterWidth}
                          height={metrics.keyHeight}
                          touchWidth={letterTouchWidth(index)}
                          touchHeight={rowTouch.touchHeight}
                          visualOffsetX={letterVisualOffset(index)}
                          visualOffsetY={rowTouch.visualOffsetY}
                          active={isPressed(ch)}
                          onPress={() => pressLetter(ch)}
                          onTouchStart={() => beginKeyTouch(ch)}
                          onTouchEnd={() => endKeyTouch(ch)}
                          onLongPress={() => {
                            holdKeyPressedUntilRelease(ch);
                            pressUppercaseLetter(ch);
                          }}
                          longPressEnabled={letterLongPressEnabled}
                          longPressDuration={settings.letterLongPressDuration}
                          onSwipeUp={() => runLetterSwipe("up", ch)}
                          onSwipeDown={() => runLetterSwipe("down", ch)}
                          onSwipeStart={cancelPendingPressFeedback}
                          swipeTriggerDistance={currentSwipeTriggerDistance}
                        />
                      ))}
                      {rowIndex === 2
                        ? (
                          <KeyFace
                            id="backspace"
                            image="delete.left"
                            palette={palette}
                            width={metrics.shiftWidth}
                            height={metrics.keyHeight}
                            touchWidth={metrics.shiftWidth + KEY_SPACING / 2}
                            touchHeight={rowTouch.touchHeight}
                            visualOffsetX={KEY_SPACING / 2}
                            visualOffsetY={rowTouch.visualOffsetY}
                            system
                            active={isPressed("backspace")}
                            onPress={pressBackspace}
                            onTouchStart={() => beginKeyTouch("backspace")}
                            onTouchEnd={() => endKeyTouch("backspace")}
                            onLongPress={() => {
                              holdKeyPressedUntilRelease("backspace");
                              startRepeatingBackspace("backspace");
                            }}
                            onLongPressEnd={stopRepeatingBackspace}
                            onLongPressMove={backspaceLongPressMove}
                            longPressDuration={DELETE_LONG_PRESS_DURATION}
                            onSwipeLeft={backspaceSwipeLeft}
                            onSwipeUp={backspaceSwipeUp}
                            onSwipeDown={backspaceSwipeDown}
                            onSwipeStart={cancelPendingPressFeedback}
                            swipeTriggerDistance={currentSwipeTriggerDistance}
                          />
                        )
                        : null}
                    </HStack>
                  );
                })
              )}
          </Group>

          {symbolLayer ? null : (
            <HStack
              spacing={KEY_SPACING}
              frame={{
                width: metrics.width,
                height: bottomRowTouch.touchHeight,
              }}
              contentShape="rect"
              highPriorityGesture={hitRowGesture(
                "bottom-row",
                bottomRowHitTargets(),
              )}
            >
              {showNextKeyboardButton
                ? (
                  <KeyFace
                    id="next-keyboard"
                    image="globe"
                    palette={palette}
                    width={bottomSplitButtonWidth}
                    height={metrics.keyHeight}
                    touchHeight={bottomRowTouch.touchHeight}
                    visualOffsetY={bottomRowTouch.visualOffsetY}
                    system
                    passive
                    active={isPressed("next-keyboard")}
                    onPress={() =>
                      runWithFeedback(() => CustomKeyboard.nextKeyboard())}
                  />
                )
                : null}
              <KeyFace
                id="numbers"
                label={symbolLayer ? "ABC" : "123"}
                palette={palette}
                width={showNextKeyboardButton
                  ? bottomSplitButtonWidth
                  : metrics.bottom.numbers}
                height={metrics.keyHeight}
                touchHeight={bottomRowTouch.touchHeight}
                visualOffsetY={bottomRowTouch.visualOffsetY}
                system
                selected={symbolLayer}
                passive
                active={isPressed("numbers")}
                onPress={() => runWithFeedback(toggleSymbolLayer)}
                onSwipeUp={() => runWithFeedback(() => pressSymbol("`"))}
              />
              <KeyFace
                id="comma"
                label=","
                topCenter="."
                topCenterForeground={palette.primary}
                palette={palette}
                width={metrics.bottom.comma}
                height={metrics.keyHeight}
                touchHeight={bottomRowTouch.touchHeight}
                visualOffsetY={bottomRowTouch.visualOffsetY}
                passive
                active={isPressed("comma")}
                onPress={() => runWithFeedback(() => pressRimePunctuation(","))}
                onSwipeUp={() =>
                  runWithFeedback(() => pressRimePunctuation("."))}
              />
              <KeyFace
                id="space"
                image="space"
                bottomRight={settings.showWanxiangLabel
                  ? settings.spaceLabel
                  : undefined}
                bottomRightFontSize={settings.spaceLabel.length > 4
                  ? 8
                  : settings.spaceLabel.length > 2
                  ? 10
                  : 12}
                palette={palette}
                width={metrics.bottom.space}
                height={metrics.keyHeight}
                touchHeight={bottomRowTouch.touchHeight}
                visualOffsetY={bottomRowTouch.visualOffsetY}
                system
                passive
                active={isPressed("space")}
                onPress={() => runWithFeedback(pressSpace)}
                onSwipeUp={() =>
                  runWithFeedback(() => processSpaceSwipeCandidate("2"))}
                onSwipeDown={() =>
                  runWithFeedback(() => processSpaceSwipeCandidate("3"))}
                onSwipeLeft={() => runWithFeedback(() => moveCursorSafely(-1))}
                onSwipeRight={() => runWithFeedback(() => moveCursorSafely(1))}
              />
              <KeyFace
                id="mode"
                image={composing && settings.modeComposingEnabled
                  ? settings.modeComposingIcon
                  : undefined}
                modeTopLeft={composing && settings.modeComposingEnabled
                  ? undefined
                  : "中"}
                modeBottomRight={composing && settings.modeComposingEnabled
                  ? undefined
                  : "英"}
                modeTopLeftActive={!ascii}
                palette={palette}
                width={metrics.bottom.mode}
                height={metrics.keyHeight}
                touchHeight={bottomRowTouch.touchHeight}
                visualOffsetY={bottomRowTouch.visualOffsetY}
                system
                passive
                active={isPressed("mode")}
                labelFontSize={18}
                onPress={() =>
                  runWithFeedback(() => {
                    if (composing && settings.modeComposingEnabled) {
                      runConfiguredAction(
                        settings.modeComposingAction,
                        settings.modeComposingActionMode,
                      );
                    } else {
                      toggleAscii();
                    }
                  })}
                onSwipeUp={() =>
                  runWithFeedback(() => {
                    if (composing && settings.modeComposingEnabled) {
                      runConfiguredAction(
                        settings.modeComposingSwipeUp,
                        settings.modeComposingSwipeUpMode,
                      );
                    }
                  })}
                onSwipeDown={() =>
                  runWithFeedback(() => {
                    if (composing && settings.modeComposingEnabled) {
                      runConfiguredAction(
                        settings.modeComposingSwipeDown,
                        settings.modeComposingSwipeDownMode,
                      );
                    }
                  })}
                contextMenu={schemaMenu != null
                  ? { menuItems: schemaMenu }
                  : undefined}
              />
              <KeyFace
                id="enter"
                image="paperplane.fill"
                palette={palette}
                width={metrics.bottom.enter}
                height={metrics.keyHeight}
                touchHeight={bottomRowTouch.touchHeight}
                visualOffsetY={bottomRowTouch.visualOffsetY}
                system
                passive
                active={isPressed("enter")}
                onPress={() => runWithFeedback(pressReturn)}
                onSwipeUp={() => runWithFeedback(insertNewline)}
              />
            </HStack>
          )}
        </VStack>

        {candidateExpanded
          ? (
            <HStack
              spacing={KEY_SPACING}
              frame={{ width: metrics.width, height: expandedPanelHeight }}
              background={"rgba(0,0,0,0.001)" as any}
              contentShape="rect"
            >
              <ScrollView
                axes="vertical"
                scrollIndicator="hidden"
                frame={{
                  width: expandedCandidateWidth,
                  height: expandedPanelHeight,
                }}
                background={"rgba(0,0,0,0.001)" as any}
                contentShape="rect"
              >
                <VStack
                  spacing={KEY_SPACING}
                  frame={{
                    width: expandedCandidateWidth,
                    minHeight: expandedPanelHeight,
                    alignment: "top" as any,
                  }}
                  background={"rgba(0,0,0,0.001)" as any}
                  contentShape="rect"
                >
                  <FlowLayout
                    spacing={KEY_SPACING}
                    frame={{
                      width: expandedCandidateWidth,
                      alignment: "leading" as any,
                    }}
                  >
                    {(expandedCandidates.length > 0
                      ? expandedCandidates
                      : candidates.map((candidate, index) => ({
                        candidate,
                        absoluteIndex: pageNo * rimePageSize + index,
                      }))).map(({ candidate, absoluteIndex }) => {
                        const comment = candidateComment(candidate);
                        const naturalWidth = candidateButtonNaturalWidth({
                          text: candidate.text,
                          comment,
                          index: absoluteIndex,
                          showIndex: settings.showCandidateComment,
                          candidateFontSize: metrics.candidateFontSize,
                          commentFontSize: metrics.candidateCommentFontSize,
                          expanded: true,
                        });
                        const width = naturalWidth > expandedCandidateWidth
                          ? expandedCandidateWidth
                          : undefined;
                        return (
                          <CandidateButton
                            key={`expanded-${absoluteIndex}-${candidate.text}`}
                            index={absoluteIndex}
                            candidate={candidate}
                            comment={comment}
                            showIndex={settings.showCandidateComment}
                            selected={absoluteIndex ===
                              highlightedAbsoluteIndex}
                            palette={palette}
                            width={width}
                            naturalWidth={naturalWidth}
                            height={Math.max(
                              52,
                              metrics.candidateButtonHeight + 12,
                            )}
                            candidateFontSize={metrics.candidateFontSize}
                            commentFontSize={metrics.candidateCommentFontSize}
                            expanded
                            contextMenu={candidateContextMenuProps(
                              absoluteIndex,
                            )}
                            onPress={() =>
                              runWithFeedback(() => {
                                selectCandidateAbsolute(absoluteIndex);
                                setCandidateExpanded(false);
                                setExpandedCandidates([]);
                                setExpandedBatchHasMore(false);
                              })}
                          />
                        );
                      })}
                  </FlowLayout>
                </VStack>
              </ScrollView>
              <VStack
                spacing={KEY_SPACING}
                frame={{
                  width: expandedPagerWidth,
                  height: expandedPanelHeight,
                }}
              >
                <KeyFace
                  id="expanded-page-up"
                  image="chevron.up"
                  palette={palette}
                  width={expandedPagerWidth}
                  height={(expandedPanelHeight - KEY_SPACING) / 2}
                  system
                  foregroundStyle={pageNo > 0 ? palette.primary : palette.hint}
                  onPress={pageNo > 0
                    ? () =>
                      runWithFeedback(() => moveExpandedCandidateBatch("up"))
                    : () => {}}
                />
                <KeyFace
                  id="expanded-page-down"
                  image="chevron.down"
                  palette={palette}
                  width={expandedPagerWidth}
                  height={(expandedPanelHeight - KEY_SPACING) / 2}
                  system
                  foregroundStyle={expandedBatchHasMore
                    ? palette.primary
                    : palette.hint}
                  onPress={expandedBatchHasMore
                    ? () =>
                      runWithFeedback(() => moveExpandedCandidateBatch("down"))
                    : () => {}}
                />
              </VStack>
            </HStack>
          )
          : null}
      </ZStack>
    </VStack>
  );
}

function main() {
  const settings = loadRimeKeyboardSettings();
  try {
    CustomKeyboard.setToolbarVisible(false);
  } catch {}
  try {
    const keyboard = CustomKeyboard as any;
    if (typeof keyboard.setHasDictationKey === "function") {
      keyboard.setHasDictationKey(false);
    } else keyboard.hasDictationKey = false;
  } catch {}
  if (settings.useCustomKeyboardHeight) {
    try {
      CustomKeyboard.requestHeight(settings.keyboardHeight);
    } catch {}
  }
  CustomKeyboard.present(<KeyboardView />);
}

main();
