import type { DockAppearance } from "./controller"
const defaults: DockAppearance = {
 surface: "secondarySystemBackground", foreground: "secondaryLabel",
 selectedSurface: "tertiarySystemBackground", selectedForeground: "label",
 border: "separator", shadow: "clear",
}
export const resolveDockAppearance = (appearance?: Partial<DockAppearance>): DockAppearance => {
 if (!appearance) return defaults
 if (Object.keys(defaults).every(key => appearance[key as keyof DockAppearance] !== undefined)) return appearance as DockAppearance
 return { ...defaults, ...appearance }
}
