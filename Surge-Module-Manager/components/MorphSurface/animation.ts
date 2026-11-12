// Shared default; callers can supply another native animation factory.
export const surfaceMorphDuration = 0.43
export const surfaceMorphAnimation = (): Animation => Animation.spring({ duration: surfaceMorphDuration, bounce: 0.02 })
