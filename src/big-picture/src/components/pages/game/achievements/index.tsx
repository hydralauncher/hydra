import type { UserAchievement } from "@types";
import { Link } from "react-router-dom";
import { Box, FocusItem, Typography } from "../../../common";
import cn from "classnames";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr";

export interface AchievementsBoxProps {
  achievements: UserAchievement[];
}

export function AchievementsBox({
  achievements,
}: Readonly<AchievementsBoxProps>) {
  return (
    <div className="game-page__box-group">
      <FocusItem asChild>
        <div className="game-page__achievements-title">
          <Typography>Achievements</Typography>

          <span>
            {achievements.filter((achievement) => achievement.unlocked).length}{" "}
            / {achievements.length}
          </span>
        </div>
      </FocusItem>

      {achievements.slice(0, 5).map((achievement) => (
        <Box key={achievement.name} className="game-page__achievement">
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
            <Typography>{achievement.displayName}</Typography>

            <Typography style={{ color: "rgba(255, 255, 255, 0.5)" }}>
              {achievement.description}
            </Typography>
          </div>
        </Box>
      ))}

      <Box className="game-page__achievement-box">
        <div className="game-page__achievement-icon-locked">
          <EyeIcon size={24} />
        </div>

        <div className="game-page__achievement-box-content">
          <div className="game-page__achievement-box-link">
            <FocusItem>
              <Link to="/big-picture/library">
                <Typography>View All Achievements</Typography>
              </Link>
            </FocusItem>
            <span>Time to platinum!</span>
          </div>

          <span>{achievements.length}</span>
        </div>
      </Box>
    </div>
  );
}
