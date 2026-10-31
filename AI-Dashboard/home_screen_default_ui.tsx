import { NamespaceReader, NavigationStack } from "scripting"
import { DashboardRootView } from "./components/DashboardRootView"

export default function HomeScreenDefaultUI() {
  return (
    <NamespaceReader>
      {(namespace) => (
        <NavigationStack>
          <DashboardRootView isHomeScreen={true} zoomNamespace={namespace} />
        </NavigationStack>
      )}
    </NamespaceReader>
  )
}
