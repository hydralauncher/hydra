import {
  restartNotificationAnimations,
  type NotificationAnimation,
  type NotificationAnimationTarget,
} from "../../../helpers/notification-animations.js";

export interface ArmingScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

interface ArmNotificationAnimationsOptions {
  card: NotificationAnimationTarget | null;
  scheduler: ArmingScheduler;
  timeoutMs: number;
  onArmed: () => void;
  onTimeout: () => void;
  canPlayWithoutFrames: () => boolean;
}

export const armNotificationAnimations = ({
  card,
  scheduler,
  timeoutMs,
  onArmed,
  onTimeout,
  canPlayWithoutFrames,
}: ArmNotificationAnimationsOptions): (() => void) => {
  const animations = card?.getAnimations({ subtree: true }) ?? [];
  const paused = new Set<NotificationAnimation>();

  for (const animation of animations) {
    if (animation.playState === "paused") continue;
    animation.pause();
    animation.currentTime = 0;
    paused.add(animation);
  }

  let done = false;
  let firstFrameSeen = false;
  let retried = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let timeout = 0;

  const clearScheduled = () => {
    scheduler.clearTimeout(timeout);
    scheduler.cancelFrame(firstFrame);
    scheduler.cancelFrame(secondFrame);
  };

  const waitForFrames = () => {
    scheduler.cancelFrame(firstFrame);
    firstFrame = scheduler.requestFrame(() => {
      firstFrameSeen = true;
      secondFrame = scheduler.requestFrame(finishFrames);
    });
  };

  const finishFrames = () => {
    if (done) return;
    done = true;
    clearScheduled();

    const currentAnimations = card?.getAnimations({ subtree: true }) ?? [];
    const animationsToResume = currentAnimations.filter(
      (animation) => animation.playState !== "paused" || paused.has(animation)
    );

    restartNotificationAnimations(animationsToResume);

    onArmed();
  };

  const handleTimeout = () => {
    if (done) return;

    if (firstFrameSeen) {
      finishFrames();
      return;
    }

    if (!canPlayWithoutFrames()) {
      done = true;
      clearScheduled();
      onTimeout();
      return;
    }

    if (retried) {
      finishFrames();
      return;
    }

    retried = true;
    waitForFrames();
    timeout = scheduler.setTimeout(handleTimeout, timeoutMs);
  };

  timeout = scheduler.setTimeout(handleTimeout, timeoutMs);
  waitForFrames();

  return () => {
    if (done) return;
    done = true;
    clearScheduled();
  };
};
