import type {
  NotificationAnimation,
  NotificationAnimationTarget,
} from "../../../helpers/notification-animations.js";

export type ArmingAnimation = NotificationAnimation;
export type ArmingCard = NotificationAnimationTarget;
export { cancelNotificationPseudoAnimations as cancelNotificationAnimations } from "../../../helpers/notification-animations.js";

export interface ArmingScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

interface ArmNotificationAnimationsOptions {
  card: ArmingCard | null;
  scheduler: ArmingScheduler;
  timeoutMs: number;
  onArmed: () => void;
}

export const armNotificationAnimations = ({
  card,
  scheduler,
  timeoutMs,
  onArmed,
}: ArmNotificationAnimationsOptions): (() => void) => {
  const animations = card?.getAnimations({ subtree: true }) ?? [];
  const paused = new Set<ArmingAnimation>();

  for (const animation of animations) {
    if (animation.playState === "paused") continue;
    animation.pause();
    animation.currentTime = 0;
    paused.add(animation);
  }

  let settled = false;
  let cancelled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let timeout = 0;

  const clearScheduled = () => {
    scheduler.clearTimeout(timeout);
    scheduler.cancelFrame(firstFrame);
    scheduler.cancelFrame(secondFrame);
  };

  const finish = () => {
    if (settled || cancelled) return;
    settled = true;
    clearScheduled();

    const currentAnimations = card?.getAnimations({ subtree: true }) ?? [];

    for (const animation of currentAnimations) {
      if (animation.playState === "paused" && !paused.has(animation)) {
        continue;
      }

      animation.currentTime = 0;
      animation.play();
    }

    onArmed();
  };

  timeout = scheduler.setTimeout(finish, timeoutMs);
  firstFrame = scheduler.requestFrame(() => {
    secondFrame = scheduler.requestFrame(finish);
  });

  return () => {
    if (cancelled) return;
    cancelled = true;
    clearScheduled();
  };
};
