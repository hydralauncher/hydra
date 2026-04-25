import type { UserAchievement } from "@types";
import { Link } from "react-router-dom";
import { Box, FocusItem, Typography } from "../../../common";
import cn from "classnames";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr";
import {
  GAME_ACHIEVEMENTS_TITLE_ID,
  GAME_ACHIEVEMENTS_VIEW_ALL_ID,
  GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID,
  GAME_SCREENSHOT_CAROUSEL_NEXT_BUTTON_ID,
  GAME_SCREENSHOT_CAROUSEL_PREV_BUTTON_ID,
} from "../navigation";
import { FocusOverrides } from "src/big-picture/src/services/navigation.service";

export interface AchievementsBoxProps {
  achievements: UserAchievement[];
}

export function AchievementsBox({
  achievements,
}: Readonly<AchievementsBoxProps>) {
  const achievementsNavigationOverrides: FocusOverrides = {
    down: {
      type: "item",
      itemId: GAME_ACHIEVEMENTS_VIEW_ALL_ID,
    },
    right: {
      type: "block",
    },
    left: {
      type: "item",
      itemId: GAME_SCREENSHOT_CAROUSEL_NEXT_BUTTON_ID,
    },
  };

  const viewAllNavigationOverrides: FocusOverrides = {
    up: {
      type: "item",
      itemId: GAME_ACHIEVEMENTS_TITLE_ID,
    },
    left: {
      type: "item",
      itemId: GAME_SCREENSHOT_CAROUSEL_PREV_BUTTON_ID,
    },
    right: {
      type: "block",
    },
    down: {
      type: "item",
      itemId: GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID,
    },
  };

  return (
    <div className="game-page__box-group">
      <FocusItem
        id={GAME_ACHIEVEMENTS_TITLE_ID}
        navigationOverrides={achievementsNavigationOverrides}
        asChild
      >
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
            <FocusItem
              id={GAME_ACHIEVEMENTS_VIEW_ALL_ID}
              navigationOverrides={viewAllNavigationOverrides}
            >
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
