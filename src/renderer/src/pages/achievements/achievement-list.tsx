import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import { EyeClosedIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { useState, useCallback, useEffect } from "react";

const FALLBACK_ICON = "/assets/unknown-achievement.png";

const ALLOWED_HOSTNAMES = new Set(["steamcommunity.com"]);

function isAkamaiCdnHostname(hostname: string): boolean {
  return hostname.endsWith(".akamaihd.net");
}

function isValidSteamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return (
      ALLOWED_HOSTNAMES.has(parsed.hostname) ||
      isAkamaiCdnHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

const ICON_PHASE = {
  FIRST_ATTEMPT: 0,
  LOCKED_SECOND_ATTEMPT: 1,
  FALLBACK: 2,
} as const;

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
  const [iconErrorPhase, setIconErrorPhase] = useState<Record<string, number>>(
    {}
  );

  useEffect(() => {
    setIconErrorPhase({});
  }, [achievements]);

  const handleIconError = useCallback((achievementName: string) => {
    setIconErrorPhase((prev) => ({
      ...prev,
      [achievementName]: (prev[achievementName] || 0) + 1,
    }));
  }, []);

  const getValidatedIcon = useCallback(
    (achievement: UserAchievement) => {
      const phase = iconErrorPhase[achievement.name] || 0;
      let iconUrl: string;

      if (!achievement.unlocked) {
        if (phase === ICON_PHASE.FIRST_ATTEMPT) {
          iconUrl = achievement.icongray || achievement.icon;
        } else if (phase === ICON_PHASE.LOCKED_SECOND_ATTEMPT) {
          iconUrl = achievement.icon;
        } else {
          return FALLBACK_ICON;
        }
      } else if (phase === ICON_PHASE.FIRST_ATTEMPT) {
        iconUrl = achievement.icon;
      } else {
        return FALLBACK_ICON;
      }

      if (!isValidSteamUrl(iconUrl)) {
        return FALLBACK_ICON;
      }

      return iconUrl;
    },
    [iconErrorPhase]
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
