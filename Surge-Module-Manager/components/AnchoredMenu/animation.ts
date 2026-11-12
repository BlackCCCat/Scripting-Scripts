// TG ContextController spring: m=5,k=900,c=104. Preserve existing native adaptation.
export const anchoredMenuAnimation = (): Animation => Animation.spring({ duration: 0.42, bounce: 1 - 104 / (2 * Math.sqrt(5 * 900)) })
