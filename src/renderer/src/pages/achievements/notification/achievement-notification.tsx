import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import {
  injectCustomCss,
  removeCustomCss,
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import { levelDBService } from "@renderer/services/leveldb.service";
import hydraIcon from "@renderer/assets/icons/hydra.svg?url";
import app from "../../../app.scss?inline";
import styles from "../../../components/achievements/notification/achievement-notification.scss?inline";
import root from "react-shadow";

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

export function AchievementNotification() {
  const { t } = useTranslation("achievement");

  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] =
    useState<AchievementCustomNotificationPosition>("top-left");
  const [themeRevision, setThemeRevision] = useState(0);

  const [achievements, setAchievements] = useState<
    QueuedAchievementNotification[]
  >([]);
  const [currentAchievement, setCurrentAchievement] =
    useState<AchievementNotificationInfo | null>(null);

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);
  const visibleAnimation = useRef(-1);
  const notificationTimeoutRef = useRef(NOTIFICATION_TIMEOUT);

  const [shadowRootRef, setShadowRootRef] = useState<HTMLElement | null>(null);

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
    const unsubscribe = globalThis.electron.onCombinedAchievementsUnlocked(
      (gameCount, achievementCount, position) => {
        if (gameCount === 0 || achievementCount === 0) return;

        setPosition(position);

        const achievement = {
          title: t("new_achievements_unlocked", {
            gameCount,
            achievementCount,
          }),
          isHidden: false,
          isRare: false,
          isPlatinum: false,
          iconUrl: hydraIcon,
        };

        setAchievements(queueAchievements(position, [achievement]));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [t]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onAchievementUnlocked(
      (position, achievements) => {
        if (!achievements?.length) return;
        if (position) {
          setPosition(position);
        }

        setAchievements((ach) =>
          ach.concat(queueAchievements(position, achievements))
        );
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onAchievementTestUnlocked(
      (nextPosition, nextAchievements) => {
        if (!nextAchievements?.length) return;

        cancelAnimationFrame(closingAnimation.current);
        cancelAnimationFrame(visibleAnimation.current);
        cancelAnimationFrame(achievementAnimation.current);
        setIsClosing(false);
        setIsVisible(false);
        setCurrentAchievement(null);
        setAchievements((queuedAchievements) => [
          ...queueAchievements(nextPosition, nextAchievements),
          ...queuedAchievements,
        ]);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const queuedAchievement = achievements[0];
  const hasAchievementsPending = achievements.length > 0;

  const startAnimateClosing = useCallback(() => {
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(visibleAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);

    setIsClosing(true);

    const zero = performance.now();
    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 450) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          setIsVisible(false);
          setAchievements((ach) => ach.slice(1));
        }
      }
    );
  }, []);

  useEffect(() => {
    if (!hasAchievementsPending || !currentAchievement) {
      return;
    }

    setIsClosing(false);
    setIsVisible(true);

    let zero = performance.now();
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(visibleAnimation.current);
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

  const handleLayout = useCallback(
    (layout: {
      position: AchievementCustomNotificationPosition;
      width: number;
      height: number;
    }) => {
      setPosition(layout.position);
      globalThis.electron
        .updateAchievementNotificationWindowPosition(
          layout.position,
          layout.width,
          layout.height
        )
        .catch(() => {});
    },
    []
  );

  const loadAndApplyTheme = useCallback(async () => {
    if (!shadowRootRef) return;
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code, shadowRootRef);
    } else {
      removeCustomCss(shadowRootRef);
    }
    setThemeRevision((revision) => revision + 1);
  }, [shadowRootRef]);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  return (
    <root.div>
      <style type="text/css">
        {app} {styles}
      </style>
      <section
        ref={setShadowRootRef}
        className={`achievement-notification-window achievement-notification-window--${position}`}
      >
        {isVisible && currentAchievement && (
          <AchievementNotificationItem
            achievement={currentAchievement}
            isClosing={isClosing}
            position={position}
            onLayout={handleLayout}
            layoutVersion={themeRevision}
          />
        )}
      </section>
    </root.div>
  );
}
