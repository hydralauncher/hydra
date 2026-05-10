import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
  MedalIcon,
} from "@phosphor-icons/react";
import type { UserAchievement } from "@types";
import cn from "classnames";
import { useDate } from "../../../../hooks";
import { FocusItem, Typography } from "../../../common";
import { getAchievementRowId } from "../navigation";

export interface AchievementRowProps {
  achievement: UserAchievement;
}

export function AchievementRow({ achievement }: Readonly<AchievementRowProps>) {
  const { formatDateTime } = useDate();

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
            {achievement.hidden ? (
              <span
                className="game-achievements-row__hidden-icon"
                title="Hidden achievement"
              >
                <EyeClosedIcon size={12} />
              </span>
            ) : null}
            {achievement.displayName}
          </Typography>

          {achievement.description ? (
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

          {achievement.unlocked && achievement.unlockTime != null ? (
            <span className="game-achievements-row__unlock-time">
              {formatDateTime(achievement.unlockTime)}
            </span>
          ) : null}

          <div className="game-achievements-row__status">
            {achievement.unlocked ? (
              <CheckCircleIcon size={24} weight="fill" />
            ) : (
              <LockIcon size={24} />
            )}
          </div>
        </div>
      </li>
    </FocusItem>
  );
}
