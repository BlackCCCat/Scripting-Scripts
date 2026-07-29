import { NavigationStack } from "scripting"
import { AppRoot } from "./components/AppRoot"

export default function HomeScreenView() {
  return (
    <NavigationStack>
      <AppRoot mode="home" />
    </NavigationStack>
  )
}
