import { useEffect, useMemo, useState } from "react";
import achievementSound from "@renderer/assets/audio/achievement.wav";
import { useTranslation } from "react-i18next";

export function Achievemnt() {
  const { t } = useTranslation("achievement");

  const [achievementInfo, setAchievementInfo] = useState<{
    displayName: string;
    icon: string;
  } | null>(null);

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
          const achievement = achievements[0];
          setAchievementInfo({
            displayName: achievement.displayName,
            icon: achievement.iconUrl,
          });
        }

        audio.play();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [audio]);

  if (!achievementInfo) return <p>Nada</p>;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "8px",
        alignItems: "center",
      }}
    >
      <img
        src={achievementInfo.icon}
        alt={achievementInfo.displayName}
        style={{ width: 60, height: 60 }}
      />
      <div>
        <p>{t("achievement_unlocked")}</p>
        <p>{achievementInfo.displayName}</p>
      </div>
    </div>
  );
}
