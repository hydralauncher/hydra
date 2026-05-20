import type { UserAchievement } from "@types";
import cn from "classnames";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { Typography } from "../../../common";

export interface AchievementsBoxProps {
  achievements: UserAchievement[];
}

export function AchievementsBox({
  achievements,
}: Readonly<AchievementsBoxProps>) {
  const unlockedCount = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  return (
    <section className="game-page__achievements" aria-label="Achievements">
      <div className="game-page__achievements-title">
        <Typography>Achievements</Typography>

        <Typography className="game-page__achievements-progress">
          {unlockedCount} / {achievements.length}
        </Typography>
      </div>

      {achievements.slice(0, 6).map((achievement) => (
        <div key={achievement.name} className="game-page__achievement">
          <img
            src={achievement.icon}
            width={56}
            height={56}
            className={cn("game-page__achievement-icon", {
              "game-page__achievement-icon--locked": !achievement.unlocked,
            })}
            alt={achievement.displayName}
            loading="lazy"
          />

          <div className="game-page__achievement-info">
            <Typography className="game-page__achievement-name">
              {achievement.displayName}
            </Typography>

            <Typography className="game-page__achievement-description">
              {achievement.description}
            </Typography>
          </div>
        </div>
      ))}

      <div className="game-page__achievement-view-all">
        <div className="game-page__achievement-icon-locked">
          <EyeIcon size={24} />
        </div>

        <div className="game-page__achievement-view-all-content">
          <div className="game-page__achievement-view-all-copy">
            <Typography className="game-page__achievement-view-all-title">
              View All Achievements
            </Typography>

            <Typography className="game-page__achievement-view-all-description">
              Time to platinum!
            </Typography>
          </div>

          <Typography className="game-page__achievement-view-all-count">
            {achievements.length}
          </Typography>
        </div>
      </div>
    </section>
  );
}
