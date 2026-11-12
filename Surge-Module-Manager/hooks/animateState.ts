// 只包裹当前组件的状态提交；原生负责内容、布局与插入移除的过渡。
export const animateState = (change: () => void): void => {
  void withAnimation(Animation.smooth({ duration: 0.28, extraBounce: 0 }), change)
}
