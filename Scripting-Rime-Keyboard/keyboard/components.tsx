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
import { createTouchIntentMachine, estimatedTextWidth } from "./utils";

const CANDIDATE_LEADING_PADDING = 7;
const CANDIDATE_TRAILING_PADDING = CANDIDATE_LEADING_PADDING;

export function candidateButtonNaturalWidth(params: {
  text: string;
  comment: string;
  index: number;
  showIndex?: boolean;
  candidateFontSize: number;
  commentFontSize: number;
  expanded?: boolean;
}) {
  const textFontSize = params.candidateFontSize * (params.expanded ? 1.08 : 1);
  const textWidth = estimatedTextWidth(
    params.text,
    textFontSize,
    params.candidateFontSize * (params.expanded ? 0.68 : 0.54),
  );
  const commentLine = params.comment.length > 0
    ? `${params.index + 1} ${params.comment}`
    : params.showIndex === false
    ? ""
    : `${params.index + 1}`;
  const commentFontSize = params.commentFontSize *
    (params.expanded ? 1.12 : 1);
  const commentWidth = commentLine
    ? estimatedTextWidth(
      commentLine,
      commentFontSize,
      params.commentFontSize * (params.expanded ? 0.54 : 0.54),
    )
    : 0;
  const hasMetaLine = commentLine.length > 0;
  const minWidth = params.expanded ? 54 : hasMetaLine ? 42 : 12;
  return Math.ceil(
    Math.max(minWidth, textWidth, commentWidth) +
      CANDIDATE_LEADING_PADDING + CANDIDATE_TRAILING_PADDING,
  );
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
  touchWidth?: number;
  touchHeight?: number;
  visualOffsetX?: number;
  visualOffsetY?: number;
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
  longPressEnabled?: boolean | (() => boolean);
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
  onImmediateDrag?: (details: any) => boolean;
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
  const propsRef = useRef(props);
  propsRef.current = props;
  const gestureMachineRef = useRef<any>(null);
  const immediateDragConsumedRef = useRef(false);
  const usesEnterColor = props.id === "enter" || props.id === "numeric-enter";
  const baseBg = props.palette.keyOverrides[props.id] ??
    (props.accent || usesEnterColor
      ? props.palette.enterBg
      : props.palette.keyBg);
  const useNativeKeyStyle = props.palette.nativeKeyStyle && !props.plain;
  const useNativeToolbarStyle = props.palette.nativeToolbarStyle &&
    props.plain;
  const useNativeVisualStyle = useNativeKeyStyle || useNativeToolbarStyle;
  const nativeGlassShape = useNativeToolbarStyle
    ? "circle"
    : { type: "rect", cornerRadius: 8 };
  const bg = props.active && !props.plain ? "tertiarySystemFill" : baseBg;
  const baseFg = props.palette.primaryOverrides?.[props.id] ??
    props.palette.primary;
  const fg = props.foregroundStyle ??
    (props.accent
      ? props.palette.accentText
      : (props.selected ? props.palette.accent : baseFg));
  const hintFg = props.palette.hintOverrides?.[props.id] ?? props.palette.hint;
  const width = props.width ?? 32;
  const height = props.height ?? BASE_KEY_HEIGHT;
  const touchWidth = props.touchWidth ?? width;
  const touchHeight = props.touchHeight ?? height;
  const visualOffsetX = props.visualOffsetX ?? (touchWidth - width) / 2;
  const visualOffsetY = props.visualOffsetY ?? (touchHeight - height) / 2;
  const hintPadding = width < 34 ? 5 : 7;
  const hintSlotWidth = Math.max(8, (width - hintPadding * 2) / 2);
  const hintFontSize = Math.max(7, Math.min(10, width * 0.3));
  const modeFontSize = Math.max(
    11,
    Math.min(16, height * 0.32),
  );
  const modeInset = Math.max(
    4,
    Math.min(9, height * 0.13),
  );
  const hasSwipe = !!(
    props.onSwipeUp || props.onSwipeDown || props.onSwipeLeft ||
    props.onSwipeRight
  );
  const needsManualGesture = !props.passive &&
    (hasSwipe || props.onLongPress || props.onTouchStart || props.onTouchEnd ||
      props.onImmediateDrag);

  function dragIntent(details: any) {
    const dx = Math.abs(Number(details?.translation?.width ?? 0));
    const dy = Math.abs(Number(details?.translation?.height ?? 0));
    const vx = Math.abs(Number(details?.velocity?.width ?? 0));
    const vy = Math.abs(Number(details?.velocity?.height ?? 0));
    return dx >= 4 || dy >= 4 || vx >= 8 || vy >= 8;
  }

  function isLongPressEnabled() {
    const value = propsRef.current.longPressEnabled;
    return typeof value === "function" ? value() : value ?? true;
  }

  if (!gestureMachineRef.current) {
    gestureMachineRef.current = createTouchIntentMachine({
      longPressDuration: () => propsRef.current.longPressDuration ?? 360,
      swipeTriggerDistance: () =>
        typeof propsRef.current.swipeTriggerDistance === "function"
          ? propsRef.current.swipeTriggerDistance()
          : propsRef.current.swipeTriggerDistance ?? 16,
      safetyReleaseDelay: () =>
        propsRef.current.contextMenu && !propsRef.current.onLongPress
          ? 180
          : 1500,
      isLongPressEnabled,
      shouldCancelLongPress: (details: any) =>
        !!propsRef.current.onLongPress && dragIntent(details),
      onTouchStart: () => propsRef.current.onTouchStart?.(),
      onTouchEnd: () => propsRef.current.onTouchEnd?.(),
      onLongPress: () => propsRef.current.onLongPress?.(),
      onLongPressEnd: () => propsRef.current.onLongPressEnd?.(),
      onLongPressMove: (details: any) =>
        propsRef.current.onLongPressMove?.(details),
      onSwipeStart: () => propsRef.current.onSwipeStart?.(),
      onResolveSwipe: (
        direction: "up" | "down" | "left" | "right",
      ) => {
        if (direction === "up" && propsRef.current.onSwipeUp) {
          propsRef.current.onSwipeUp();
          return true;
        }
        if (direction === "down" && propsRef.current.onSwipeDown) {
          propsRef.current.onSwipeDown();
          return true;
        }
        if (direction === "left" && propsRef.current.onSwipeLeft) {
          propsRef.current.onSwipeLeft();
          return true;
        }
        if (direction === "right" && propsRef.current.onSwipeRight) {
          propsRef.current.onSwipeRight();
          return true;
        }
        return false;
      },
      onPress: () => propsRef.current.onPress(),
    });
  }

  useEffect(() => {
    return () => {
      gestureMachineRef.current?.dispose?.();
    };
  }, []);

  const manualGesture = needsManualGesture
    ? {
      gesture: DragGesture({ minDistance: 0, coordinateSpace: "local" })
        .onChanged((details: any) => {
          gestureMachineRef.current?.start();
          if (immediateDragConsumedRef.current) {
            propsRef.current.onImmediateDrag?.(details);
            gestureMachineRef.current?.cancel?.();
            return;
          }
          if (propsRef.current.onImmediateDrag?.(details)) {
            immediateDragConsumedRef.current = true;
            gestureMachineRef.current?.cancel?.();
            return;
          }
          gestureMachineRef.current?.update(details);
        })
        .onEnded((details: any) => {
          if (immediateDragConsumedRef.current) {
            immediateDragConsumedRef.current = false;
            propsRef.current.onTouchEnd?.();
            return;
          }
          gestureMachineRef.current?.end(details);
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
      alignment="topLeading"
      frame={{ width: touchWidth, height: touchHeight }}
      background={"rgba(0,0,0,0.001)" as any}
      contentShape="rect"
      {...tapGesture}
      {...(manualGesture ? { highPriorityGesture: manualGesture } : {})}
      {...(props.contextMenu ? { contextMenu: props.contextMenu } : {})}
    >
      <VStack
        spacing={0}
        frame={{
          width: touchWidth,
          height: touchHeight,
          alignment: "topLeading" as any,
        }}
      >
        {visualOffsetY > 0
          ? <VStack frame={{ width: touchWidth, height: visualOffsetY }} />
          : null}
        <HStack
          spacing={0}
          frame={{
            width: touchWidth,
            height,
            alignment: "leading" as any,
          }}
        >
          {visualOffsetX > 0
            ? <VStack frame={{ width: visualOffsetX, height }} />
            : null}
          <ZStack
            alignment="center"
            frame={{ width, height }}
            background={(useNativeVisualStyle
              ? "clear"
              : props.plain
              ? "rgba(0,0,0,0.001)"
              : bg) as any}
            foregroundStyle={fg as any}
            glassEffect={(useNativeVisualStyle
              ? nativeGlassShape
              : undefined) as any}
            clipShape={useNativeToolbarStyle
              ? "circle" as any
              : props.plain
              ? undefined
              : { type: "rect", cornerRadius: 8 }}
            shadow={useNativeVisualStyle || props.plain
              ? undefined
              : { color: props.palette.shadow as any, radius: 1, y: 1 }}
          >
            {props.topCenter
              ? (
                <Text
                  font="caption2"
                  foregroundStyle={(props.topCenterForeground ??
                    hintFg) as any}
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
                      : hintFg) as any}
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
                      ? hintFg
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
                        foregroundStyle={hintFg as any}
                      />
                    )
                    : (
                      <Text
                        font={hintFontSize}
                        foregroundStyle={hintFg as any}
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
                        foregroundStyle={hintFg as any}
                      />
                    )
                    : (
                      <Text
                        font={hintFontSize}
                        foregroundStyle={hintFg as any}
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
                    foregroundStyle={hintFg as any}
                    lineLimit={1}
                  >
                    {props.bottomRight}
                  </Text>
                </HStack>
              )
              : null}
          </ZStack>
        </HStack>
      </VStack>
    </ZStack>
  );
}

export function CandidateButton(props: {
  index: number;
  candidate: Rime.Candidate;
  comment?: string;
  showIndex?: boolean;
  selected: boolean;
  palette: Palette;
  width?: number;
  height?: number;
  candidateFontSize?: number;
  commentFontSize?: number;
  expanded?: boolean;
  contextMenu?: any;
  onPress: () => void;
}) {
  const comment = props.comment ?? "";
  const showIndex = props.showIndex ?? true;
  const showComment = comment.length > 0;
  const candidateFontSize = props.candidateFontSize ?? 19;
  const commentFontSize = props.commentFontSize ?? 10;
  const commentLine = showComment
    ? `${props.index + 1} ${comment}`
    : showIndex
    ? `${props.index + 1}`
    : "";
  const frameWidth = props.width;
  const frameHeight = props.height ?? (props.expanded ? 56 : 40);
  const rootFrame = {
    ...(frameWidth ? { width: frameWidth } : {}),
    height: frameHeight,
    alignment: "leading" as any,
  };
  const contentFrame = {
    ...(frameWidth ? { width: frameWidth } : {}),
    height: frameHeight,
    alignment: "leading" as any,
  };
  const textFrame = frameWidth
    ? {
      maxWidth: "infinity" as any,
      alignment: "leading" as any,
    }
    : {
      alignment: "leading" as any,
    };
  const useNativeKeyStyle = props.palette.nativeKeyStyle;
  return (
    <ZStack
      background={(useNativeKeyStyle ? "clear" : props.selected
        ? {
          style: props.palette.keyBg as any,
          shape: { type: "rect", cornerRadius: 6 },
        }
        : "clear") as any}
      glassEffect={(useNativeKeyStyle && props.selected
        ? { type: "rect", cornerRadius: 6 }
        : undefined) as any}
      onTapGesture={props.onPress}
      {...(props.contextMenu ? { contextMenu: props.contextMenu } : {})}
      frame={rootFrame}
      clipShape={useNativeKeyStyle && props.selected
        ? { type: "rect", cornerRadius: 6 }
        : undefined}
    >
      {commentLine
        ? (
          <VStack
            alignment="leading"
            spacing={0}
            padding={{
              leading: CANDIDATE_LEADING_PADDING,
              trailing: CANDIDATE_TRAILING_PADDING,
              vertical: 3,
            }}
            frame={contentFrame}
          >
            <Text
              font={candidateFontSize}
              lineLimit={1}
              truncationMode="tail"
              fixedSize={props.width
                ? false
                : { horizontal: true, vertical: true }}
              foregroundStyle={props.palette.primary as any}
              frame={textFrame}
            >
              {props.candidate.text}
            </Text>
            <Text
              font={commentFontSize}
              lineLimit={1}
              truncationMode="tail"
              fixedSize={props.width
                ? false
                : { horizontal: true, vertical: true }}
              allowsTightening
              foregroundStyle={props.palette.secondary as any}
              frame={textFrame}
            >
              {commentLine}
            </Text>
          </VStack>
        )
        : (
          <HStack
            spacing={0}
            padding={{
              leading: CANDIDATE_LEADING_PADDING,
              trailing: CANDIDATE_TRAILING_PADDING,
            }}
            frame={contentFrame}
          >
            <Text
              font={candidateFontSize}
              lineLimit={1}
              truncationMode="tail"
              fixedSize={props.width
                ? false
                : { horizontal: true, vertical: true }}
              foregroundStyle={props.palette.primary as any}
              frame={textFrame}
            >
              {props.candidate.text}
            </Text>
          </HStack>
        )}
    </ZStack>
  );
}
