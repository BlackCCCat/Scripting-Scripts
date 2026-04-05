import { TranslationPanel } from "./components/TranslationPanel"
import { getTranslationSessionSnapshot, presentTranslationUI } from "./utils/translation_session"

const session = getTranslationSessionSnapshot()

presentTranslationUI(
  <TranslationPanel
    inputText={session.inputText}
    allowsReplacement={session.allowsReplacement}
  />
)
