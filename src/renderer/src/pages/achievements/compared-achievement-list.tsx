import type { ComparedAchievements } from "@types";
import * as styles from "./achievements.css";
import { CheckCircleIcon, LockIcon } from "@primer/octicons-react";
import { useDate } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";

export interface ComparedAchievementListProps {
  achievements: ComparedAchievements;
}

export function ComparedAchievementList({
  achievements,
}: ComparedAchievementListProps) {
  const { formatDateTime } = useDate();

  return (
    <ul className={styles.list}>
      {achievements.achievements.map((achievement, index) => (
        <li
          key={index}
          className={styles.listItem}
          style={{
            display: "grid",
            gridTemplateColumns: achievement.onwerUserStat
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
              <h4>{achievement.displayName}</h4>
              <p>{achievement.description}</p>
            </div>
          </div>

          {achievement.onwerUserStat ? (
            achievement.onwerUserStat.unlocked ? (
              <div
                style={{
                  whiteSpace: "nowrap",
                  display: "flex",
                  flexDirection: "row",
                  gap: `${SPACING_UNIT}px`,
                  justifyContent: "center",
                }}
              >
                <CheckCircleIcon />
                <small>
                  {formatDateTime(achievement.onwerUserStat.unlockTime!)}
                </small>
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

          {achievement.otherUserStat.unlocked ? (
            <div
              style={{
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "row",
                gap: `${SPACING_UNIT}px`,
                justifyContent: "center",
              }}
            >
              <CheckCircleIcon />
              <small>
                {formatDateTime(achievement.otherUserStat.unlockTime!)}
              </small>
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
