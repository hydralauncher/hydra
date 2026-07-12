import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { AchievementNotificationItem } from "./achievement-notification";

const NOTIFICATION_TIMEOUT = 4000;
const fallbackPosition: AchievementCustomNotificationPosition = "top-left";

type QueuedAchievementNotification = {
  achievement: AchievementNotificationInfo;
  position: AchievementCustomNotificationPosition;
};

const queueAchievements = (
  position: AchievementCustomNotificationPosition | undefined,
  achievements: AchievementNotificationInfo[]
): QueuedAchievementNotification[] => {
  return achievements.map((achievement) => ({
    achievement,
    position: position ?? fallbackPosition,
  }));
};

const anchorByPosition: Record<
  AchievementCustomNotificationPosition,
  Pick<CSSProperties, "justifyContent" | "alignItems">
> = {
  "top-left": { justifyContent: "flex-start", alignItems: "flex-start" },
  "top-center": { justifyContent: "center", alignItems: "flex-start" },
  "top-right": { justifyContent: "flex-end", alignItems: "flex-start" },
  "bottom-left": { justifyContent: "flex-start", alignItems: "flex-end" },
  "bottom-center": { justifyContent: "center", alignItems: "flex-end" },
  "bottom-right": { justifyContent: "flex-end", alignItems: "flex-end" },
};

export function AchievementNotificationOverlay() {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] =
    useState<AchievementCustomNotificationPosition>("top-left");
  const [achievements, setAchievements] = useState<
    QueuedAchievementNotification[]
  >([]);
  const [currentAchievement, setCurrentAchievement] =
    useState<AchievementNotificationInfo | null>(null);

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);
  const notificationTimeoutRef = useRef(NOTIFICATION_TIMEOUT);

  const playAudio = useCallback(
    async (achievement: AchievementNotificationInfo) => {
      const soundUrl = await getAchievementSoundUrl(achievement);
      if (!soundUrl) return;
      const volume = await getAchievementSoundVolume(achievement);
      const audio = new Audio(soundUrl);
      audio.volume = volume;
      audio.play();
    },
    []
  );

  useEffect(() => {
    const onInAppAchievementUnlocked =
      globalThis.electron.onInAppAchievementUnlocked;

    // Compatibility guard for remote renderer/preload releases on different commits.
    if (typeof onInAppAchievementUnlocked !== "function") {
      return () => {};
    }

    const unsubscribe = onInAppAchievementUnlocked(
      (nextPosition, nextAchievements) => {
        if (!nextAchievements?.length) return;
        if (nextPosition) setPosition(nextPosition);
        setAchievements((current) =>
          current.concat(queueAchievements(nextPosition, nextAchievements))
        );
      }
    );

    return () => unsubscribe();
  }, []);

  const queuedAchievement = achievements[0];
  const hasAchievementsPending = achievements.length > 0;

  const startAnimateClosing = useCallback(() => {
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);

    setIsClosing(true);

    const zero = performance.now();
    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 450) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          setIsVisible(false);
          setAchievements((current) => current.slice(1));
        }
      }
    );
  }, []);

  useEffect(() => {
    if (!hasAchievementsPending || !currentAchievement) return;

    setIsClosing(false);
    setIsVisible(true);

    let zero = performance.now();
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);
    achievementAnimation.current = requestAnimationFrame(
      function animateLock(time) {
        if (time - zero > notificationTimeoutRef.current) {
          zero = performance.now();
          startAnimateClosing();
        }
        achievementAnimation.current = requestAnimationFrame(animateLock);
      }
    );
  }, [hasAchievementsPending, startAnimateClosing, currentAchievement]);

  useEffect(() => {
    if (!queuedAchievement) {
      setCurrentAchievement(null);
      return;
    }

    setPosition(queuedAchievement.position);
    notificationTimeoutRef.current = NOTIFICATION_TIMEOUT;
    setCurrentAchievement(queuedAchievement.achievement);
    playAudio(queuedAchievement.achievement);
  }, [queuedAchievement, playAudio]);

  if (!isVisible || !currentAchievement) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        pointerEvents: "none",
        zIndex: 999999,
        ...anchorByPosition[position],
      }}
    >
      <AchievementNotificationItem
        achievement={currentAchievement}
        isClosing={isClosing}
        position={position}
        onLayout={(layout) => setPosition(layout.position)}
      />
    </div>
  );
}
