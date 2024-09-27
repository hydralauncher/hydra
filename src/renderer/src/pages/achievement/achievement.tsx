import { useEffect, useMemo, useState } from "react";

export function Achievemnt() {
  const [achievementInfo, setAchievementInfo] = useState<{
    displayName: string;
    icon: string;
  } | null>(null);

  const audio = useMemo(() => {
    const audio = new Audio(
      "https://cms-public-artifacts.artlist.io/content/sfx/aac/94201_690187_Classics_-_Achievement_Unlocked_-_MASTERED_-_2496.aac"
    );

    audio.preload = "auto";
    return audio;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (_object, _shop, displayName, icon) => {
        setAchievementInfo({
          displayName,
          icon,
        });

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
        <p>Achievement unlocked</p>
        <p>{achievementInfo.displayName}</p>
      </div>
    </div>
  );
}
