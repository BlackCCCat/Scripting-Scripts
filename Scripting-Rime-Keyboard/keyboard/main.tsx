import {
  Button,
  DragGesture,
  FlowLayout,
  Group,
  HStack,
  Script,
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
} from "scripting";
import {
  type ActionSendMode,
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
import { KEY_SPACING, PREEDIT_ROW_HEIGHT, SIDE_PADDING } from "./constants";
import { keyboardMetrics } from "./metrics";
import { type KeyboardAppearance, paletteFor } from "./palette";
import type { KeyHitTarget } from "./types";
import {
  dragDirection,
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

export function KeyboardView() {
  const [settings] = useState<RimeKeyboardSettings>(() =>
    loadRimeKeyboardSettings(),
  );
  const [keyboardAppearance, setKeyboardAppearance] =
    useState<KeyboardAppearance>(() => currentKeyboardAppearance());
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
    ascii,
    currentSchemaId,
  } = rimeState;
  const [shifted, setShifted] = useState(false);
  const [capsLocked, setCapsLocked] = useState(false);
  const [symbolLayer, setSymbolLayer] = useState(false);
  const [backslashWrapMode, setBackslashWrapMode] = useState(false);
  const [candidateExpanded, setCandidateExpanded] = useState(false);
  const [pressedKeyId, setPressedKeyId] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<Rime.Schema[]>([]);
  const lastShiftTapRef = useRef(0);
  const deletedTextRef = useRef("");
  const pressedKeyIdRef = useRef<string | null>(null);
  const activeHitTargetRef = useRef(new Map<string, KeyHitTarget>());
  const rowLongPressHandledRef = useRef(new Map<string, boolean>());
  const rowLongPressTimerRef = useRef(new Map<string, number | null>());
  const rowLongPressCancelledRef = useRef(new Map<string, boolean>());
  const rowLongPressLatestGestureRef = useRef(new Map<string, any>());
  const rowGestureTokenRef = useRef(new Map<string, number>());
  const nextGestureTokenRef = useRef(0);
  const spaceCursorDragXRef = useRef<number | null>(null);
  const lastPressFeedbackAtRef = useRef(0);
  const lastPressRequestAtRef = useRef(0);
  const pressBurstCountRef = useRef(0);
  const lastCursorFeedbackAtRef = useRef(0);
  const lastDeleteClickAtRef = useRef(0);
  const lastDeleteHapticAtRef = useRef(0);
  const repeatingDeleteTimerRef = useRef<number | null>(null);
  const hapticQueueTimerRef = useRef<any>(null);
  const pendingPressHapticRef = useRef(false);
  const [metrics] = useState(() => keyboardMetrics(settings));

  useEffect(() => {
    const syncKeyboardAppearance = (
      traits?: CustomKeyboard.TextInputTraits,
    ) => {
      const value =
        traits?.keyboardAppearance ?? CustomKeyboard.traits?.keyboardAppearance;
      setKeyboardAppearance(
        value === "dark" || value === "light" ? value : "default",
      );
    };
    syncKeyboardAppearance();
    CustomKeyboard.addListener("textDidChange", syncKeyboardAppearance);
    CustomKeyboard.addListener("selectionDidChange", syncKeyboardAppearance);

    (async () => {
      try {
        await Rime.setup();
        if (settings.autoDeployOnLaunch) {
          await Rime.deploy({ fullCheck: false });
        }
        const list = await Rime.listSchemas();
        setSchemas(list);
        const s = new Rime.Session();
        sessionRef.current = s;
        refresh(s);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      }
    })();

    return () => {
      CustomKeyboard.removeListener("textDidChange", syncKeyboardAppearance);
      CustomKeyboard.removeListener(
        "selectionDidChange",
        syncKeyboardAppearance,
      );
      try {
        CustomKeyboard.unmarkText();
      } catch {}
      for (const timer of rowLongPressTimerRef.current.values()) {
        if (timer != null) clearTimeout(timer);
      }
      rowLongPressTimerRef.current.clear();
      stopRepeatingBackspace();
      if (hapticQueueTimerRef.current) {
        clearTimeout(hapticQueueTimerRef.current);
      }
      hapticQueueTimerRef.current = null;
      pendingPressHapticRef.current = false;
      pressBurstCountRef.current = 0;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

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

  function refresh(session = sessionRef.current) {
    if (!session) return;
    const ctx = session.context;
    const menu = ctx?.menu;
    const commit = session.commit;
    if (commit) CustomKeyboard.insertText(commit);
    updateMarkedText(ctx, Boolean(commit));
    const nextPreedit = ctx?.preedit ?? "";
    const nextCursor = Math.min(
      nextPreedit.length,
      Math.max(0, ctx?.cursorPos ?? nextPreedit.length),
    );
    setRimeState({
      preedit: nextPreedit,
      preeditCursor: nextCursor,
      candidates: menu?.candidates ?? [],
      highlightedIdx: menu?.highlightedIndex ?? 0,
      pageNo: menu?.pageNo ?? 0,
      rimePageSize: menu?.pageSize ?? 5,
      currentSchemaId: session.currentSchema?.id ?? null,
      ascii: session.getOption("ascii_mode"),
    });
    if (!nextPreedit) setBackslashWrapMode(false);
    else if (backslashWrapMode && !nextPreedit.includes("\\")) {
      setBackslashWrapMode(false);
    }
  }

  function runWithFeedback(action: () => void) {
    action();
    playReleaseFeedback();
    playPressFeedback();
  }

  function playPressFeedback() {
    if (!settings.haptics) return;
    const now = Date.now();
    const elapsed = now - lastPressRequestAtRef.current;
    pressBurstCountRef.current =
      elapsed > 110 ? 0 : Math.min(10, pressBurstCountRef.current + 1);
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
    const minInterval =
      burst >= 7
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

  function setPressedVisual(id: string | null) {
    if (pressedKeyIdRef.current === id) return;
    pressedKeyIdRef.current = id;
    setPressedKeyId(id);
  }

  function hitTargetFromGesture(details: any, targets: KeyHitTarget[]) {
    const x = Number(details?.startLocation?.x ?? details?.location?.x ?? 0);
    const y = Number(details?.startLocation?.y ?? details?.location?.y ?? 0);
    return nearestHitTarget(x, y, targets);
  }

  function clearRowLongPressTimer(rowId: string) {
    const timer = rowLongPressTimerRef.current.get(rowId);
    if (timer != null) clearTimeout(timer);
    rowLongPressTimerRef.current.delete(rowId);
  }

  function cancelRowGesture(rowId: string) {
    clearRowLongPressTimer(rowId);
    rowLongPressCancelledRef.current.set(rowId, true);
    rowLongPressHandledRef.current.delete(rowId);
    rowLongPressLatestGestureRef.current.delete(rowId);
    activeHitTargetRef.current.delete(rowId);
    rowGestureTokenRef.current.delete(rowId);
    stopRepeatingBackspace();
    spaceCursorDragXRef.current = null;
    setPressedVisual(null);
  }

  function scheduleRowLongPress(rowId: string, target: KeyHitTarget | null) {
    clearRowLongPressTimer(rowId);
    rowLongPressHandledRef.current.set(rowId, false);
    rowLongPressCancelledRef.current.set(rowId, false);
    rowLongPressLatestGestureRef.current.delete(rowId);
    spaceCursorDragXRef.current = null;
    if (!target?.onLongPress) return;
    const gestureToken = rowGestureTokenRef.current.get(rowId);
    const isSpaceKey = target.id === "space";
    const timer = setTimeout(() => {
      if (gestureToken == null) return;
      if (rowGestureTokenRef.current.get(rowId) !== gestureToken) return;
      if (activeHitTargetRef.current.get(rowId)?.id !== target.id) return;
      if (rowLongPressCancelledRef.current.get(rowId)) return;
      const latest = rowLongPressLatestGestureRef.current.get(rowId);
      if (
        latest &&
        (isSpaceKey
          ? isVerticalDragIntent(latest)
          : isLongPressDragIntent(latest))
      )
        return;
      rowLongPressHandledRef.current.set(rowId, true);
      target.onLongPress?.();
    }, target.longPressDuration ?? 360);
    rowLongPressTimerRef.current.set(rowId, timer as any);
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
    if (
      rowLongPressHandledRef.current.get(rowId) ||
      rowLongPressCancelledRef.current.get(rowId)
    ) {
      return;
    }
    const isSpace = activeHitTargetRef.current.get(rowId)?.id === "space";
    if (
      isSpace ? !isVerticalDragIntent(details) : !isLongPressDragIntent(details)
    )
      return;
    rowLongPressCancelledRef.current.set(rowId, true);
    cancelRowGesture(rowId);
  }

  function updateSpaceCursorDrag(details: any) {
    const x = Number(details?.location?.x ?? details?.startLocation?.x ?? 0);
    if (spaceCursorDragXRef.current == null) {
      spaceCursorDragXRef.current = x;
      return;
    }
    const dx = x - spaceCursorDragXRef.current;
    const steps = Math.trunc(dx / 12);
    if (steps === 0) return;
    CustomKeyboard.moveCursor(steps);
    playCursorMoveFeedback();
    spaceCursorDragXRef.current += steps * 12;
  }

  function handleHitRowGestureChanged(
    rowId: string,
    details: any,
    targets: KeyHitTarget[],
  ) {
    rowLongPressLatestGestureRef.current.set(rowId, details);
    if (rowLongPressHandledRef.current.get(rowId)) {
      if (activeHitTargetRef.current.get(rowId)?.id === "space") {
        updateSpaceCursorDrag(details);
      }
      return;
    }
    if (activeHitTargetRef.current.get(rowId)) {
      cancelRowLongPressIfDragging(rowId, details);
      return;
    }
    const target = hitTargetFromGesture(details, targets);
    if (target) activeHitTargetRef.current.set(rowId, target);
    else activeHitTargetRef.current.delete(rowId);
    rowGestureTokenRef.current.set(rowId, ++nextGestureTokenRef.current);
    setPressedVisual(target?.id ?? null);
    if (target) playPressFeedback();
    scheduleRowLongPress(rowId, target);
  }

  function handleHitRowGestureEnded(
    rowId: string,
    details: any,
    targets: KeyHitTarget[],
  ) {
    const target =
      activeHitTargetRef.current.get(rowId) ??
      hitTargetFromGesture(details, targets);
    clearRowLongPressTimer(rowId);
    rowLongPressCancelledRef.current.set(rowId, true);
    rowLongPressLatestGestureRef.current.delete(rowId);
    rowGestureTokenRef.current.delete(rowId);

    if (!target) {
      rowGestureTokenRef.current.delete(rowId);
      return;
    }
    if (rowLongPressHandledRef.current.get(rowId)) {
      rowLongPressHandledRef.current.delete(rowId);
      spaceCursorDragXRef.current = null;
      target.onLongPressEnd?.();
      cancelRowGesture(rowId);
      return;
    }
    const direction = dragDirection(details);
    playReleaseFeedback();
    if (direction === "up" && target.onSwipeUp) target.onSwipeUp();
    else if (direction === "down" && target.onSwipeDown) target.onSwipeDown();
    else if (direction === "left" && target.onSwipeLeft) target.onSwipeLeft();
    else if (direction === "right" && target.onSwipeRight) {
      target.onSwipeRight();
    } else target.onPress();

    cancelRowGesture(rowId);
  }

  function hitRowGesture(rowId: string, targets: KeyHitTarget[]) {
    return {
      gesture: DragGesture({
        minDistance: 0,
        coordinateSpace: "local",
      })
        .onChanged((details: any) =>
          handleHitRowGestureChanged(rowId, details, targets),
        )
        .onEnded((details: any) =>
          handleHitRowGestureEnded(rowId, details, targets),
        ),
      mask: "gesture" as any,
    };
  }

  function processKey(keyCode: number, fallback?: string) {
    const s = sessionRef.current;
    if (!s) {
      if (fallback) CustomKeyboard.insertText(fallback);
      return;
    }
    const consumed = s.processKey(keyCode);
    refresh(s);
    if (!consumed && fallback) CustomKeyboard.insertText(fallback);
  }

  function processKeyWithModifiers(keyCode: number, modifiers: number) {
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
    if (text) CustomKeyboard.insertText(text);
  }

  function processText(text: string) {
    if (!text) return;
    if (processRimeKeySpec(text)) return;
    if (text === "\t") {
      processKey(KEY_TAB, "\t");
      return;
    }
    for (const ch of text) processKey(ch.charCodeAt(0), ch);
  }

  function pressLetter(ch: string) {
    const typed = shifted || capsLocked ? ch.toUpperCase() : ch;
    if (ascii) {
      CustomKeyboard.insertText(typed);
      if (shifted && !capsLocked) setShifted(false);
      return;
    }
    processKey(typed.charCodeAt(0), typed);
    if (backslashWrapMode) setBackslashWrapMode(false);
    if (shifted && !capsLocked) setShifted(false);
  }

  function pressUppercaseLetter(ch: string) {
    const typed = ch.toUpperCase();
    if (ascii) {
      CustomKeyboard.insertText(typed);
      return;
    }
    processKey(typed.charCodeAt(0), typed);
    if (backslashWrapMode) setBackslashWrapMode(false);
  }

  function pressSymbol(text: string) {
    if (ascii || preedit.length === 0) {
      CustomKeyboard.insertText(text);
      return;
    }
    processText(text);
  }

  function pressNumericDot() {
    if (!ascii && preedit.length > 0) {
      processText(".");
      return;
    }
    CustomKeyboard.insertText(".");
  }

  function pressRimePunctuation(text: string) {
    if (ascii) CustomKeyboard.insertText(text);
    else processText(text);
  }

  function pressBackspace() {
    const s = sessionRef.current;
    if (s && (s.context?.preedit?.length ?? 0) > 0) {
      s.processKey(KEY_BACKSPACE);
      refresh(s);
    } else {
      const before = CustomKeyboard.textBeforeCursor ?? "";
      deletedTextRef.current = before.slice(-1) || deletedTextRef.current;
      CustomKeyboard.deleteBackward();
    }
  }

  function stopRepeatingBackspace() {
    if (repeatingDeleteTimerRef.current == null) return;
    clearTimeout(repeatingDeleteTimerRef.current);
    repeatingDeleteTimerRef.current = null;
  }

  function startRepeatingBackspace() {
    stopRepeatingBackspace();
    lastDeleteClickAtRef.current = 0;
    lastDeleteHapticAtRef.current = 0;
    pressBackspace();
    playRepeatingDeleteFeedback();
    const repeat = () => {
      pressBackspace();
      playRepeatingDeleteFeedback();
      repeatingDeleteTimerRef.current = setTimeout(repeat, 82);
    };
    repeatingDeleteTimerRef.current = setTimeout(repeat, 82);
  }

  function clearComposition() {
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
    }));
    setCandidateExpanded(false);
    setBackslashWrapMode(false);
    try {
      CustomKeyboard.setMarkedText("", 0, 0);
      CustomKeyboard.unmarkText();
    } catch {}
  }

  function pressSpace() {
    const s = sessionRef.current;
    if (ascii) {
      CustomKeyboard.insertText(" ");
      return;
    }
    if (s && (s.context?.preedit?.length ?? 0) > 0) {
      s.processKey(KEY_SPACE);
      refresh(s);
    } else {
      CustomKeyboard.insertText(" ");
    }
  }

  function pressReturn() {
    const s = sessionRef.current;
    if (s && (s.context?.preedit?.length ?? 0) > 0) {
      s.processKey(KEY_RETURN);
      refresh(s);
    } else {
      CustomKeyboard.insertText("\n");
    }
  }

  function insertNewline() {
    CustomKeyboard.insertText("\n");
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

  function processSpaceSwipeCandidate(numberKey: "2" | "3") {
    if (preedit) {
      if (selectCandidateByKey(numberKey)) return;
      processKey(numberKey.charCodeAt(0), numberKey);
      return;
    }
    selectCandidateOnPage(numberKey === "2" ? 1 : 2);
  }

  function pressNumericDigit(value: string) {
    if (preedit && selectCandidateByKey(value)) return;
    pressSymbol(value);
  }

  function commitComposition() {
    const s = sessionRef.current;
    if (!s) return;
    const result = s.commitComposition();
    if (result?.text) CustomKeyboard.insertText(result.text);
    void s.commit;
    refresh(s);
  }

  async function pasteText() {
    try {
      const text = await Pasteboard.getString();
      if (text) CustomKeyboard.insertText(text);
    } catch {}
  }

  async function copySelectedText() {
    try {
      if (CustomKeyboard.selectedText) {
        await Pasteboard.setString(CustomKeyboard.selectedText);
      }
    } catch {}
  }

  async function cutSelectedText() {
    try {
      if (!CustomKeyboard.selectedText) return;
      await Pasteboard.setString(CustomKeyboard.selectedText);
      CustomKeyboard.deleteBackward();
    } catch {}
  }

  async function selectAllBestEffort() {
    try {
      const keyboard = CustomKeyboard as any;
      if (typeof keyboard.selectAll === "function") {
        keyboard.selectAll();
        return;
      }
      if (typeof keyboard.setSelectionRange === "function") {
        keyboard.setSelectionRange(0, CustomKeyboard.allText?.length ?? 0);
        return;
      }
      if (typeof keyboard.selectText === "function") {
        keyboard.selectText(0, CustomKeyboard.allText?.length ?? 0);
        return;
      }
      const text = CustomKeyboard.allText;
      if (text) await Pasteboard.setString(text);
    } catch {}
  }

  function deleteAllText() {
    try {
      const text = CustomKeyboard.allText ?? "";
      if (!text) return;
      deletedTextRef.current = text;
      const after = CustomKeyboard.textAfterCursor?.length ?? 0;
      if (after > 0) CustomKeyboard.moveCursor(after);
      for (let i = 0; i < text.length; i += 1) CustomKeyboard.deleteBackward();
    } catch {}
  }

  function restoreDeletedText() {
    if (!deletedTextRef.current) return;
    CustomKeyboard.insertText(deletedTextRef.current);
  }

  function runConfiguredAction(action: string, mode: ActionSendMode = "auto") {
    if (!action) return;
    if (mode === "direct") {
      insertConfiguredText(action);
      return;
    }
    if (mode === "rime") {
      processText(action);
      if (
        action === "{backslash}" ||
        action === "backslash" ||
        action === "\\"
      ) {
        setBackslashWrapMode(true);
      }
      return;
    }
    switch (action) {
      case "":
        return;
      case "{left}":
        CustomKeyboard.moveCursor(-1);
        return;
      case "{right}":
        CustomKeyboard.moveCursor(1);
        return;
      case "{home}":
        CustomKeyboard.moveCursor(
          -(CustomKeyboard.textBeforeCursor?.length ?? 0),
        );
        return;
      case "{end}":
        CustomKeyboard.moveCursor(CustomKeyboard.textAfterCursor?.length ?? 0);
        return;
      case "{selectAll}":
        void selectAllBestEffort();
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
      case "{backslash}":
      case "backslash":
      case "\\":
        processText("\\");
        setBackslashWrapMode(true);
        return;
      default:
        if (processRimeKeySpec(action)) return;
        processText(action);
    }
  }

  function runLetterSwipe(direction: "up" | "down", key: string) {
    const actions =
      direction === "up" ? settings.letterSwipeUp : settings.letterSwipeDown;
    const modes =
      direction === "up"
        ? settings.letterSwipeUpModes
        : settings.letterSwipeDownModes;
    const action = actions[key];
    if (preedit && modes[key] !== "direct" && /^[0-9]$/.test(action)) {
      if (selectCandidateByKey(action)) return;
    }
    runConfiguredAction(action, modes[key]);
  }

  function runIdleFunctionSwipe(direction: "up" | "down", key: string) {
    const actions =
      direction === "up"
        ? settings.idleFunctionSwipeUp
        : settings.idleFunctionSwipeDown;
    const modes =
      direction === "up"
        ? settings.idleFunctionSwipeUpModes
        : settings.idleFunctionSwipeDownModes;
    runConfiguredAction(actions[key], modes[key]);
  }

  function runComposingFunctionSwipe(direction: "up" | "down", key: string) {
    const actions =
      direction === "up"
        ? settings.composingFunctionSwipeUp
        : settings.composingFunctionSwipeDown;
    const modes =
      direction === "up"
        ? settings.composingFunctionSwipeUpModes
        : settings.composingFunctionSwipeDownModes;
    runConfiguredAction(actions[key], modes[key]);
  }

  function pressBackslashFilter() {
    processText("\\");
    setBackslashWrapMode(true);
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
  const schemaMenu =
    schemas.length > 1 ? (
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
    ) : null;
  const showsPreeditCaret =
    !error &&
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
    : metrics.candidateBarHeight + PREEDIT_ROW_HEIGHT + 2;
  const effectiveCandidateRightButtonMode =
    settings.candidateRightButtonMode === "expand" && candidates.length === 0
      ? "dismiss"
      : settings.candidateRightButtonMode;
  const candidateHomeButtonVisible = !composing;
  const candidateHomeButtonWidth = 42;
  const candidateSettingsButtonWidth = candidateHomeButtonVisible ? 42 : 0;
  const candidateRightButtonVisible =
    effectiveCandidateRightButtonMode !== "hidden";
  const candidateRightButtonWidth = candidateRightButtonVisible ? 42 : 0;
  const candidateFixedButtonWidth =
    (candidateHomeButtonVisible ? candidateHomeButtonWidth : 0) +
    candidateSettingsButtonWidth +
    candidateRightButtonWidth;
  const candidateFixedButtonCount =
    (candidateHomeButtonVisible ? 1 : 0) +
    (candidateSettingsButtonWidth > 0 ? 1 : 0) +
    (candidateRightButtonVisible ? 1 : 0);
  const candidateFixedButtonGaps = KEY_SPACING * candidateFixedButtonCount;
  const candidateBarWidth =
    metrics.width - candidateFixedButtonWidth - candidateFixedButtonGaps;
  const candidateRightButtonImage =
    effectiveCandidateRightButtonMode === "expand"
      ? candidateExpanded
        ? "chevron.up.circle"
        : "chevron.down.circle"
      : "keyboard.chevron.compact.down";
  const normalKeyboardBodyHeight =
    (settings.showFunctionRow ? metrics.functionKeyHeight + 6 : 0) +
    metrics.keyHeight * 4 +
    6 * 3;
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

  function letterRowHitTargets(
    row: string[],
    rowIndex: number,
  ): KeyHitTarget[] {
    const targets: KeyHitTarget[] = [];
    let x = rowIndex === 1 ? metrics.secondRowInset : 0;
    if (rowIndex === 2) {
      targets.push({
        id: "shift",
        x,
        width: metrics.shiftWidth,
        onPress: pressShift,
        onSwipeUp: shiftSwipeUp,
      });
      x += metrics.shiftWidth + KEY_SPACING;
    }
    for (const ch of row) {
      targets.push({
        id: ch,
        x,
        width: metrics.letterWidth,
        onPress: () => pressLetter(ch),
        onLongPress: () => pressUppercaseLetter(ch),
        longPressDuration: settings.letterLongPressDuration,
        onSwipeUp: () => runLetterSwipe("up", ch),
        onSwipeDown: () => runLetterSwipe("down", ch),
      });
      x += metrics.letterWidth + KEY_SPACING;
    }
    if (rowIndex === 2) {
      targets.push({
        id: "backspace",
        x,
        width: metrics.shiftWidth,
        onPress: pressBackspace,
        onLongPress: startRepeatingBackspace,
        onLongPressEnd: stopRepeatingBackspace,
        onSwipeLeft: clearComposition,
        onSwipeUp: deleteAllText,
        onSwipeDown: restoreDeletedText,
      });
    }
    return targets;
  }

  function composingFunctionHitTargets(): KeyHitTarget[] {
    const step = metrics.functionWidth8 + KEY_SPACING;
    return [
      {
        id: "func-left",
        x: 0,
        width: metrics.functionWidth8,
        onPress: () => processKey(KEY_UP),
        onSwipeUp: () => runComposingFunctionSwipe("up", "left"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "left"),
      },
      {
        id: "func-page-down",
        x: step,
        width: metrics.functionWidth8,
        onPress: () => processKey(KEY_PAGE_DOWN),
        onSwipeUp: () => runComposingFunctionSwipe("up", "page"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "page"),
      },
      {
        id: "tone-1",
        x: step * 2,
        width: metrics.functionWidth8,
        onPress: () => processText("7"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone1"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone1"),
      },
      {
        id: "tone-2",
        x: step * 3,
        width: metrics.functionWidth8,
        onPress: () => processText("8"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone2"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone2"),
      },
      {
        id: "tone-3",
        x: step * 4,
        width: metrics.functionWidth8,
        onPress: () => processText("9"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone3"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone3"),
      },
      {
        id: "tone-4",
        x: step * 5,
        width: metrics.functionWidth8,
        onPress: () => processText("0"),
        onSwipeUp: () => runComposingFunctionSwipe("up", "tone4"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "tone4"),
      },
      {
        id: "func-backslash",
        x: step * 6,
        width: metrics.functionWidth8,
        onPress: pressBackslashFilter,
        onSwipeUp: () => runComposingFunctionSwipe("up", "filter"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "filter"),
      },
      {
        id: "func-right",
        x: step * 7,
        width: metrics.functionWidth8,
        onPress: () => processKey(KEY_DOWN),
        onSwipeUp: () => runComposingFunctionSwipe("up", "right"),
        onSwipeDown: () => runComposingFunctionSwipe("down", "right"),
      },
    ];
  }

  function idleFunctionHitTargets(): KeyHitTarget[] {
    const step = metrics.functionWidth8 + KEY_SPACING;
    return [
      {
        id: "idle-left",
        x: 0,
        width: metrics.functionWidth8,
        onPress: () => CustomKeyboard.moveCursor(-1),
        onSwipeUp: () => runIdleFunctionSwipe("up", "left"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "left"),
      },
      {
        id: "idle-head",
        x: step,
        width: metrics.functionWidth8,
        onPress: () =>
          CustomKeyboard.moveCursor(
            -(CustomKeyboard.textBeforeCursor?.length ?? 0),
          ),
        onSwipeUp: () => runIdleFunctionSwipe("up", "head"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "head"),
      },
      {
        id: "idle-schema",
        x: step * 2,
        width: metrics.functionWidth8,
        onPress: openRimeSchemaMenu,
        onSwipeUp: () => runIdleFunctionSwipe("up", "select"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "select"),
      },
      {
        id: "idle-cut",
        x: step * 3,
        width: metrics.functionWidth8,
        onPress: () => void cutSelectedText(),
        onSwipeUp: () => runIdleFunctionSwipe("up", "cut"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "cut"),
      },
      {
        id: "idle-copy",
        x: step * 4,
        width: metrics.functionWidth8,
        onPress: () => void copySelectedText(),
        onSwipeUp: () => runIdleFunctionSwipe("up", "copy"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "copy"),
      },
      {
        id: "idle-paste",
        x: step * 5,
        width: metrics.functionWidth8,
        onPress: () => void pasteText(),
        onSwipeUp: () => runIdleFunctionSwipe("up", "paste"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "paste"),
      },
      {
        id: "idle-tail",
        x: step * 6,
        width: metrics.functionWidth8,
        onPress: () =>
          CustomKeyboard.moveCursor(
            CustomKeyboard.textAfterCursor?.length ?? 0,
          ),
        onSwipeUp: () => runIdleFunctionSwipe("up", "tail"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "tail"),
      },
      {
        id: "idle-right",
        x: step * 7,
        width: metrics.functionWidth8,
        onPress: () => CustomKeyboard.moveCursor(1),
        onSwipeUp: () => runIdleFunctionSwipe("up", "right"),
        onSwipeDown: () => runIdleFunctionSwipe("down", "right"),
      },
    ];
  }

  function bottomRowHitTargets(): KeyHitTarget[] {
    let x = 0;
    const targets: KeyHitTarget[] = [
      {
        id: "numbers",
        x,
        width: metrics.bottom.numbers,
        onPress: () => setSymbolLayer((value) => !value),
        onSwipeUp: () => pressSymbol("`"),
      },
    ];
    x += metrics.bottom.numbers + KEY_SPACING;
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
      onSwipeUp: () => processSpaceSwipeCandidate("2"),
      onSwipeDown: () => processSpaceSwipeCandidate("3"),
      onSwipeLeft: () => CustomKeyboard.moveCursor(-1),
      onSwipeRight: () => CustomKeyboard.moveCursor(1),
    });
    x += metrics.bottom.space + KEY_SPACING;
    targets.push({
      id: "mode",
      x,
      width: metrics.bottom.mode,
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
      onSwipeUp: () => {
        if (composing && settings.modeComposingEnabled) {
          runConfiguredAction(
            settings.modeComposingSwipeUp,
            settings.modeComposingSwipeUpMode,
          );
        }
      },
      onSwipeDown: () => {
        if (composing && settings.modeComposingEnabled) {
          runConfiguredAction(
            settings.modeComposingSwipeDown,
            settings.modeComposingSwipeDownMode,
          );
        }
      },
    });
    x += metrics.bottom.mode + KEY_SPACING;
    targets.push({
      id: "enter",
      x,
      width: metrics.bottom.enter,
      onPress: pressReturn,
      onSwipeUp: insertNewline,
    });
    return targets;
  }

  function numericRowHitTargets(row: string[]): KeyHitTarget[] {
    return row.map((value, index) => ({
      id:
        value === "ABC"
          ? "numeric-abc"
          : value === "space"
            ? "numeric-space"
            : `numeric-${value}`,
      x: index * (numericKeyWidth + KEY_SPACING),
      width: numericKeyWidth,
      onPress: () => {
        if (value === "ABC") setSymbolLayer(false);
        else if (value === "space") pressSpace();
        else pressNumericDigit(value);
      },
    }));
  }

  function numericRightHitTargets(): KeyHitTarget[] {
    return [
      {
        id: "numeric-backspace",
        x: 0,
        y: 0,
        width: numericRightWidth,
        height: metrics.keyHeight,
        onPress: pressBackspace,
        onLongPress: startRepeatingBackspace,
        onLongPressEnd: stopRepeatingBackspace,
        onSwipeLeft: clearComposition,
        onSwipeUp: deleteAllText,
        onSwipeDown: restoreDeletedText,
      },
      {
        id: "numeric-dot",
        x: 0,
        y: metrics.keyHeight + numericRowSpacing,
        width: numericRightWidth,
        height: metrics.keyHeight,
        onPress: pressNumericDot,
      },
      {
        id: "numeric-equal",
        x: 0,
        y: (metrics.keyHeight + numericRowSpacing) * 2,
        width: numericRightWidth,
        height: metrics.keyHeight,
        onPress: () => pressSymbol("="),
        onSwipeUp: () =>
          runConfiguredAction(settings.numericEqualsSwipeUp, "rime"),
      },
      {
        id: "numeric-enter",
        x: 0,
        y: (metrics.keyHeight + numericRowSpacing) * 3,
        width: numericRightWidth,
        height: metrics.keyHeight,
        onPress: pressReturn,
        onSwipeUp: insertNewline,
      },
    ];
  }

  function pressCandidateRightButton() {
    if (effectiveCandidateRightButtonMode === "expand") {
      setCandidateExpanded((value) => !value);
    } else if (effectiveCandidateRightButtonMode === "dismiss") {
      CustomKeyboard.dismiss();
    }
  }

  function pressCandidateHomeButton() {
    CustomKeyboard.dismissToHome();
  }

  function pressCandidateSettingsButton() {
    const url = Script.createRunURLScheme(Script.name, {
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
  const numericLeftWidth = Math.max(48, Math.min(56, metrics.width * 0.14));
  const numericRightWidth = Math.max(58, Math.min(72, metrics.width * 0.18));
  const numericCenterWidth =
    metrics.width - numericLeftWidth - numericRightWidth - KEY_SPACING * 2;
  const numericKeyWidth = (numericCenterWidth - KEY_SPACING * 2) / 3;

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
        {showsPreeditRow ? (
          <HStack
            spacing={1}
            padding={{ leading: 8 }}
            frame={{
              width: metrics.width,
              height: 18,
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
            {showsPreeditCaret ? (
              <Text
                font="caption2"
                baselineOffset={-7}
                foregroundStyle={palette.primary as any}
                padding={{ bottom: -2 }}
              >
                ^
              </Text>
            ) : null}
            {preeditAfterCaret ? (
              <Text
                font="caption"
                lineLimit={1}
                foregroundStyle={palette.primary as any}
              >
                {preeditAfterCaret}
              </Text>
            ) : null}
          </HStack>
        ) : null}
        <HStack
          spacing={KEY_SPACING}
          frame={{ width: metrics.width, height: metrics.candidateBarHeight }}
        >
          {candidateHomeButtonVisible ? (
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
          ) : null}
          {candidateHomeButtonVisible ? (
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
          ) : null}
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
                  selected={idx === highlightedIdx}
                  palette={palette}
                  height={metrics.candidateButtonHeight}
                  candidateFontSize={metrics.candidateFontSize}
                  commentFontSize={metrics.candidateCommentFontSize}
                  onPress={() =>
                    runWithFeedback(() =>
                      selectCandidateAbsolute(pageNo * rimePageSize + idx),
                    )
                  }
                />
              ))}
            </HStack>
          </ScrollView>
          {candidateRightButtonVisible ? (
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
          ) : null}
        </HStack>
      </VStack>

      {candidateExpanded ? (
        <ScrollView
          axes="vertical"
          scrollIndicator="hidden"
          frame={{ width: metrics.width, height: expandedPanelHeight }}
          background={"rgba(0,0,0,0.001)" as any}
          contentShape="rect"
        >
          <VStack
            spacing={KEY_SPACING}
            frame={{
              width: metrics.width,
              minHeight: expandedPanelHeight,
              alignment: "top" as any,
            }}
            background={"rgba(0,0,0,0.001)" as any}
            contentShape="rect"
          >
            <FlowLayout
              spacing={KEY_SPACING}
              frame={{ width: metrics.width, alignment: "leading" as any }}
            >
              {candidates.map((candidate, absoluteIndex) => {
                const comment = candidateComment(candidate);
                const naturalWidth = candidateButtonNaturalWidth({
                  text: candidate.text,
                  comment,
                  index: absoluteIndex,
                  candidateFontSize: metrics.candidateFontSize,
                  commentFontSize: metrics.candidateCommentFontSize,
                  expanded: true,
                });
                const width =
                  naturalWidth > metrics.width ? metrics.width : undefined;
                return (
                  <CandidateButton
                    key={`expanded-${absoluteIndex}-${candidate.text}`}
                    index={absoluteIndex}
                    candidate={candidate}
                    comment={comment}
                    selected={absoluteIndex === highlightedIdx}
                    palette={palette}
                    width={width}
                    naturalWidth={naturalWidth}
                    height={Math.max(52, metrics.candidateButtonHeight + 12)}
                    candidateFontSize={metrics.candidateFontSize}
                    commentFontSize={metrics.candidateCommentFontSize}
                    expanded
                    onPress={() =>
                      runWithFeedback(() => {
                        selectCandidateAbsolute(
                          pageNo * rimePageSize + absoluteIndex,
                        );
                        setCandidateExpanded(false);
                      })
                    }
                  />
                );
              })}
            </FlowLayout>
          </VStack>
        </ScrollView>
      ) : (
        <Group>
          {settings.showFunctionRow ? (
            composing ? (
              <HStack
                spacing={KEY_SPACING}
                frame={{
                  width: metrics.width,
                  height: metrics.functionKeyHeight,
                }}
                contentShape="rect"
                highPriorityGesture={hitRowGesture(
                  "func-comp",
                  composingFunctionHitTargets(),
                )}
              >
                <KeyFace
                  id="func-left"
                  image="arrow.left"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "func-left"}
                  onPress={() => runWithFeedback(() => processKey(KEY_UP))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "left"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "left"),
                    )
                  }
                />
                <KeyFace
                  id="func-page-down"
                  image="arrow.up.arrow.down"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "func-page-down"}
                  onPress={() =>
                    runWithFeedback(() => processKey(KEY_PAGE_DOWN))
                  }
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "page"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "page"),
                    )
                  }
                />
                <KeyFace
                  id="tone-1"
                  image="1.circle"
                  imageScale="medium"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "tone-1"}
                  onPress={() => runWithFeedback(() => processText("7"))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "tone1"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "tone1"),
                    )
                  }
                />
                <KeyFace
                  id="tone-2"
                  image="2.circle"
                  imageScale="medium"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "tone-2"}
                  onPress={() => runWithFeedback(() => processText("8"))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "tone2"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "tone2"),
                    )
                  }
                />
                <KeyFace
                  id="tone-3"
                  image="3.circle"
                  imageScale="medium"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "tone-3"}
                  onPress={() => runWithFeedback(() => processText("9"))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "tone3"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "tone3"),
                    )
                  }
                />
                <KeyFace
                  id="tone-4"
                  image="4.circle"
                  imageScale="medium"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "tone-4"}
                  onPress={() => runWithFeedback(() => processText("0"))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "tone4"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "tone4"),
                    )
                  }
                />
                <KeyFace
                  id="func-backslash"
                  image="viewfinder"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "func-backslash"}
                  onPress={() => runWithFeedback(pressBackslashFilter)}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "filter"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "filter"),
                    )
                  }
                />
                <KeyFace
                  id="func-right"
                  image="arrow.right"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "func-right"}
                  onPress={() => runWithFeedback(() => processKey(KEY_DOWN))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("up", "right"),
                    )
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runComposingFunctionSwipe("down", "right"),
                    )
                  }
                />
              </HStack>
            ) : (
              <HStack
                spacing={KEY_SPACING}
                frame={{
                  width: metrics.width,
                  height: metrics.functionKeyHeight,
                }}
                contentShape="rect"
                highPriorityGesture={hitRowGesture(
                  "func-idle",
                  idleFunctionHitTargets(),
                )}
              >
                <KeyFace
                  id="idle-left"
                  image="arrow.left"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-left"}
                  onPress={() =>
                    runWithFeedback(() => CustomKeyboard.moveCursor(-1))
                  }
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "left"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "left"))
                  }
                />
                <KeyFace
                  id="idle-head"
                  image="text.line.first.and.arrowtriangle.forward"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-head"}
                  onPress={() =>
                    runWithFeedback(() =>
                      CustomKeyboard.moveCursor(
                        -(CustomKeyboard.textBeforeCursor?.length ?? 0),
                      ),
                    )
                  }
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "head"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "head"))
                  }
                />
                <KeyFace
                  id="idle-schema"
                  image="list.bullet.rectangle"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-schema"}
                  onPress={() => runWithFeedback(openRimeSchemaMenu)}
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "select"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() =>
                      runIdleFunctionSwipe("down", "select"),
                    )
                  }
                  contextMenu={
                    schemaMenu != null ? { menuItems: schemaMenu } : undefined
                  }
                />
                <KeyFace
                  id="idle-cut"
                  image="scissors"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-cut"}
                  onPress={() => runWithFeedback(() => void cutSelectedText())}
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "cut"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "cut"))
                  }
                />
                <KeyFace
                  id="idle-copy"
                  image="doc.on.doc"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-copy"}
                  onPress={() => runWithFeedback(() => void copySelectedText())}
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "copy"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "copy"))
                  }
                />
                <KeyFace
                  id="idle-paste"
                  image="doc.on.clipboard"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-paste"}
                  onPress={() => runWithFeedback(() => void pasteText())}
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "paste"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "paste"))
                  }
                />
                <KeyFace
                  id="idle-tail"
                  image="text.line.last.and.arrowtriangle.forward"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-tail"}
                  onPress={() =>
                    runWithFeedback(() =>
                      CustomKeyboard.moveCursor(
                        CustomKeyboard.textAfterCursor?.length ?? 0,
                      ),
                    )
                  }
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "tail"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "tail"))
                  }
                />
                <KeyFace
                  id="idle-right"
                  image="arrow.right"
                  palette={palette}
                  width={metrics.functionWidth8}
                  height={metrics.functionKeyHeight}
                  system
                  passive
                  active={pressedKeyId === "idle-right"}
                  onPress={() =>
                    runWithFeedback(() => CustomKeyboard.moveCursor(1))
                  }
                  onSwipeUp={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("up", "right"))
                  }
                  onSwipeDown={() =>
                    runWithFeedback(() => runIdleFunctionSwipe("down", "right"))
                  }
                />
              </HStack>
            )
          ) : null}

          {symbolLayer ? (
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
                          runWithFeedback(() => pressSymbol(item.value))
                        }
                      >
                        {item.label}
                      </Text>
                    ))}
                  </VStack>
                </ScrollView>
              </VStack>

              <VStack
                spacing={numericRowSpacing}
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
                  return (
                    <HStack
                      key={`numeric-row-${rowIndex}`}
                      spacing={KEY_SPACING}
                      frame={{
                        width: numericCenterWidth,
                        height: metrics.keyHeight,
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
                          labelFontSize={24}
                          passive
                          active={pressedKeyId === `numeric-${value}`}
                          onPress={() =>
                            runWithFeedback(() => pressNumericDigit(value))
                          }
                        />
                      ))}
                    </HStack>
                  );
                })}
                <HStack
                  spacing={KEY_SPACING}
                  frame={{
                    width: numericCenterWidth,
                    height: metrics.keyHeight,
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
                    system
                    labelFontSize={16}
                    passive
                    active={pressedKeyId === "numeric-abc"}
                    onPress={() => runWithFeedback(() => setSymbolLayer(false))}
                  />
                  <KeyFace
                    id="numeric-0"
                    label="0"
                    palette={palette}
                    width={numericKeyWidth}
                    height={metrics.keyHeight}
                    labelFontSize={24}
                    passive
                    active={pressedKeyId === "numeric-0"}
                    onPress={() =>
                      runWithFeedback(() => pressNumericDigit("0"))
                    }
                  />
                  <KeyFace
                    id="numeric-space"
                    image="space"
                    palette={palette}
                    width={numericKeyWidth}
                    height={metrics.keyHeight}
                    system
                    passive
                    active={pressedKeyId === "numeric-space"}
                    onPress={() => runWithFeedback(pressSpace)}
                  />
                </HStack>
              </VStack>

              <VStack
                spacing={numericRowSpacing}
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
                  system
                  passive
                  active={pressedKeyId === "numeric-backspace"}
                  onPress={() => runWithFeedback(pressBackspace)}
                  onSwipeLeft={() => runWithFeedback(clearComposition)}
                  onSwipeUp={() => runWithFeedback(deleteAllText)}
                  onSwipeDown={() => runWithFeedback(restoreDeletedText)}
                />
                <KeyFace
                  id="numeric-dot"
                  label="."
                  palette={palette}
                  width={numericRightWidth}
                  height={metrics.keyHeight}
                  passive
                  active={pressedKeyId === "numeric-dot"}
                  onPress={() => runWithFeedback(pressNumericDot)}
                />
                <KeyFace
                  id="numeric-equal"
                  label="="
                  palette={palette}
                  width={numericRightWidth}
                  height={metrics.keyHeight}
                  passive
                  active={pressedKeyId === "numeric-equal"}
                  onPress={() => runWithFeedback(() => pressSymbol("="))}
                  onSwipeUp={() =>
                    runWithFeedback(() =>
                      runConfiguredAction(
                        settings.numericEqualsSwipeUp,
                        "rime",
                      ),
                    )
                  }
                />
                <KeyFace
                  id="numeric-enter"
                  image="paperplane.fill"
                  palette={palette}
                  width={numericRightWidth}
                  height={metrics.keyHeight}
                  system
                  passive
                  active={pressedKeyId === "numeric-enter"}
                  onPress={() => runWithFeedback(pressReturn)}
                  onSwipeUp={() => runWithFeedback(insertNewline)}
                />
              </VStack>
            </HStack>
          ) : (
            LETTER_ROWS.map((row, rowIndex) => {
              const hitTargets = letterRowHitTargets(row, rowIndex);
              return (
                <HStack
                  key={`row-${rowIndex}`}
                  spacing={KEY_SPACING}
                  frame={{ width: metrics.width, height: metrics.keyHeight }}
                  contentShape="rect"
                  highPriorityGesture={hitRowGesture(
                    `main-row-${rowIndex}`,
                    hitTargets,
                  )}
                >
                  {rowIndex === 1 ? (
                    <VStack frame={{ width: metrics.secondRowInset }} />
                  ) : null}
                  {rowIndex === 2 ? (
                    <KeyFace
                      id="shift"
                      image={
                        composing && settings.shiftComposingEnabled
                          ? settings.shiftComposingIcon
                          : capsLocked
                            ? "capslock.fill"
                            : shifted
                              ? "shift.fill"
                              : "shift"
                      }
                      palette={palette}
                      width={metrics.shiftWidth}
                      height={metrics.keyHeight}
                      system
                      passive
                      selected={shifted || capsLocked}
                      active={pressedKeyId === "shift"}
                      onPress={() => runWithFeedback(pressShift)}
                      onSwipeUp={() => runWithFeedback(shiftSwipeUp)}
                    />
                  ) : null}
                  {row.map((ch) => (
                    <KeyFace
                      key={ch}
                      id={ch}
                      label={
                        backslashWrapMode
                          ? BACKSLASH_SYMBOLS[ch]
                          : shifted || capsLocked
                            ? ch.toUpperCase()
                            : ch
                      }
                      labelFontSize={
                        backslashWrapMode
                          ? BACKSLASH_SYMBOLS[ch].length > 2
                            ? 16
                            : 22
                          : shifted || capsLocked
                            ? 24
                            : 27
                      }
                      topLeft={
                        !backslashWrapMode &&
                        settings.showHintSymbols &&
                        !settings.letterSwipeUpSymbols[ch]
                          ? settings.letterSwipeUp[ch]
                          : undefined
                      }
                      topLeftImage={
                        !backslashWrapMode && settings.showHintSymbols
                          ? settings.letterSwipeUpSymbols[ch] || undefined
                          : undefined
                      }
                      topRight={
                        !backslashWrapMode &&
                        settings.showHintSymbols &&
                        !settings.letterSwipeDownSymbols[ch]
                          ? settings.letterSwipeDown[ch]
                          : undefined
                      }
                      topRightImage={
                        !backslashWrapMode && settings.showHintSymbols
                          ? settings.letterSwipeDownSymbols[ch] || undefined
                          : undefined
                      }
                      palette={palette}
                      width={metrics.letterWidth}
                      height={metrics.keyHeight}
                      passive
                      active={pressedKeyId === ch}
                      onPress={() => runWithFeedback(() => pressLetter(ch))}
                      onSwipeUp={() =>
                        runWithFeedback(() => runLetterSwipe("up", ch))
                      }
                      onSwipeDown={() =>
                        runWithFeedback(() => runLetterSwipe("down", ch))
                      }
                    />
                  ))}
                  {rowIndex === 2 ? (
                    <KeyFace
                      id="backspace"
                      image="delete.left"
                      palette={palette}
                      width={metrics.shiftWidth}
                      height={metrics.keyHeight}
                      system
                      passive
                      active={pressedKeyId === "backspace"}
                      onPress={() => runWithFeedback(pressBackspace)}
                      onSwipeLeft={() => runWithFeedback(clearComposition)}
                      onSwipeUp={() => runWithFeedback(deleteAllText)}
                      onSwipeDown={() => runWithFeedback(restoreDeletedText)}
                    />
                  ) : null}
                  {rowIndex === 1 ? (
                    <VStack frame={{ width: metrics.secondRowInset }} />
                  ) : null}
                </HStack>
              );
            })
          )}
        </Group>
      )}

      {candidateExpanded || symbolLayer ? null : (
        <HStack
          spacing={KEY_SPACING}
          frame={{ width: metrics.width, height: metrics.keyHeight }}
          contentShape="rect"
          highPriorityGesture={hitRowGesture(
            "bottom-row",
            bottomRowHitTargets(),
          )}
        >
          <KeyFace
            id="numbers"
            label={symbolLayer ? "ABC" : "123"}
            palette={palette}
            width={metrics.bottom.numbers}
            height={metrics.keyHeight}
            system
            selected={symbolLayer}
            passive
            active={pressedKeyId === "numbers"}
            onPress={() =>
              runWithFeedback(() => setSymbolLayer((value) => !value))
            }
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
            passive
            active={pressedKeyId === "comma"}
            onPress={() => runWithFeedback(() => pressRimePunctuation(","))}
            onSwipeUp={() => runWithFeedback(() => pressRimePunctuation("."))}
          />
          <KeyFace
            id="space"
            image="space"
            bottomRight={
              settings.showWanxiangLabel ? settings.spaceLabel : undefined
            }
            bottomRightFontSize={
              settings.spaceLabel.length > 4
                ? 8
                : settings.spaceLabel.length > 2
                  ? 10
                  : 12
            }
            palette={palette}
            width={metrics.bottom.space}
            height={metrics.keyHeight}
            system
            passive
            active={pressedKeyId === "space"}
            onPress={() => runWithFeedback(pressSpace)}
            onSwipeUp={() =>
              runWithFeedback(() => processSpaceSwipeCandidate("2"))
            }
            onSwipeDown={() =>
              runWithFeedback(() => processSpaceSwipeCandidate("3"))
            }
            onSwipeLeft={() =>
              runWithFeedback(() => CustomKeyboard.moveCursor(-1))
            }
            onSwipeRight={() =>
              runWithFeedback(() => CustomKeyboard.moveCursor(1))
            }
          />
          <KeyFace
            id="mode"
            image={
              composing && settings.modeComposingEnabled
                ? settings.modeComposingIcon
                : undefined
            }
            modeTopLeft={
              composing && settings.modeComposingEnabled ? undefined : "中"
            }
            modeBottomRight={
              composing && settings.modeComposingEnabled ? undefined : "英"
            }
            modeTopLeftActive={!ascii}
            palette={palette}
            width={metrics.bottom.mode}
            height={metrics.keyHeight}
            system
            passive
            active={pressedKeyId === "mode"}
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
              })
            }
            onSwipeUp={() =>
              runWithFeedback(() => {
                if (composing && settings.modeComposingEnabled) {
                  runConfiguredAction(
                    settings.modeComposingSwipeUp,
                    settings.modeComposingSwipeUpMode,
                  );
                }
              })
            }
            onSwipeDown={() =>
              runWithFeedback(() => {
                if (composing && settings.modeComposingEnabled) {
                  runConfiguredAction(
                    settings.modeComposingSwipeDown,
                    settings.modeComposingSwipeDownMode,
                  );
                }
              })
            }
            onLongPress={() => runWithFeedback(commitComposition)}
            contextMenu={
              schemaMenu != null ? { menuItems: schemaMenu } : undefined
            }
          />
          <KeyFace
            id="enter"
            image="paperplane.fill"
            palette={palette}
            width={metrics.bottom.enter}
            height={metrics.keyHeight}
            system
            passive
            active={pressedKeyId === "enter"}
            onPress={() => runWithFeedback(pressReturn)}
            onSwipeUp={() => runWithFeedback(insertNewline)}
          />
        </HStack>
      )}
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
