export interface NotificationAnimation {
  currentTime: unknown;
  animationName?: string;
  effect?: object | null;
  playState: string;
  cancel(): void;
  pause(): void;
  play(): void;
}

export interface NotificationAnimationTarget {
  getAnimations(options: {
    subtree: boolean;
  }): readonly NotificationAnimation[];
}

export const cancelNotificationPseudoAnimations = (
  target: NotificationAnimationTarget | null
): void => {
  const animations = target?.getAnimations({ subtree: true }) ?? [];

  for (const animation of animations) {
    const effect = animation.effect as
      | { pseudoElement?: string | null }
      | null
      | undefined;

    if (animation.animationName === undefined || !effect?.pseudoElement) {
      continue;
    }

    animation.cancel();
  }
};
