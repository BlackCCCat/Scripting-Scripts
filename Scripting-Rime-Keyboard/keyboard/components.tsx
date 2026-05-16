import {
  DragGesture,
  Group,
  HStack,
  Image,
  Spacer,
  Text,
  useEffect,
  useRef,
  VStack,
  ZStack,
} from "scripting";
import { BASE_KEY_HEIGHT } from "./constants";
import type { Palette } from "./types";
import { dragDirection, estimatedTextWidth } from "./utils";

export function candidateButtonNaturalWidth(params: {
  text: string;
  comment: string;
  index: number;
  candidateFontSize: number;
  commentFontSize: number;
  expanded?: boolean;
}) {
  const horizontalPadding = 7;
  const textWidth = estimatedTextWidth(
    params.text,
    params.candidateFontSize * (params.expanded ? 1.08 : 1),
    params.candidateFontSize * (params.expanded ? 0.68 : 0.54),
  );
  const commentLine = params.comment.length > 0
    ? `${params.index + 1} ${params.comment}`
    : `${params.index + 1}`;
  const commentWidth = estimatedTextWidth(
    commentLine,
    params.commentFontSize * (params.expanded ? 1.12 : 1),
    params.commentFontSize * (params.expanded ? 0.54 : 0.54),
  );
  const minWidth = params.expanded ? 54 : 42;
  return Math.max(minWidth, textWidth, commentWidth) + horizontalPadding * 2;
}

export function KeyFace(props: {
  id: string;
  label?: string;
  image?: string;
  topLeft?: string;
  topRight?: string;
  topLeftImage?: string;
  topRightImage?: string;
  topCenter?: string;
  topCenterForeground?: string;
  bottomRight?: string;
  modeTopLeft?: string;
  modeBottomRight?: string;
  modeTopLeftActive?: boolean;
  width?: number;
  height?: number;
  system?: boolean;
  accent?: boolean;
  selected?: boolean;
  active?: boolean;
  plain?: boolean;
  passive?: boolean;
  labelFontSize?: number;
  bottomRightFontSize?: number;
  foregroundStyle?: string;
  imageScale?: "small" | "medium" | "large";
  palette: Palette;
  onPress: () => void;
  onLongPress?: () => void;
  onLongPressEnd?: () => void;
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
  onLongPressMove?: (details: any) => void;
  longPressDuration?: number;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeStart?: () => void;
  swipeTriggerDistance?: number | (() => number);
  contextMenu?: any;
}) {
  const gestureStartedRef = useRef(false);
  const longPressHandledRef = useRef(false);
  const longPressCancelledRef = useRef(false);
  const longPressTimerRef = useRef<any>(null);
  const latestGestureRef = useRef<any>(null);
  const usesEnterColor = props.id === "enter" || props.id === "numeric-enter";
  const baseBg = props.palette.keyOverrides[props.id] ??
    (props.accent || usesEnterColor
      ? props.palette.enterBg
      : props.palette.keyBg);
  const bg = props.active && !props.plain ? "tertiarySystemFill" : baseBg;
  const fg = props.foregroundStyle ??
    (props.accent
      ? props.palette.accentText
      : (props.selected ? props.palette.accent : props.palette.primary));
  const width = props.width ?? 32;
  const hintPadding = width < 34 ? 5 : 7;
  const hintSlotWidth = Math.max(8, (width - hintPadding * 2) / 2);
  const hintFontSize = Math.max(7, Math.min(10, width * 0.3));
  const modeFontSize = Math.max(
    11,
    Math.min(16, (props.height ?? BASE_KEY_HEIGHT) * 0.32),
  );
  const modeInset = Math.max(
    4,
    Math.min(9, (props.height ?? BASE_KEY_HEIGHT) * 0.13),
  );
  const hasSwipe = !!(
    props.onSwipeUp || props.onSwipeDown || props.onSwipeLeft ||
    props.onSwipeRight
  );
  const needsManualGesture = !props.passive &&
    (hasSwipe || props.onLongPress || props.onTouchStart || props.onTouchEnd);

  function clearLongPressTimer() {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
  }

  function dragIntent(details: any) {
    const dx = Math.abs(Number(details?.translation?.width ?? 0));
    const dy = Math.abs(Number(details?.translation?.height ?? 0));
    const vx = Math.abs(Number(details?.velocity?.width ?? 0));
    const vy = Math.abs(Number(details?.velocity?.height ?? 0));
    return dx >= 4 || dy >= 4 || vx >= 8 || vy >= 8;
  }

  function resetGesture() {
    clearLongPressTimer();
    latestGestureRef.current = null;
    gestureStartedRef.current = false;
    longPressHandledRef.current = false;
    longPressCancelledRef.current = false;
  }

  useEffect(() => {
    return () => {
      const wasStarted = gestureStartedRef.current;
      const wasLongPress = longPressHandledRef.current;
      clearLongPressTimer();
      latestGestureRef.current = null;
      gestureStartedRef.current = false;
      longPressHandledRef.current = false;
      longPressCancelledRef.current = true;
      if (wasStarted) props.onTouchEnd?.();
      if (wasLongPress) props.onLongPressEnd?.();
    };
  }, []);

  function startGesture() {
    if (gestureStartedRef.current) return;
    gestureStartedRef.current = true;
    longPressHandledRef.current = false;
    longPressCancelledRef.current = false;
    props.onTouchStart?.();
    if (!props.onLongPress) return;
    longPressTimerRef.current = setTimeout(() => {
      if (!gestureStartedRef.current || longPressCancelledRef.current) return;
      if (latestGestureRef.current && dragIntent(latestGestureRef.current)) {
        longPressCancelledRef.current = true;
        return;
      }
      longPressHandledRef.current = true;
      props.onLongPress?.();
    }, props.longPressDuration ?? 360);
  }

  const manualGesture = needsManualGesture
    ? {
      gesture: DragGesture({ minDistance: 0, coordinateSpace: "local" })
        .onChanged((details: any) => {
          latestGestureRef.current = details;
          startGesture();
          if (longPressHandledRef.current) {
            props.onLongPressMove?.(details);
            return;
          }
          if (props.onLongPress && dragIntent(details)) {
            longPressCancelledRef.current = true;
            clearLongPressTimer();
          }
        })
        .onEnded((details: any) => {
          latestGestureRef.current = details;
          const wasLongPress = longPressHandledRef.current;
          clearLongPressTimer();
          if (wasLongPress) {
            props.onTouchEnd?.();
            props.onLongPressEnd?.();
            resetGesture();
            return;
          }
          const swipeTriggerDistance =
            typeof props.swipeTriggerDistance === "function"
              ? props.swipeTriggerDistance()
              : props.swipeTriggerDistance;
          const direction = dragDirection(details, swipeTriggerDistance);
          const hasSwipeAction = (direction === "up" && props.onSwipeUp) ||
            (direction === "down" && props.onSwipeDown) ||
            (direction === "left" && props.onSwipeLeft) ||
            (direction === "right" && props.onSwipeRight);
          if (hasSwipeAction) props.onSwipeStart?.();
          props.onTouchEnd?.();
          if (direction === "up" && props.onSwipeUp) props.onSwipeUp();
          else if (direction === "down" && props.onSwipeDown) {
            props.onSwipeDown();
          } else if (direction === "left" && props.onSwipeLeft) {
            props.onSwipeLeft();
          } else if (direction === "right" && props.onSwipeRight) {
            props.onSwipeRight();
          } else props.onPress();
          resetGesture();
        }),
      mask: "gesture" as any,
    }
    : undefined;
  const tapGesture = !props.passive && !needsManualGesture
    ? { onTapGesture: () => props.onPress() }
    : {};

  return (
    <ZStack
      key={props.id}
      alignment="center"
      frame={{ width, height: props.height ?? BASE_KEY_HEIGHT }}
      background={(props.plain ? "rgba(0,0,0,0.001)" : bg) as any}
      foregroundStyle={fg as any}
      contentShape="rect"
      clipShape={props.plain ? undefined : { type: "rect", cornerRadius: 8 }}
      shadow={props.plain
        ? undefined
        : { color: props.palette.shadow as any, radius: 1, y: 1 }}
      {...tapGesture}
      {...(manualGesture ? { highPriorityGesture: manualGesture } : {})}
      {...(props.contextMenu ? { contextMenu: props.contextMenu } : {})}
    >
      {props.topCenter
        ? (
          <Text
            font="caption2"
            foregroundStyle={(props.topCenterForeground ??
              props.palette.hint) as any}
            frame={{
              maxWidth: "infinity" as any,
              maxHeight: "infinity" as any,
              alignment: "top" as any,
            }}
            padding={{ top: 4 }}
          >
            {props.topCenter}
          </Text>
        )
        : null}
      {props.modeTopLeft || props.modeBottomRight
        ? (
          <Group>
            <Text
              font={modeFontSize}
              fontWeight="regular"
              foregroundStyle={(props.modeTopLeftActive
                ? fg
                : props.palette.hint) as any}
              frame={{
                maxWidth: "infinity" as any,
                maxHeight: "infinity" as any,
                alignment: "topLeading" as any,
              }}
              padding={{ leading: modeInset, top: modeInset }}
            >
              {props.modeTopLeft ?? ""}
            </Text>
            <Text
              font={modeFontSize}
              fontWeight="regular"
              foregroundStyle={(props.modeTopLeftActive
                ? props.palette.hint
                : fg) as any}
              frame={{
                maxWidth: "infinity" as any,
                maxHeight: "infinity" as any,
                alignment: "bottomTrailing" as any,
              }}
              padding={{ trailing: modeInset, bottom: modeInset }}
            >
              {props.modeBottomRight ?? ""}
            </Text>
          </Group>
        )
        : null}
      {props.topLeft || props.topRight || props.topLeftImage ||
          props.topRightImage
        ? (
          <HStack
            frame={{
              maxWidth: "infinity" as any,
              maxHeight: "infinity" as any,
              alignment: "top" as any,
            }}
            padding={{ horizontal: hintPadding, top: 4 }}
          >
            {props.topLeftImage
              ? (
                <Image
                  systemName={props.topLeftImage}
                  imageScale="small"
                  font={hintFontSize}
                  frame={{
                    width: hintSlotWidth,
                    height: 10,
                    alignment: "leading" as any,
                  }}
                  foregroundStyle={props.palette.hint as any}
                />
              )
              : (
                <Text
                  font={hintFontSize}
                  foregroundStyle={props.palette.hint as any}
                  lineLimit={1}
                  minScaleFactor={0.45}
                  allowsTightening
                  frame={{
                    width: hintSlotWidth,
                    alignment: "leading" as any,
                  }}
                >
                  {props.topLeft ?? ""}
                </Text>
              )}
            <Spacer />
            {props.topRightImage
              ? (
                <Image
                  systemName={props.topRightImage}
                  imageScale="small"
                  font={hintFontSize}
                  frame={{
                    width: hintSlotWidth,
                    height: 10,
                    alignment: "trailing" as any,
                  }}
                  foregroundStyle={props.palette.hint as any}
                />
              )
              : (
                <Text
                  font={hintFontSize}
                  foregroundStyle={props.palette.hint as any}
                  lineLimit={1}
                  minScaleFactor={0.45}
                  allowsTightening
                  frame={{
                    width: hintSlotWidth,
                    alignment: "trailing" as any,
                  }}
                >
                  {props.topRight ?? ""}
                </Text>
              )}
          </HStack>
        )
        : null}
      {props.image
        ? (
          <Image
            systemName={props.image}
            imageScale={props.imageScale ?? "large"}
            foregroundStyle={fg as any}
          />
        )
        : (
          <Text
            font={props.labelFontSize ??
              (props.label && props.label.length > 2 ? 16 : 28)}
            fontWeight="regular"
            lineLimit={1}
            minScaleFactor={0.62}
            frame={{
              maxWidth: "infinity" as any,
              maxHeight: "infinity" as any,
              alignment: "center" as any,
            }}
            padding={{ horizontal: 3 }}
          >
            {props.label ?? ""}
          </Text>
        )}
      {props.bottomRight
        ? (
          <HStack
            frame={{
              maxWidth: "infinity" as any,
              maxHeight: "infinity" as any,
              alignment: "bottomTrailing" as any,
            }}
            padding={{ trailing: 8, bottom: 5 }}
          >
            <Text
              font={props.bottomRightFontSize ?? "caption"}
              foregroundStyle={props.palette.hint as any}
              lineLimit={1}
            >
              {props.bottomRight}
            </Text>
          </HStack>
        )
        : null}
    </ZStack>
  );
}

export function CandidateButton(props: {
  index: number;
  candidate: Rime.Candidate;
  comment?: string;
  selected: boolean;
  palette: Palette;
  width?: number;
  naturalWidth?: number;
  height?: number;
  candidateFontSize?: number;
  commentFontSize?: number;
  expanded?: boolean;
  onPress: () => void;
}) {
  const comment = props.comment ?? "";
  const showComment = comment.length > 0;
  const candidateFontSize = props.candidateFontSize ?? 19;
  const commentFontSize = props.commentFontSize ?? 10;
  const horizontalPadding = 7;
  const commentLine = showComment
    ? `${props.index + 1} ${comment}`
    : `${props.index + 1}`;
  const naturalWidth = props.naturalWidth ??
    candidateButtonNaturalWidth({
      text: props.candidate.text,
      comment,
      index: props.index,
      candidateFontSize,
      commentFontSize,
      expanded: props.expanded,
    });
  const contentWidth = Math.max(1, naturalWidth - horizontalPadding * 2);
  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={{ horizontal: horizontalPadding, vertical: 3 }}
      background={(props.selected
        ? {
          style: props.palette.keyBg as any,
          shape: { type: "rect", cornerRadius: 6 },
        }
        : "clear") as any}
      onTapGesture={props.onPress}
      frame={{
        width: props.width ?? naturalWidth,
        height: props.height ?? (props.expanded ? 56 : 40),
        alignment: "leading" as any,
      }}
    >
      <Text
        font={candidateFontSize}
        lineLimit={1}
        truncationMode="tail"
        fixedSize={props.width ? false : { horizontal: true, vertical: true }}
        foregroundStyle={props.palette.primary as any}
        frame={{
          width: props.width ? undefined : contentWidth,
          maxWidth: props.width ? "infinity" as any : undefined,
          alignment: "leading" as any,
        }}
      >
        {props.candidate.text}
      </Text>
      <Text
        font={commentFontSize}
        lineLimit={1}
        truncationMode="tail"
        fixedSize={props.width ? false : { horizontal: true, vertical: true }}
        allowsTightening
        foregroundStyle={props.palette.secondary as any}
        frame={{
          width: props.width ? undefined : contentWidth,
          maxWidth: props.width ? "infinity" as any : undefined,
          alignment: "leading" as any,
        }}
      >
        {commentLine}
      </Text>
    </VStack>
  );
}
