declare const TranslationUIProvider: {
  readonly inputText: string | null
  readonly allowsReplacement: boolean
  present(node: any): void
  finish(translation?: string | null): void
}

export function getTranslationSessionSnapshot() {
  return {
    inputText: TranslationUIProvider.inputText,
    allowsReplacement: TranslationUIProvider.allowsReplacement,
  }
}

export function presentTranslationUI(node: any) {
  TranslationUIProvider.present(node)
}

export function finishTranslation(translation?: string | null) {
  TranslationUIProvider.finish(translation)
}
