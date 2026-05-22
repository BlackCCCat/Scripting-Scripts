export type KeyboardMetrics = {
  width: number;
  letterWidth: number;
  secondRowInset: number;
  shiftWidth: number;
  functionWidth8: number;
  keyHeight: number;
  functionKeyHeight: number;
  preeditRowHeight: number;
  candidateBarHeight: number;
  candidateButtonHeight: number;
  candidateFontSize: number;
  candidateCommentFontSize: number;
  bottom: {
    numbers: number;
    comma: number;
    space: number;
    mode: number;
    enter: number;
  };
};

export type Palette = {
  nativeKeyStyle: boolean;
  nativeToolbarStyle: boolean;
  keyBg: string;
  enterBg: string;
  keyOverrides: Record<string, string>;
  primary: string;
  secondary: string;
  hint: string;
  primaryOverrides: Record<string, string>;
  hintOverrides: Record<string, string>;
  accent: string;
  accentText: string;
  shadow: string;
};

export type KeyHitTarget = {
  id: string;
  x: number;
  y?: number;
  width: number;
  height?: number;
  onPress: () => void;
  onLongPress?: () => void;
  onLongPressEnd?: () => void;
  longPressDuration?: number;
  safetyReleaseDelay?: number;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
};
