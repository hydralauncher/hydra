import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import achievementSound from "@renderer/assets/audio/achievement.wav";
import { useTranslation } from "react-i18next";
import * as styles from "./achievement.css";

interface AchievementInfo {
  displayName: string;
  iconUrl: string;
}

const NOTIFICATION_TIMEOUT = 4000;

export function Achievement() {
  const { t } = useTranslation("achievement");

  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const [achievements, setAchievements] = useState<AchievementInfo[]>([]);
  const [currentAchievement, setCurrentAchievement] =
    useState<AchievementInfo | null>(null);

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);
  const visibleAnimation = useRef(-1);

  const audio = useMemo(() => {
    const audio = new Audio(achievementSound);
    audio.volume = 0.2;
    audio.preload = "auto";
    return audio;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (_object, _shop, achievements) => {
        if (!achievements || !achievements.length) return;

        setAchievements((ach) => ach.concat(achievements));

        audio.play();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [audio]);

  const hasAchievementsPending = achievements.length > 0;

  const startAnimateClosing = useCallback(() => {
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(visibleAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);

    setIsClosing(true);

    const zero = performance.now();
    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 1000) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          setIsVisible(false);
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
            setAchievements((ach) => ach.slice(1));
          }
          achievementAnimation.current = requestAnimationFrame(animateLock);
        }
      );
    } else {
      startAnimateClosing();
    }
  }, [hasAchievementsPending]);

  useEffect(() => {
    if (achievements.length) {
      setCurrentAchievement(achievements[0]);
    }
  }, [achievements]);

  if (!isVisible || !currentAchievement) return null;

  return (
    <div className={styles.container({ closing: isClosing })}>
      <div className={styles.content}>
        <img
          src={currentAchievement.iconUrl}
          alt={currentAchievement.displayName}
          style={{ flex: 1, width: "60px" }}
        />
        <div>
          <p>{t("achievement_unlocked")}</p>
          <p>{currentAchievement.displayName}</p>
        </div>
      </div>
    </div>
  );
}
