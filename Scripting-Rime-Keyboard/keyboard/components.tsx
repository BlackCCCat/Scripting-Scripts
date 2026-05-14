import { Group, HStack, Image, Spacer, Text, VStack, ZStack } from "scripting";
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
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  contextMenu?: any;
}) {
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
      {...(props.passive ? {} : {
        onTapGesture: () => props.onPress(),
        onDragGesture: {
          minDistance: 18,
          onEnded: (details: any) => {
            const direction = dragDirection(details);
            if (direction === "up") props.onSwipeUp?.();
            else if (direction === "down") props.onSwipeDown?.();
            else if (direction === "left") props.onSwipeLeft?.();
            else if (direction === "right") props.onSwipeRight?.();
          },
        },
      })}
      {...(props.onLongPress
        ? {
          onLongPressGesture: {
            minDuration: 320,
            perform: () => props.onLongPress?.(),
            onPressingChanged: (pressing: boolean) => {
              if (!pressing) props.onLongPressEnd?.();
            },
          },
        }
        : {})}
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
              font={16}
              fontWeight="regular"
              foregroundStyle={(props.modeTopLeftActive
                ? fg
                : props.palette.hint) as any}
              frame={{
                maxWidth: "infinity" as any,
                maxHeight: "infinity" as any,
                alignment: "topLeading" as any,
              }}
              padding={{ leading: 9, top: 7 }}
            >
              {props.modeTopLeft ?? ""}
            </Text>
            <Text
              font={16}
              fontWeight="regular"
              foregroundStyle={(props.modeTopLeftActive
                ? props.palette.hint
                : fg) as any}
              frame={{
                maxWidth: "infinity" as any,
                maxHeight: "infinity" as any,
                alignment: "bottomTrailing" as any,
              }}
              padding={{ trailing: 9, bottom: 7 }}
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
            padding={{ horizontal: 7, top: 4 }}
          >
            {props.topLeftImage
              ? (
                <Image
                  systemName={props.topLeftImage}
                  imageScale="small"
                  font={8}
                  frame={{ width: 9, height: 9 }}
                  foregroundStyle={props.palette.hint as any}
                />
              )
              : (
                <Text
                  font="caption2"
                  foregroundStyle={props.palette.hint as any}
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
                  font={8}
                  frame={{ width: 9, height: 9 }}
                  foregroundStyle={props.palette.hint as any}
                />
              )
              : (
                <Text
                  font="caption2"
                  foregroundStyle={props.palette.hint as any}
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
