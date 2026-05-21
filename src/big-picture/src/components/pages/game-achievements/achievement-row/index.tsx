import { CheckCircleIcon, LockIcon, MedalIcon } from "@phosphor-icons/react";
import type { UserAchievement } from "@types";
import cn from "classnames";
import { useDate } from "../../../../hooks";
import { FocusItem, Tooltip, Typography } from "../../../common";
import { getAchievementRowId } from "../navigation";

export interface AchievementRowProps {
  achievement: UserAchievement;
}

export function AchievementRow({ achievement }: Readonly<AchievementRowProps>) {
  const { formatDateTime } = useDate();
  const unlockedAt =
    achievement.unlockTime != null
      ? formatDateTime(achievement.unlockTime)
      : undefined;

  return (
    <FocusItem
      id={getAchievementRowId(achievement.name)}
      actions={{ primary: "off" }}
      asChild
    >
      <li className="game-achievements-row">
        <img
          src={achievement.icon}
          width={56}
          height={56}
          alt={achievement.displayName}
          loading="lazy"
          className={cn("game-achievements-row__icon", {
            "game-achievements-row__icon--locked": !achievement.unlocked,
          })}
        />

        <div className="game-achievements-row__info">
          <Typography className="game-achievements-row__title">
            {achievement.displayName}
          </Typography>

          {achievement.hidden ? (
            <Typography className="game-achievements-row__hidden-note">
              Hidden achievement
            </Typography>
          ) : achievement.description ? (
            <Typography className="game-achievements-row__description">
              {achievement.description}
            </Typography>
          ) : null}
        </div>

        <div className="game-achievements-row__meta">
          {achievement.points != undefined ? (
            <div
              className="game-achievements-row__points"
              title={`Earn ${achievement.points} points with this achievement`}
            >
              <MedalIcon size={16} weight="fill" />
              <span>{achievement.points}</span>
            </div>
          ) : null}

          <div className="game-achievements-row__status">
            {achievement.unlocked ? (
              <Tooltip
                content={unlockedAt ?? ""}
                position="left"
                active={unlockedAt != undefined}
              >
                <CheckCircleIcon size={24} />
              </Tooltip>
            ) : (
              <LockIcon size={24} />
            )}
          </div>
        </div>
      </li>
    </FocusItem>
  );
}
