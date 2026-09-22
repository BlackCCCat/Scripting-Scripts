import { Button, Group } from "scripting"

import type {
  CaisSettings,
  KeyboardCustomAction,
  KeyboardMenuBuiltinAction,
} from "../types"
import {
  customActionSystemImage,
  getOrderedMenuBuiltins,
  menuBuiltinSystemImage,
  menuBuiltinTitle,
} from "../utils/menu_actions"

export function FavoriteFieldActionMenu(props: {
  settings: CaisSettings
  supportsOpenUrl: boolean
  onCopy: () => void | Promise<void>
  onBuiltin: (action: KeyboardMenuBuiltinAction) => void | Promise<void>
  onCustom: (action: KeyboardCustomAction) => void | Promise<void>
}) {
  return (
    <Group>
      <Button title="复制" systemImage="doc.on.doc" action={() => void props.onCopy()} />
      {getOrderedMenuBuiltins(props.settings).map((action) => {
        const enabled = props.settings.keyboardMenu.builtins[action]
        const supported = action !== "openUrl" || props.supportsOpenUrl
        return enabled && supported ? (
          <Button
            key={action}
            title={menuBuiltinTitle(action)}
            systemImage={menuBuiltinSystemImage(action)}
            action={() => void props.onBuiltin(action)}
          />
        ) : null
      })}
      {props.settings.keyboardMenu.customActions
        .filter((action) => action.enabled)
        .map((action) => (
          <Button
            key={action.id}
            title={action.title}
            systemImage={customActionSystemImage(action)}
            action={() => void props.onCustom(action)}
          />
        ))}
    </Group>
  )
}
