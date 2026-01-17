import type { ComparedAchievements } from "@types";
import "./achievements.scss";
import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
} from "@primer/octicons-react";
import { useDate } from "@renderer/hooks";
import { useTranslation } from "react-i18next";

export interface ComparedAchievementListProps {
  achievements: ComparedAchievements;
}

export function ComparedAchievementList({
  achievements,
}: ComparedAchievementListProps) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  return (
    <ul className="achievements__list">
      {achievements.achievements.map((achievement, index) => (
        <li
          key={index}
          className={`achievements__item achievements__item-compared ${
            !achievement.ownerStat && "achievements__item-compared--no-owner"
          }`}
        >
          <div className="achievements__item-main">
            <img
              className="achievements__item-image"
              src={achievement.icon}
              alt={achievement.displayName}
              loading="lazy"
            />
            <div className="achievements__item-content">
              <h4 className="achievements__item-title">
                {achievement.hidden && (
                  <span
                    className="achievements__item-hidden-icon"
                    title={t("hidden_achievement_tooltip")}
                  >
                    <EyeClosedIcon size={12} />
                  </span>
                )}
                {achievement.displayName}
              </h4>
              <p>{achievement.description}</p>
            </div>
          </div>

          {achievement.ownerStat ? (
            achievement.ownerStat.unlocked ? (
              <div
                className="achievements__item-status achievements__item-status--unlocked"
                title={formatDateTime(achievement.ownerStat.unlockTime!)}
              >
                <CheckCircleIcon />
              </div>
            ) : (
              <div className="achievements__item-status">
                <LockIcon />
              </div>
            )
          ) : null}

          {achievement.targetStat.unlocked ? (
            <div
              className="achievements__item-status achievements__item-status--unlocked"
              title={formatDateTime(achievement.targetStat.unlockTime!)}
            >
              <CheckCircleIcon />
            </div>
          ) : (
            <div className="achievements__item-status">
              <LockIcon />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
