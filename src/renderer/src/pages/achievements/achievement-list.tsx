import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import * as styles from "./achievements.css";

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({ achievements }: AchievementListProps) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  return (
    <ul className={styles.list}>
      {achievements.map((achievement, index) => (
        <li key={index} className={styles.listItem} style={{ display: "flex" }}>
          <img
            className={styles.listItemImage({
              unlocked: achievement.unlocked,
            })}
            src={achievement.icon}
            alt={achievement.displayName}
            loading="lazy"
          />
          <div style={{ flex: 1 }}>
            <h4>{achievement.displayName}</h4>
            <p>{achievement.description}</p>
          </div>
          {achievement.unlockTime && (
            <div style={{ whiteSpace: "nowrap" }}>
              <small>{t("unlocked_at")}</small>
              <p>{formatDateTime(achievement.unlockTime)}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
