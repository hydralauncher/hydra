import type { GameShop, UserAchievement } from "@types";
import cn from "classnames";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { Link, useParams } from "react-router-dom";
import type { FocusOverrides } from "../../../../services";
import { getBigPictureGameAchievementsPath } from "../../../../helpers";
import { FocusItem, Typography } from "../../../common";

export interface AchievementsBoxProps {
  achievements: UserAchievement[];
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function AchievementsBox({
  achievements,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<AchievementsBoxProps>) {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const unlockedCount = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;
  const achievementsPath =
    shop && objectId
      ? getBigPictureGameAchievementsPath({ shop, objectId })
      : "#";

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <Link
        to={achievementsPath}
        className="game-page__sidebar-section game-page__achievements"
        aria-label="Achievements"
      >
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
      </Link>
    </FocusItem>
  );
}
