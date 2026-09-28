import type { CommonViewProps } from "scripting"

export type NavigationZoomTransition = Extract<
  NonNullable<CommonViewProps["navigationTransition"]>,
  { type: "zoom" }
>

export type NavigationZoomNamespace = NavigationZoomTransition["namespace"]
