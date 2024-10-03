import { useEffect, useMemo, useRef, useState } from "react";
import achievementSound from "@renderer/assets/audio/achievement.wav";
import { useTranslation } from "react-i18next";
import { vars } from "@renderer/theme.css";

interface AchievementInfo {
  displayName: string;
  iconUrl: string;
}

export function Achievement() {
  const { t } = useTranslation("achievement");

  const [achievements, setAchievements] = useState<AchievementInfo[]>([]);
  const achievementAnimation = useRef(-1);

  const audio = useMemo(() => {
    const audio = new Audio(achievementSound);
    audio.volume = 0.2;
    audio.preload = "auto";
    return audio;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (_object, _shop, achievements) => {
        if (!achievements) return;

        if (achievements.length) {
          setAchievements((ach) => ach.concat(achievements));
        }

        audio.play();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [audio]);

  const hasAchievementsPending = achievements.length > 0;

  useEffect(() => {
    if (hasAchievementsPending) {
      let zero = performance.now();
      achievementAnimation.current = requestAnimationFrame(
        function animateLock(time) {
          if (time - zero > 3000) {
            zero = performance.now();
            setAchievements((ach) => ach.slice(1));
          }
          achievementAnimation.current = requestAnimationFrame(animateLock);
        }
      );
    } else {
      cancelAnimationFrame(achievementAnimation.current);
    }
  }, [hasAchievementsPending]);

  if (!hasAchievementsPending) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "8px",
        alignItems: "center",
        background: vars.color.background,
      }}
    >
      <img
        src={achievements[0].iconUrl}
        alt={achievements[0].displayName}
        style={{ width: 60, height: 60 }}
      />
      <div>
        <p>{t("achievement_unlocked")}</p>
        <p>{achievements[0].displayName}</p>
      </div>
    </div>
  );
}
