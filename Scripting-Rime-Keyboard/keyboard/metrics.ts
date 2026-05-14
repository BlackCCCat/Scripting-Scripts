import { Device } from "scripting";
import type { RimeKeyboardSettings } from "../settings";
import {
  BASE_FUNCTION_KEY_HEIGHT,
  BASE_KEY_HEIGHT,
  DEFAULT_KEYBOARD_HEIGHT,
  KEY_SPACING,
  SIDE_PADDING,
} from "./constants";
import type { KeyboardMetrics } from "./types";
import { clamp } from "./utils";

export function keyboardMetrics(
  settings: RimeKeyboardSettings,
): KeyboardMetrics {
  const width = Math.max(
    320,
    Number(Device.screen.width ?? 390) - SIDE_PADDING * 2,
  );
  const targetHeight = settings.useCustomKeyboardHeight
    ? settings.keyboardHeight
    : DEFAULT_KEYBOARD_HEIGHT;
  const heightDelta = targetHeight - DEFAULT_KEYBOARD_HEIGHT;
  const keyHeight = Math.round(
    clamp(BASE_KEY_HEIGHT + heightDelta * 0.12, 44, 58),
  );
  const functionKeyHeight = Math.round(
    clamp(BASE_FUNCTION_KEY_HEIGHT + heightDelta * 0.08, 34, 48),
  );
  const candidateBarHeight = settings.candidateBarHeight;
  const candidateButtonHeight = Math.max(36, candidateBarHeight);
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
  const actionWidth = Math.min(82, Math.max(76, width * 0.2));
  const numbers = actionWidth;
  const comma = 40;
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
    candidateBarHeight,
    candidateButtonHeight,
    candidateFontSize,
    candidateCommentFontSize,
    bottom: { numbers, comma, space, mode, enter },
  };
}
