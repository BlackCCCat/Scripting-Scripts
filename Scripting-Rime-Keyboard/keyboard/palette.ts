import { type KeyColorScheme, type RimeKeyboardSettings } from "../settings";
import type { Palette } from "./types";

export type KeyboardAppearance = "default" | "light" | "dark";

function activeCustomColorScheme(
  settings: RimeKeyboardSettings,
  keyboardAppearance?: KeyboardAppearance,
): KeyColorScheme | null {
  if (settings.theme === "light" || settings.theme === "dark") {
    return settings.theme;
  }
  if (keyboardAppearance === "dark" || keyboardAppearance === "light") {
    return keyboardAppearance;
  }
  return null;
}

export function paletteFor(
  settings: RimeKeyboardSettings,
  keyboardAppearance?: KeyboardAppearance,
): Palette {
  const customColorScheme = activeCustomColorScheme(
    settings,
    keyboardAppearance,
  );
  const usesCustomColors = settings.customKeyColors &&
    customColorScheme != null &&
    (customColorScheme === "light"
      ? settings.customKeyColorLight
      : settings.customKeyColorDark);
  const usesCustomFontColors = settings.customKeyFontColors &&
    customColorScheme != null &&
    (customColorScheme === "light"
      ? settings.customKeyFontColorLight
      : settings.customKeyFontColorDark);
  const usesCustomHintColors = settings.customKeyHintColors &&
    customColorScheme != null &&
    (customColorScheme === "light"
      ? settings.customKeyHintColorLight
      : settings.customKeyHintColorDark);
  const keyOverrides = usesCustomColors
    ? Object.fromEntries(
      Object.entries(settings.keyColors.overrides).map(([key, value]) => [
        key,
        value[customColorScheme],
      ]),
    )
    : {};
  const primaryOverrides = usesCustomFontColors
    ? Object.fromEntries(
      Object.entries(settings.keyFontColors.overrides).map(([key, value]) => [
        key,
        value[customColorScheme],
      ]),
    )
    : {};
  const hintOverrides = usesCustomHintColors
    ? Object.fromEntries(
      Object.entries(settings.keyHintColors.overrides).map(([key, value]) => [
        key,
        value[customColorScheme],
      ]),
    )
    : {};
  if (settings.theme === "dark") {
    return {
      keyBg: usesCustomColors ? settings.keyColors.normal.dark : "#5f6064",
      enterBg: usesCustomColors ? settings.keyColors.enter.dark : "#5f6064",
      keyOverrides,
      primary: usesCustomFontColors ? settings.keyFontColors.normal.dark : "#f5f5f7",
      secondary: "#d0d0d4",
      hint: usesCustomHintColors ? settings.keyHintColors.normal.dark : "#b2b2b7",
      primaryOverrides,
      hintOverrides,
      accent: "#0a84ff",
      accentText: "#ffffff",
      shadow: "rgba(0,0,0,0.45)",
    };
  }
  if (settings.theme === "light") {
    return {
      keyBg: usesCustomColors ? settings.keyColors.normal.light : "#ffffff",
      enterBg: usesCustomColors ? settings.keyColors.enter.light : "#ffffff",
      keyOverrides,
      primary: usesCustomFontColors ? settings.keyFontColors.normal.light : "#000000",
      secondary: "#3a3a3c",
      hint: usesCustomHintColors ? settings.keyHintColors.normal.light : "#8a8a8e",
      primaryOverrides,
      hintOverrides,
      accent: "#007aff",
      accentText: "#ffffff",
      shadow: "rgba(0,0,0,0.22)",
    };
  }
  return {
    keyBg: usesCustomColors
      ? settings.keyColors.normal[customColorScheme]
      : "systemBackground",
    enterBg: usesCustomColors
      ? settings.keyColors.enter[customColorScheme]
      : "systemBackground",
    keyOverrides,
    primary: usesCustomFontColors
      ? settings.keyFontColors.normal[customColorScheme]
      : "label",
    secondary: "secondaryLabel",
    hint: usesCustomHintColors
      ? settings.keyHintColors.normal[customColorScheme]
      : "tertiaryLabel",
    primaryOverrides,
    hintOverrides,
    accent: "accentColor",
    accentText: "white",
    shadow: "rgba(0,0,0,0.22)",
  };
}
