import { useLayoutEffect, useRef } from "react";

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
      animation.playState === "paused"
    ) {
      continue;
    }

    animation.pause();
    paused.push(animation);
  }

  return paused;
};

export const resumeNotificationAnimations = (
  animations: readonly NotificationAnimation[]
): void => {
  for (const animation of animations) {
    animation.currentTime = 0;
    animation.play();
  }
};

export const useClosingPseudoAnimations = (
  container: ParentNode | null,
  isClosing: boolean
): void => {
  const paused = useRef<NotificationAnimation[]>([]);

  useLayoutEffect(() => {
    if (isClosing) {
      const card =
        container?.querySelector(".achievement-notification") ?? null;
      paused.current = pauseNotificationPseudoAnimations(card);
      return;
    }

    if (!paused.current.length) return;

    const animations = paused.current;
    paused.current = [];
    resumeNotificationAnimations(animations);
  }, [container, isClosing]);
};
