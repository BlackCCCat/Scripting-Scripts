import {
  DragGesture,
  Group,
  HStack,
  Image,
  Spacer,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting";
import { BASE_KEY_HEIGHT, KEY_SPACING } from "./constants";
import type { Palette } from "./types";
import {
  createTouchIntentMachine,
  dragDirection,
  estimatedTextWidth,
} from "./utils";

const CANDIDATE_LEADING_PADDING = 7;
const CANDIDATE_TRAILING_PADDING = CANDIDATE_LEADING_PADDING;
const KEY_POPUP_EXTRA_WIDTH = 18;
const KEY_VISUAL_CORNER_RADIUS = 8;
const KEY_VISUAL_SHAPE = {
  type: "rect" as const,
  cornerRadius: KEY_VISUAL_CORNER_RADIUS,
};
const HIT_TEST_BACKGROUND = "rgba(0,0,0,0.001)";
type KeyPopupEdge = "center" | "left" | "right";

function KeyPopup(props: {
  title: string;
  titleImage?: string;
  options?: Array<{ label: string; selected: boolean }>;
  keyWidth: number;
  keyHeight: number;
  width: number;
  background: any;
  foreground: string;
  fontSize?: number;
  edge?: KeyPopupEdge;
  glassEffect?: any;
  shadow?: any;
}) {
  const {
    title,
    titleImage,
    options,
    keyWidth,
    keyHeight,
    width: popupWidth,
    background,
    fontSize = 36,
    edge = "center",
    glassEffect,
    shadow,
  } = props;
  const bubbleHeight = keyHeight;
  const bubbleGap = Math.max(6, keyHeight * 0.14);
  const popupOffsetX = edge === "left"
    ? (popupWidth - keyWidth) / 2
    : edge === "right"
    ? -(popupWidth - keyWidth) / 2
    : 0;
  const bubblePosition = {
    x: keyWidth / 2 + popupOffsetX,
    y: -(bubbleHeight / 2 + bubbleGap),
  };

  return (
    <ZStack
      alignment="topLeading"
      frame={{ width: keyWidth, height: 0 }}
      zIndex={100}
      allowsHitTesting={false}
    >
      <ZStack
        alignment="center"
        frame={{ width: popupWidth, height: bubbleHeight }}
        background={background as any}
        glassEffect={glassEffect as any}
        clipShape={KEY_VISUAL_SHAPE}
        shadow={shadow as any}
        position={bubblePosition}
        zIndex={100}
        allowsHitTesting={false}
      >
        {options
          ? (
            <HStack
              spacing={6}
              frame={{ width: popupWidth, height: bubbleHeight }}
              padding={{ horizontal: 8 }}
              allowsHitTesting={false}
            >
              {options.map((option) => (
                <ZStack
                  key={`popup-option-${option.label}`}
                  frame={{
                    width: Math.max(28, (popupWidth - 22) / 2),
                    height: Math.max(28, bubbleHeight * 0.72),
                  }}
                  background={option.selected
                    ? {
                      style: "accentColor" as any,
                      shape: { type: "rect", cornerRadius: 8 },
                    }
                    : "clear" as any}
                >
                  <Text
                    font={Math.min(30, fontSize)}
                    foregroundStyle={(option.selected
                      ? "white"
                      : props.foreground) as any}
                    lineLimit={1}
                    minScaleFactor={0.62}
                  >
                    {option.label}
                  </Text>
                </ZStack>
              ))}
            </HStack>
          )
          : titleImage
          ? (
            <Image
              systemName={titleImage}
              font={fontSize}
              foregroundStyle={props.foreground as any}
              frame={{ width: popupWidth, height: bubbleHeight }}
              allowsHitTesting={false}
            />
          )
          : (
            <Text
              font={fontSize}
              foregroundStyle={props.foreground as any}
              lineLimit={1}
              minScaleFactor={0.52}
              frame={{ width: popupWidth, height: bubbleHeight }}
              allowsHitTesting={false}
            >
              {title}
            </Text>
          )}
      </ZStack>
    </ZStack>
  );
}

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
  popupLabel?: string;
  popupImage?: string;
  popupSwipeUpLabel?: string;
  popupSwipeUpImage?: string;
  popupSwipeDownLabel?: string;
  popupSwipeDownImage?: string;
  popupOptions?: Array<{ label: string; selected: boolean }>;
  contextMenu?: any;
}) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const gestureMachineRef = useRef<any>(null);
  const immediateDragConsumedRef = useRef(false);
  const [swipePopup, setSwipePopupState] = useState<
    { label?: string; image?: string; key: string } | null
  >(null);
  const usesEnterColor = props.id === "enter" || props.id === "numeric-enter";
  const baseBg = props.palette.keyOverrides[props.id] ??
    (props.accent || usesEnterColor
      ? props.palette.enterBg
      : props.palette.keyBg);
  const useNativeKeyStyle = props.palette.nativeKeyStyle && !props.plain;
  const useNativeToolbarStyle = props.palette.nativeToolbarStyle &&
    props.plain;
  const useNativeVisualStyle = useNativeKeyStyle || useNativeToolbarStyle;
  const nativeGlassShape = useNativeToolbarStyle ? "circle" : KEY_VISUAL_SHAPE;
  const baseFg = props.palette.primaryOverrides?.[props.id] ??
    props.palette.primary;
  const fg = props.foregroundStyle ??
    (props.accent
      ? props.palette.accentText
      : (props.selected ? props.palette.accent : baseFg));
  const hintFg = props.palette.hintOverrides?.[props.id] ?? props.palette.hint;
  const width = props.width ?? 32;
  const height = props.height ?? BASE_KEY_HEIGHT;
  const visualInset = props.plain ? 0 : Math.min(
    props.palette.keyVisualInset,
    Math.max(0, width / 2 - 10),
    Math.max(0, height / 2 - 10),
  );
  const visualWidth = Math.max(1, width - visualInset * 2);
  const visualHeight = Math.max(1, height - visualInset * 2);
  const touchWidth = props.touchWidth ?? width;
  const touchHeight = props.touchHeight ?? height;
  const visualOffsetX = (props.visualOffsetX ?? (touchWidth - width) / 2) +
    visualInset;
  const visualOffsetY = (props.visualOffsetY ?? (touchHeight - height) / 2) +
    visualInset;
  const hintPadding = visualWidth < 34 ? 5 : 7;
  const hintSlotWidth = Math.max(8, (visualWidth - hintPadding * 2) / 2);
  const hintFontSize = Math.max(7, Math.min(10, visualWidth * 0.3));
  const modeFontSize = Math.max(
    11,
    Math.min(16, visualHeight * 0.32),
  );
  const modeInset = Math.max(
    4,
    Math.min(9, visualHeight * 0.13),
  );
  const hasSwipePopup = props.active && swipePopup !== null;
  const popupTitle = props.active
    ? hasSwipePopup ? swipePopup?.label : props.popupLabel
    : undefined;
  const popupImage = props.active
    ? hasSwipePopup ? swipePopup?.image : props.popupImage
    : undefined;
  const popupOptions = props.active ? props.popupOptions : undefined;
  const popupForeground = hasSwipePopup ? hintFg : fg;
  const popupVisible = !!(popupTitle || popupImage || popupOptions);
  const popupWidth = popupVisible ? visualWidth + KEY_POPUP_EXTRA_WIDTH : 0;
  const popupRenderWidth = popupOptions
    ? Math.max(popupWidth + 34, visualWidth * 1.7)
    : popupWidth;
  const outerEdgeTouchWidth = popupVisible ? touchWidth - width : 0;
  const touchesOuterLetterEdge = outerEdgeTouchWidth > 0.5 &&
    outerEdgeTouchWidth <= KEY_SPACING / 2 + 0.75;
  const popupEdge: KeyPopupEdge = !popupVisible || !touchesOuterLetterEdge
    ? "center"
    : visualOffsetX <= Math.max(0.5, visualInset + 0.5)
    ? "left"
    : touchWidth - (visualOffsetX + visualWidth) <=
        Math.max(0.5, visualInset + 0.5)
    ? "right"
    : "center";
  const popupAlignment = popupEdge === "left"
    ? "topLeading"
    : popupEdge === "right"
    ? "topTrailing"
    : "top";
  const keyVisualBackground =
    (useNativeVisualStyle
      ? props.palette.usesCustomColors ? baseBg : "clear"
      : props.plain
      ? HIT_TEST_BACKGROUND
      : { style: baseBg as any, shape: KEY_VISUAL_SHAPE }) as any;
  const keyPressFeedbackBackground = {
    style: fg as any,
    shape: KEY_VISUAL_SHAPE,
  };
  const popupVisualBackground =
    (useNativeVisualStyle
      ? props.palette.usesCustomColors ? baseBg : "clear"
      : props.plain
      ? HIT_TEST_BACKGROUND
      : { style: baseBg as any, shape: KEY_VISUAL_SHAPE }) as any;
  const keyVisualShadow = useNativeVisualStyle || props.plain
    ? undefined
    : { color: props.palette.shadow as any, radius: 1, y: 1 };
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

  function setSwipePopup(next: { label?: string; image?: string } | null) {
    const key = next ? `${next.label ?? ""}:${next.image ?? ""}` : "";
    setSwipePopupState((current) => {
      if ((current?.key ?? "") === key) return current;
      return next ? { ...next, key } : null;
    });
  }

  function updateSwipePopup(details: any) {
    if (!propsRef.current.popupLabel && !propsRef.current.popupImage) return;
    const threshold = typeof propsRef.current.swipeTriggerDistance ===
        "function"
      ? propsRef.current.swipeTriggerDistance()
      : propsRef.current.swipeTriggerDistance ?? 16;
    const direction = dragDirection(details, threshold);
    if (direction === "up") {
      const image = propsRef.current.popupSwipeUpImage;
      const label = propsRef.current.popupSwipeUpLabel;
      setSwipePopup(image || label ? { image, label } : null);
      return;
    }
    if (direction === "down") {
      const image = propsRef.current.popupSwipeDownImage;
      const label = propsRef.current.popupSwipeDownLabel;
      setSwipePopup(image || label ? { image, label } : null);
      return;
    }
    setSwipePopup(null);
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
          updateSwipePopup(details);
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
          setSwipePopup(null);
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
      background={HIT_TEST_BACKGROUND as any}
      contentShape="rect"
      zIndex={popupVisible ? 50 : props.active ? 5 : 0}
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
            frame={{ width: visualWidth, height: visualHeight }}
            overlay={popupVisible
              ? {
                alignment: popupAlignment as any,
                content: (
                  <KeyPopup
                    title={popupTitle ?? ""}
                    titleImage={popupImage}
                    options={popupOptions}
                    keyWidth={visualWidth}
                    keyHeight={visualHeight}
                    width={popupRenderWidth}
                    background={popupVisualBackground}
                    foreground={popupForeground}
                    fontSize={(popupTitle?.length ?? 0) > 2 ? 25 : 36}
                    edge={popupEdge}
                    glassEffect={(useNativeVisualStyle
                      ? nativeGlassShape
                      : undefined) as any}
                    shadow={keyVisualShadow}
                  />
                ),
              }
              : undefined}
          >
            <ZStack
              alignment="center"
              frame={{ width: visualWidth, height: visualHeight }}
              background={keyVisualBackground}
              foregroundStyle={fg as any}
              glassEffect={(useNativeVisualStyle
                ? nativeGlassShape
                : undefined) as any}
              clipShape={useNativeToolbarStyle
                ? "circle" as any
                : props.plain
                ? undefined
                : KEY_VISUAL_SHAPE}
              overlay={props.active && !props.plain
                ? {
                  alignment: "center" as any,
                  content: (
                    <ZStack
                      frame={{ width: visualWidth, height: visualHeight }}
                      background={keyPressFeedbackBackground as any}
                      clipShape={KEY_VISUAL_SHAPE}
                      opacity={0.16}
                      allowsHitTesting={false}
                    />
                  ),
                }
                : undefined}
              shadow={keyVisualShadow}
              scaleEffect={props.active && !props.plain ? 0.965 : 1}
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
  const naturalWidth = candidateButtonNaturalWidth({
    text: props.candidate.text,
    comment,
    index: props.index,
    showIndex,
    candidateFontSize,
    commentFontSize,
    expanded: props.expanded,
  });
  const resolvedWidth = frameWidth ?? naturalWidth;
  const candidateBg = props.palette.keyOverrides[`candidate-${props.index}`] ??
    props.palette.keyBg;
  const bg = props.selected
    ? props.palette.keyOverrides["candidate-selected"] ?? candidateBg
    : candidateBg;
  const fg = props.palette.primaryOverrides[`candidate-${props.index}`] ??
    props.palette.primary;
  const hintFg = props.palette.hintOverrides[`candidate-${props.index}`] ??
    props.palette.hint;
  const useNativeStyle = props.palette.nativeKeyStyle;
  const background = props.selected
    ? useNativeStyle ? props.palette.usesCustomColors ? bg : "clear" : bg
    : "clear";
  const glassEffect = props.selected && useNativeStyle
    ? { type: "rect", cornerRadius: 8 }
    : undefined;
  const shadow = props.selected && !useNativeStyle
    ? { color: props.palette.shadow as any, radius: 1, y: 1 }
    : undefined;

  return (
    <ZStack
      frame={{ ...rootFrame, width: resolvedWidth }}
      background={background as any}
      foregroundStyle={fg as any}
      glassEffect={glassEffect as any}
      clipShape={props.selected ? { type: "rect", cornerRadius: 8 } : undefined}
      shadow={shadow}
      contentShape="rect"
      onTapGesture={props.onPress}
      {...(props.contextMenu ? { contextMenu: props.contextMenu } : {})}
    >
      <VStack
        spacing={showComment || commentLine ? 1 : 0}
        frame={{ ...contentFrame, width: resolvedWidth }}
        padding={{ horizontal: CANDIDATE_LEADING_PADDING, vertical: 4 }}
      >
        <Text
          font={candidateFontSize * (props.expanded ? 1.08 : 1)}
          foregroundStyle={fg as any}
          lineLimit={1}
          minScaleFactor={0.74}
          allowsTightening
          frame={{
            maxWidth: "infinity" as any,
            maxHeight: showComment || commentLine
              ? "infinity" as any
              : frameHeight,
            alignment: "leading" as any,
          }}
        >
          {props.candidate.text}
        </Text>
        {commentLine
          ? (
            <Text
              font={commentFontSize * (props.expanded ? 1.12 : 1)}
              foregroundStyle={hintFg as any}
              lineLimit={1}
              minScaleFactor={0.62}
              allowsTightening
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              {commentLine}
            </Text>
          )
          : null}
      </VStack>
    </ZStack>
  );
}
