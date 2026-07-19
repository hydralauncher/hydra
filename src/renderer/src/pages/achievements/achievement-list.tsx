import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import { EyeClosedIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { useState, useMemo } from "react";

const FALLBACK_ICON = "/assets/unknown-achievement.png";

const ALLOWED_HOSTNAMES = new Set(["cdn.akamaihd.net", "steamcommunity.com"]);

function isValidSteamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return ALLOWED_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

interface AchievementListProps {
  achievements: UserAchievement[];
  isRefreshing?: boolean;
}

export function AchievementList({
  achievements,
  isRefreshing = false,
}: Readonly<AchievementListProps>) {
  const { t } = useTranslation("achievement");
  const { showHydraCloudModal } = useSubscription();
  const { formatDateTime } = useDate();
  const [iconErrors, setIconErrors] = useState<Set<string>>(new Set());

  const handleIconError = (achievementName: string) => {
    setIconErrors((prev) => new Set(prev).add(achievementName));
  };

  const getValidatedIcon = useMemo(
    () => (achievement: UserAchievement) => {
      const hasError = iconErrors.has(achievement.name);
      let iconUrl: string;

      if (!achievement.unlocked && !hasError) {
        iconUrl = achievement.icongray || achievement.icon;
      } else {
        iconUrl = achievement.icon;
      }

      if (!isValidSteamUrl(iconUrl)) {
        return FALLBACK_ICON;
      }

      return iconUrl;
    },
    [iconErrors]
  );

  if (isRefreshing) {
    return (
      <ul className="achievements__list achievements__list--loading">
        {achievements.map((achievement) => (
          <li
            key={achievement.name}
            className="achievements__item achievements__item--skeleton"
          >
            <div className="achievements__item-image-skeleton" />
            <div className="achievements__item-content-skeleton">
              <div className="achievements__item-title-skeleton" />
              <div className="achievements__item-description-skeleton" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="achievements__list">
      {achievements.map((achievement) => (
        <li key={achievement.name} className="achievements__item">
          <img
            className={`achievements__item-image ${!achievement.unlocked ? "achievements__item-image--locked" : ""}`}
            src={getValidatedIcon(achievement)}
            alt={achievement.displayName}
            loading="lazy"
            onError={() => handleIconError(achievement.name)}
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
