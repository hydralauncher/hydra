import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OverlayGameInfo, UserAchievement } from "@types";

import { AchievementList } from "../achievements/achievement-list";

interface OverlayAchievementsProps {
  game: OverlayGameInfo;
  achievements: UserAchievement[];
  showHeader?: boolean;
}

export function OverlayAchievements({
  game,
  achievements,
  showHeader = true,
}: Readonly<OverlayAchievementsProps>) {
  const { t } = useTranslation("overlay");
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  const unlocked = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  return (
    <div
      ref={setScrollElement}
      className="overlay-achievements"
      aria-label={t("achievements")}
    >
      {showHeader && (
        <header className="overlay-achievements__header">
          <div className="overlay-achievements__heading">
            <h2 className="overlay-achievements__title">{game.title}</h2>
            <span className="overlay-achievements__progress">
              {t("achievements_progress", {
                unlocked,
                total: achievements.length,
              })}
            </span>
          </div>
        </header>
      )}

      <AchievementList
        achievements={achievements}
        scrollElement={scrollElement}
        compact
      />
    </div>
  );
}
