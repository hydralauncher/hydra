import { useCallback, useEffect, useRef, useState } from "react";
import achievementSound from "@renderer/assets/audio/achievement.wav";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import "./achievement-notification.scss";
import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";

const NOTIFICATION_TIMEOUT = 6000;

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
            iconUrl:
              "https://avatars.githubusercontent.com/u/164102380?s=400&u=01a13a7b4f0c642f7e547b8e1d70440ea06fa750&v=4",
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
  }, [hasAchievementsPending, startAnimateClosing]);

  useEffect(() => {
    if (achievements.length) {
      setCurrentAchievement(achievements[0]);
    }
  }, [achievements]);

  if (!isVisible || !currentAchievement) return null;

  return (
    <div
      className={cn("achievement-notification", {
        [position]: true,
        closing: isClosing,
      })}
    >
      <div
        className={cn("achievement-notification__container", {
          closing: isClosing,
          [position]: true,
        })}
      >
        <div className="achievement-notification__content">
          <img
            src={currentAchievement.iconUrl}
            alt={currentAchievement.title}
            className="achievement-notification__icon"
          />
          <div className="achievement-notification__text-container">
            <p className="achievement-notification__title">
              {currentAchievement.title}
            </p>
            <p className="achievement-notification__description">
              {currentAchievement.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
