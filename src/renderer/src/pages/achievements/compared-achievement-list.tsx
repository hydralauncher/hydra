import type { ComparedAchievements } from "@types";
import * as styles from "./achievements.css";
import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
} from "@primer/octicons-react";
import { useDate } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
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
    <ul className={styles.list}>
      {achievements.achievements.map((achievement, index) => (
        <li
          key={index}
          className={styles.listItem}
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
              gap: `${SPACING_UNIT}px`,
            }}
          >
            <img
              className={styles.listItemImage({
                unlocked: true,
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
                  gap: `${SPACING_UNIT}px`,
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
                  padding: `${SPACING_UNIT}px`,
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
                gap: `${SPACING_UNIT}px`,
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
                padding: `${SPACING_UNIT}px`,
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
