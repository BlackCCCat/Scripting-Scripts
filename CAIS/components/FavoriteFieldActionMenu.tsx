import { Button, Group, Menu } from "scripting"

import type {
  CaisSettings,
  KeyboardCustomAction,
  KeyboardMenuBuiltinAction,
} from "../types"
import {
  customActionSystemImage,
  groupMenuBuiltins,
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
  const actions = getOrderedMenuBuiltins(props.settings).filter((action) =>
    props.settings.keyboardMenu.builtins[action] &&
    ((action !== "openUrl" && action !== "openUrlInApp") || props.supportsOpenUrl),
  )
  const customActions = props.settings.keyboardMenu.customActions
    .filter((action) => action.enabled)
    .map((action) => (
      <Button
        key={action.id}
        title={action.title}
        systemImage={customActionSystemImage(action)}
        action={() => void props.onCustom(action)}
      />
    ))
  const actionButton = (action: KeyboardMenuBuiltinAction) => (
    <Button
      key={action}
      title={menuBuiltinTitle(action)}
      systemImage={menuBuiltinSystemImage(action)}
      action={() => void props.onBuiltin(action)}
    />
  )
  return (
    <Group>
      <Button title="复制" systemImage="doc.on.doc" action={() => void props.onCopy()} />
      {props.settings.keyboardMenu.grouped
        ? [
            ...actions
              .filter((action) => props.settings.keyboardMenu.ungroupedBuiltins.includes(action))
              .map(actionButton),
            ...groupMenuBuiltins(actions, props.settings.keyboardMenu.ungroupedBuiltins).map((group) => (
              <Menu key={group.id} title={group.title} systemImage={group.systemImage}>
                {group.actions.map(actionButton)}
              </Menu>
            )),
          ]
        : actions.map(actionButton)}
      {customActions.length
        ? props.settings.keyboardMenu.grouped
          ? <Menu title="自定义功能" systemImage="wand.and.stars">{customActions}</Menu>
          : customActions
        : null}
    </Group>
  )
}
