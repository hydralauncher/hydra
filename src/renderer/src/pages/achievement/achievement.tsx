import { useEffect, useState } from "react";

export function Achievemnt() {
  const [achievementInfo, setAchievementInfo] = useState<{
    displayName: string;
    icon: string;
  } | null>(null);

  const [audio, setAudio] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(
      (_object, _shop, displayName, icon) => {
        console.log("Achievement unlocked", displayName, icon);
        setAudio(
          "https://us-tuna-sounds-files.voicemod.net/ade71f0d-a41b-4e3a-8097-9f1cc585745c-1646035604239.mp3"
        );

        setAchievementInfo({
          displayName,
          icon,
        });
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (audio) {
      const audioElement = new Audio(audio);
      audioElement.volume = 1.0;
      audioElement.play();
      setAudio(null);
    }
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
