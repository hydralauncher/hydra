import { UserGame } from "@types";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useContext, useState } from "react";
import {
  buildGameAchievementPath,
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import { userProfileContext } from "@renderer/context";
import {
  ClockIcon,
  TrophyIcon,
  AlertFillIcon,
  HeartFillIcon,
} from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import "./user-library-game-card.scss";

interface UserLibraryGameCardProps {
  game: UserGame;
  statIndex: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function UserLibraryGameCard({
  game,
  statIndex,
  onMouseEnter,
  onMouseLeave,
}: UserLibraryGameCardProps) {
  const { userProfile } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);

  const getStatsItemCount = useCallback(() => {
    let statsCount = 1;
    if (game.achievementsPointsEarnedSum > 0) statsCount++;
    return statsCount;
  }, [game]);

  const buildUserGameDetailsPath = useCallback(
    (game: UserGame) => {
      if (!userProfile?.hasActiveSubscription || game.achievementCount === 0) {
        return buildGameDetailsPath({
          ...game,
          objectId: game.objectId,
        });
      }

      const userParams = userProfile
        ? {
            userId: userProfile.id,
          }
        : undefined;

      return buildGameAchievementPath({ ...game }, userParams);
    },
    [userProfile]
  );

  const formatAchievementPoints = (number: number) => {
    if (number < 100_000) return numberFormatter.format(number);

    if (number < 1_000_000) return `${(number / 1000).toFixed(1)}K`;

    return `${(number / 1_000_000).toFixed(1)}M`;
  };

  const formatPlayTime = useCallback(
    (playTimeInSeconds = 0) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  return (
    <>
      <li
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="user-library-game__wrapper"
        title={isTooltipHovered ? undefined : game.title}
      >
        <button
          type="button"
          className="user-library-game__cover"
          onClick={() => navigate(buildUserGameDetailsPath(game))}
        >
          <div className="user-library-game__overlay">
            {game.isFavorite && (
              <div className="user-library-game__favorite-icon">
                <HeartFillIcon size={14} />
              </div>
            )}
            <small
              className="user-library-game__playtime"
              data-tooltip-place="top"
              data-tooltip-content={
                game.hasManuallyUpdatedPlaytime
                  ? t("manual_playtime_tooltip")
                  : undefined
              }
              data-tooltip-id={game.objectId}
            >
              {game.hasManuallyUpdatedPlaytime ? (
                <AlertFillIcon
                  size={11}
                  className="user-library-game__manual-playtime"
                />
              ) : (
                <ClockIcon size={11} />
              )}
              {formatPlayTime(game.playTimeInSeconds)}
            </small>

            {userProfile?.hasActiveSubscription &&
              game.achievementCount > 0 && (
                <div className="user-library-game__stats">
                  <div className="user-library-game__stats-header">
                    <div className="user-library-game__stats-content">
                      <div
                        className="user-library-game__stats-item"
                        style={{
                          transform: `translateY(${-100 * (statIndex % getStatsItemCount())}%)`,
                        }}
                      >
                        <TrophyIcon size={13} />
                        <span>
                          {game.unlockedAchievementCount} /{" "}
                          {game.achievementCount}
                        </span>
                      </div>

                      {game.achievementsPointsEarnedSum > 0 && (
                        <div
                          className="user-library-game__stats-item"
                          style={{
                            transform: `translateY(${-100 * (statIndex % getStatsItemCount())}%)`,
                          }}
                        >
                          <HydraIcon width={16} height={16} />
                          {formatAchievementPoints(
                            game.achievementsPointsEarnedSum
                          )}
                        </div>
                      )}
                    </div>

                    <span>
                      {formatDownloadProgress(
                        game.unlockedAchievementCount / game.achievementCount,
                        1
                      )}
                    </span>
                  </div>

                  <progress
                    max={1}
                    value={
                      game.unlockedAchievementCount / game.achievementCount
                    }
                    className="user-library-game__achievements-progress"
                  />
                </div>
              )}
          </div>

          <img
            src={game.coverImageUrl}
            alt={game.title}
            className="user-library-game__game-image"
          />
        </button>
      </li>
      <Tooltip
        id={game.objectId}
        style={{
          zIndex: 9999,
        }}
        openOnClick={false}
        afterShow={() => setIsTooltipHovered(true)}
        afterHide={() => setIsTooltipHovered(false)}
      />
    </>
  );
}
