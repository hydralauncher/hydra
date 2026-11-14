export interface NotificationAnimation {
  currentTime: unknown;
  animationName?: string;
  effect?: object | null;
  playState: string;
  pause(): void;
  play(): void;
}

export interface NotificationAnimationTarget {
  getAnimations(options: {
    subtree: boolean;
  }): readonly NotificationAnimation[];
}

export const pauseNotificationPseudoAnimations = (
  target: NotificationAnimationTarget | null
): NotificationAnimation[] => {
  const animations = target?.getAnimations({ subtree: true }) ?? [];
  const paused: NotificationAnimation[] = [];

  for (const animation of animations) {
    const effect = animation.effect as
      | { pseudoElement?: string | null }
      | null
      | undefined;

    if (
      animation.animationName === undefined ||
      !effect?.pseudoElement ||
      animation.playState === "paused" ||
      animation.playState === "idle"
    ) {
      continue;
    }

    animation.pause();
    paused.push(animation);
  }

  return paused;
};

export const restartNotificationAnimations = (
  animations: readonly NotificationAnimation[]
): void => {
  for (const animation of animations) {
    if (animation.playState === "idle") continue;
    animation.currentTime = 0;
    animation.play();
  }
};
