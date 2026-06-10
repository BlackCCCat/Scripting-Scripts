import type { RimeKeyboardSettings } from "../settings";
import {
  BASE_FUNCTION_KEY_HEIGHT,
  BASE_KEY_HEIGHT,
  DEFAULT_KEYBOARD_HEIGHT,
  KEY_SPACING,
  PREEDIT_ROW_HEIGHT,
  SIDE_PADDING,
} from "./constants";
import type { KeyboardMetrics } from "./types";
import { clamp } from "./utils";

export function keyboardMetrics(
  settings: RimeKeyboardSettings,
  availableHeight?: number,
  availableWidth?: number,
): KeyboardMetrics {
  const measuredWidth = Number(
    availableWidth && availableWidth > 0 ? availableWidth : 390,
  );
  const width = Math.max(240, measuredWidth - SIDE_PADDING * 2);
  const targetHeight = settings.useCustomKeyboardHeight
    ? settings.keyboardHeight
    : (availableHeight && availableHeight > 0
      ? availableHeight
      : DEFAULT_KEYBOARD_HEIGHT);
  const fixedHeight = 12 +
    KEY_SPACING * (settings.showFunctionRow ? 5 : 4) +
    (settings.inlinePreedit ? 0 : 2);
  const scalableHeight = settings.candidateBarHeight +
    (settings.inlinePreedit ? 0 : PREEDIT_ROW_HEIGHT) +
    (settings.showFunctionRow ? BASE_FUNCTION_KEY_HEIGHT : 0) +
    BASE_KEY_HEIGHT * 4;
  const heightScale = clamp(
    (targetHeight - fixedHeight) / scalableHeight,
    0.48,
    1.34,
  );
  const keyHeight = Math.round(
    clamp(BASE_KEY_HEIGHT * heightScale, 26, 66),
  );
  const functionKeyHeight = Math.round(
    clamp(BASE_FUNCTION_KEY_HEIGHT * heightScale, 22, 54),
  );
  const preeditRowHeight = Math.round(
    clamp(PREEDIT_ROW_HEIGHT * heightScale, 12, PREEDIT_ROW_HEIGHT),
  );
  const candidateBarHeight = Math.round(
    clamp(settings.candidateBarHeight * heightScale, 28, 64),
  );
  const candidateButtonHeight = Math.max(28, candidateBarHeight);
  const candidateFontSize = Math.round(
    clamp(candidateBarHeight * 0.46, 16, 24),
  );
  const candidateCommentFontSize = Math.round(
    clamp(candidateBarHeight * 0.24, 9, 12),
  );
  const letterWidth = (width - KEY_SPACING * 9) / 10;
  const secondRowInset = Math.max(
    0,
    (width - letterWidth * 9 - KEY_SPACING * 8) / 2,
  );
  const shiftWidth = Math.max(
    letterWidth * 1.45,
    (width - letterWidth * 7 - KEY_SPACING * 8) / 2,
  );
  const actionWidth = clamp(width * 0.19, 52, 82);
  const numbers = actionWidth;
  const comma = clamp(width * 0.105, 32, 40);
  const mode = comma;
  const enter = actionWidth;
  const space = width - numbers - comma - mode - enter - KEY_SPACING * 4;
  return {
    width,
    letterWidth,
    secondRowInset,
    shiftWidth,
    functionWidth8: (width - KEY_SPACING * 7) / 8,
    keyHeight,
    functionKeyHeight,
    preeditRowHeight,
    candidateBarHeight,
    candidateButtonHeight,
    candidateFontSize,
    candidateCommentFontSize,
    bottom: { numbers, comma, space, mode, enter },
  };
}
