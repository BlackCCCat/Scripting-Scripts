import { NamespaceReader, NavigationStack } from "scripting"
import { AppRoot } from "./components/AppRoot"

export default function HomeScreenView() {
  return (
    <NamespaceReader>
      {(namespace) => (
        <NavigationStack>
          <AppRoot mode="home" zoomNamespace={namespace} />
        </NavigationStack>
      )}
    </NamespaceReader>
  )
}
