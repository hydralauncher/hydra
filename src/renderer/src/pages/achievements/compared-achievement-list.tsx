import type { ComparedAchievements } from "@types";
import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
} from "@primer/octicons-react";
import { useDate } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import "../../scss/_variables.scss";

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
          className="achievements__list-item"
          style={{
            display: "grid",
            gridTemplateColumns: achievement.ownerStat
              ? "3fr 1fr 1fr"
              : "3fr 2fr",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: `var(--spacing-unit)`,
            }}
          >
            <img
              className={classNames("achievements__list-item-image", {
                "achievements__list-item-image--unlocked":
                  achievement.ownerStat?.unlocked ||
                  achievement.targetStat.unlocked,
              })}
              src={achievement.icon}
              alt={achievement.displayName}
              loading="lazy"
            />
            <div>
              <h4 style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {achievement.hidden && (
                  <span
                    style={{ display: "flex" }}
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
                style={{
                  whiteSpace: "nowrap",
                  display: "flex",
                  flexDirection: "row",
                  gap: `var(--spacing-unit)`,
                  justifyContent: "center",
                }}
                title={formatDateTime(achievement.ownerStat.unlockTime!)}
              >
                <CheckCircleIcon />
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  padding: `var(--spacing-unit)`,
                  justifyContent: "center",
                }}
              >
                <LockIcon />
              </div>
            )
          ) : null}

          {achievement.targetStat.unlocked ? (
            <div
              style={{
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "row",
                gap: `var(--spacing-unit)`,
                justifyContent: "center",
              }}
              title={formatDateTime(achievement.targetStat.unlockTime!)}
            >
              <CheckCircleIcon />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                padding: `var(--spacing-unit)`,
                justifyContent: "center",
              }}
            >
              <LockIcon />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
