import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import { EyeClosedIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";

type AchievementSort = "points" | "date" | "name" | "default";

interface AchievementListProps {
  achievements: UserAchievement[];
  sort?: AchievementSort;
}

export function AchievementList({
  achievements,
  sort,
}: Readonly<AchievementListProps>) {
  const { t } = useTranslation("achievement");
  const { showHydraCloudModal } = useSubscription();
  const { formatDateTime } = useDate();

  function sorter(a: UserAchievement, b: UserAchievement) {
    let diff = 0;

    if (sort === "date") {
      diff = Number(b.unlockTime) - Number(a.unlockTime);
    } else if (sort === "points") {
      diff = Number(a.points) - Number(b.points);
    } else if (sort === "name") {
      diff = a.displayName.localeCompare(b.displayName);
    } else if (sort === "default") {
      return 0;
    }

    if (diff !== 0) return diff;

    return a.displayName.localeCompare(b.displayName);
  }

  return (
    <ul className="achievements__list">
      {achievements.toSorted(sorter).map((achievement) => (
        <li key={achievement.name} className="achievements__item">
          <img
            className={`achievements__item-image ${!achievement.unlocked ? "achievements__item-image--locked" : ""}`}
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
              {achievement.hardcoreUnlockTime != null && (
                <span
                  className="achievements__item-hardcore-badge"
                  title={t("hardcore_unlocked_at", {
                    date: formatDateTime(achievement.hardcoreUnlockTime),
                  })}
                >
                  {t("hardcore")}
                </span>
              )}
            </h4>
            <p>{achievement.description}</p>
          </div>

          <div className="achievements__item-meta">
            {achievement.points != undefined ? (
              <div
                className="achievements__item-points"
                title={t("achievement_earn_points", {
                  points: achievement.points,
                })}
              >
                <HydraIcon className="achievements__item-points-icon" />
                <p className="achievements__item-points-value">
                  {achievement.points}
                </p>
              </div>
            ) : (
              <button
                onClick={() => showHydraCloudModal("achievements")}
                className="achievements__item-points achievements__item-points--locked"
                title={t("achievement_earn_points", { points: "???" })}
              >
                <HydraIcon className="achievements__item-points-icon" />
                <p className="achievements__item-points-value">???</p>
              </button>
            )}
            {achievement.unlockTime != null && (
              <div
                className="achievements__item-unlock-time"
                title={t("unlocked_at", {
                  date: formatDateTime(achievement.unlockTime),
                })}
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
