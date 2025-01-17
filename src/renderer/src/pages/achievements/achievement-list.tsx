import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import { EyeClosedIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./achievements.scss";
import "../../scss/_variables.scss";

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({ achievements }: AchievementListProps) {
  const { t } = useTranslation("achievement");
  const { showHydraCloudModal } = useSubscription();
  const { formatDateTime } = useDate();

  return (
    <ul className="achievements__list">
      {achievements.map((achievement) => (
        <li
          key={achievement.name}
          className="achievements__list-item"
          style={{ display: "flex" }}
        >
          <img
            className={classNames("achievements__list-item-image", {
              "achievements__list-item-image--unlocked": achievement.unlocked,
            })}
            src={achievement.icon}
            alt={achievement.displayName}
            loading="lazy"
          />

          <div style={{ flex: 1 }}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {achievement.points != undefined ? (
              <div
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
                title={t("achievement_earn_points", {
                  points: achievement.points,
                })}
              >
                <HydraIcon width={20} height={20} />
                <p style={{ fontSize: "1.1em" }}>{achievement.points}</p>
              </div>
            ) : (
              <button
                onClick={() => showHydraCloudModal("achievements")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                  color: "var(--warning-color)",
                }}
                title={t("achievement_earn_points", {
                  points: "???",
                })}
              >
                <HydraIcon width={20} height={20} />
                <p style={{ fontSize: "1.1em" }}>???</p>
              </button>
            )}
            {achievement.unlockTime != null && (
              <div
                title={t("unlocked_at", {
                  date: formatDateTime(achievement.unlockTime),
                })}
                style={{ whiteSpace: "nowrap", gap: "4px", display: "flex" }}
              >
                <small>{formatDateTime(achievement.unlockTime)}</small>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
