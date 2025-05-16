import { useCallback, useEffect, useRef, useState } from "react";
import achievementSound from "@renderer/assets/audio/achievement.wav";
import { useTranslation } from "react-i18next";
import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import { injectCustomCss } from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";

const NOTIFICATION_TIMEOUT = 40000;

export function AchievementNotification() {
  const { t } = useTranslation("achievement");

  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] =
    useState<AchievementCustomNotificationPosition>("top_left");

  const [achievements, setAchievements] = useState<
    AchievementNotificationInfo[]
  >([]);
  const [currentAchievement, setCurrentAchievement] =
    useState<AchievementNotificationInfo | null>(null);

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);
  const visibleAnimation = useRef(-1);

  const playAudio = useCallback(() => {
    const audio = new Audio(achievementSound);
    audio.volume = 0.1;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onCombinedAchievementsUnlocked(
      (gameCount, achievementCount, position) => {
        if (gameCount === 0 || achievementCount === 0) return;

        setPosition(position);

        setAchievements([
          {
            title: t("new_achievements_unlocked", {
              gameCount,
              achievementCount,
            }),
            isHidden: false,
            isRare: false,
            isPlatinum: false,
            points: 0,
            iconUrl: "https://cdn.losbroxas.org/favicon.svg",
          },
        ]);

        playAudio();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [t, playAudio]);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (position, achievements) => {
        if (!achievements?.length) return;
        if (position) {
          setPosition(position);
        }

        setAchievements((ach) => ach.concat(achievements));

        playAudio();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

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
    if (hasAchievementsPending) {
      setIsClosing(false);
      setIsVisible(true);

      let zero = performance.now();
      cancelAnimationFrame(closingAnimation.current);
      cancelAnimationFrame(visibleAnimation.current);
      cancelAnimationFrame(achievementAnimation.current);
      achievementAnimation.current = requestAnimationFrame(
        function animateLock(time) {
          if (time - zero > NOTIFICATION_TIMEOUT) {
            zero = performance.now();
            startAnimateClosing();
          }
          achievementAnimation.current = requestAnimationFrame(animateLock);
        }
      );
    }
  }, [hasAchievementsPending, startAnimateClosing, currentAchievement]);

  useEffect(() => {
    if (achievements.length) {
      setCurrentAchievement(achievements[0]);
    }
  }, [achievements]);

  useEffect(() => {
    const loadAndApplyTheme = async () => {
      const activeTheme = await window.electron.getActiveCustomTheme();
      console.log("activeTheme", activeTheme);
      if (activeTheme?.code) {
        injectCustomCss(activeTheme.code);
      }
    };
    loadAndApplyTheme();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onCssInjected((cssString) => {
      injectCustomCss(cssString);
    });

    return () => unsubscribe();
  }, []);

  if (!isVisible || !currentAchievement) return null;

  return (
    <AchievementNotificationItem
      currentAchievement={currentAchievement}
      isClosing={isClosing}
      position={position}
    />
  );
}
