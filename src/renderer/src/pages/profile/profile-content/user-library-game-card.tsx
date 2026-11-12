import { UserGame } from "@types";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { memo, useCallback, useState } from "react";
import {
  buildGameAchievementPath,
  buildGameDetailsPath,
  formatDownloadProgress,
  isGameCompleted,
} from "@renderer/helpers";
import { ClockIcon, TrophyIcon, AlertFillIcon } from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useTranslation } from "react-i18next";
import { GameVisibilityBadge } from "@renderer/components/game-visibility-badge/game-visibility-badge";
import { ProgressBar, VerticalCoverCard } from "@renderer/components";
import "./user-library-game-card.scss";

export const USER_LIBRARY_GAME_TOOLTIP_ID = "user-library-game-tooltip";
export const USER_LIBRARY_GAME_STATS_CYCLE_MS = 7000;

interface UserLibraryGameCardProps {
  game: UserGame;
  profileUserId: string | undefined;
  hasActiveSubscription: boolean;
  isMe: boolean;
  onContextMenu: (game: UserGame, position: { x: number; y: number }) => void;
}

export const UserLibraryGameCard = memo(function UserLibraryGameCard({
  game,
  profileUserId,
  hasActiveSubscription,
  isMe,
  onContextMenu,
}: UserLibraryGameCardProps) {
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();

  const coverImageUrl = game.customLibraryImageUrl ?? game.coverImageUrl;

  const isCompleted = isGameCompleted(
    game.achievementCount,
    game.unlockedAchievementCount
  );

  const hasAchievementProgress =
    hasActiveSubscription && (game.achievementCount ?? 0) > 0;

  const cyclesStats = game.achievementsPointsEarnedSum > 0;
  // A negative delay fixed at mount keeps every card on the same phase of the shared cycle.
  const [statsAnimationDelay] = useState(
    () => `-${Date.now() % USER_LIBRARY_GAME_STATS_CYCLE_MS}ms`
  );
  const statsItemStyle = cyclesStats
    ? {
        animationDuration: `${USER_LIBRARY_GAME_STATS_CYCLE_MS}ms`,
        animationDelay: statsAnimationDelay,
      }
    : undefined;

  const buildUserGameDetailsPath = useCallback(
    (game: UserGame) => {
      if (!hasActiveSubscription || game.achievementCount === 0) {
        return buildGameDetailsPath({
          ...game,
          objectId: game.objectId,
        });
      }

      const userParams = profileUserId
        ? {
            userId: profileUserId,
          }
        : undefined;

      return buildGameAchievementPath({ ...game }, userParams);
    },
    [hasActiveSubscription, profileUserId]
  );

  const formatAchievementPoints = (number: number) => {
    if (number < 100_000) return numberFormatter.format(number);

    if (number < 1_000_000) return `${(number / 1000).toFixed(1)}K`;

    return `${(number / 1_000_000).toFixed(1)}M`;
  };

  const formatPlayTime = useCallback(
    (playTimeInSeconds = 0, isShort = false) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t(isShort ? "amount_minutes_short" : "amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      const hoursKey = isShort ? "amount_hours_short" : "amount_hours";
      const hoursAmount = isShort
        ? Math.floor(hours)
        : numberFormatter.format(hours);

      return t(hoursKey, { amount: hoursAmount });
    },
    [numberFormatter, t]
  );

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!isMe) return;

    event.preventDefault();
    event.stopPropagation();

    onContextMenu(game, { x: event.clientX, y: event.clientY });
  };

  return (
    <li className="user-library-game__wrapper">
      <VerticalCoverCard
        gameTitle={game.title}
        coverImageUrls={[coverImageUrl]}
        catalogueImages={game.images}
        useClassicsLayout={
          game.shop === "launchbox" && !game.customLibraryImageUrl
        }
        showTitleTooltip={false}
        onClick={() => navigate(buildUserGameDetailsPath(game))}
        onContextMenu={handleContextMenu}
      >
        <div
          className={`user-library-game__overlay${game.shop === "launchbox" && !game.customLibraryImageUrl ? " user-library-game__overlay--classics" : ""}${hasAchievementProgress ? "" : " user-library-game__overlay--no-fade"}`}
        >
          <div className="user-library-game__top-section">
            <div className="user-library-game__top-left">
              <GameVisibilityBadge
                isHiddenFromOthers={game.isHiddenFromOthers}
                isConcealed={game.isConcealed}
              />
              <div
                className="user-library-game__playtime"
                data-tooltip-place="top"
                data-tooltip-content={
                  game.hasManuallyUpdatedPlaytime
                    ? t("manual_playtime_tooltip")
                    : undefined
                }
                data-tooltip-id={
                  game.hasManuallyUpdatedPlaytime
                    ? USER_LIBRARY_GAME_TOOLTIP_ID
                    : undefined
                }
              >
                {game.hasManuallyUpdatedPlaytime ? (
                  <AlertFillIcon
                    size={11}
                    className="user-library-game__manual-playtime"
                  />
                ) : (
                  <ClockIcon size={11} />
                )}
                <span className="user-library-game__playtime-long">
                  {formatPlayTime(game.playTimeInSeconds)}
                </span>
                <span className="user-library-game__playtime-short">
                  {formatPlayTime(game.playTimeInSeconds, true)}
                </span>
              </div>
            </div>
          </div>

          {hasAchievementProgress && (
            <div className="user-library-game__stats">
              <div className="user-library-game__stats-header">
                <div className="user-library-game__stats-content">
                  <div
                    className={`user-library-game__stats-item${cyclesStats ? " user-library-game__stats-item--cycling" : ""}`}
                    style={statsItemStyle}
                  >
                    {!isCompleted && <TrophyIcon size={13} />}
                    <span>
                      {game.unlockedAchievementCount} / {game.achievementCount}
                    </span>
                  </div>

                  {game.achievementsPointsEarnedSum > 0 && (
                    <div
                      className="user-library-game__stats-item user-library-game__stats-item--cycling"
                      style={statsItemStyle}
                    >
                      <HydraIcon width={16} height={16} />
                      {formatAchievementPoints(
                        game.achievementsPointsEarnedSum
                      )}
                    </div>
                  )}
                </div>

                <span
                  className={`user-library-game__stats-percentage${isCompleted ? " user-library-game__stats-percentage--completed" : ""}`}
                >
                  {isCompleted ? (
                    <TrophyIcon size={13} />
                  ) : (
                    formatDownloadProgress(
                      game.unlockedAchievementCount / game.achievementCount,
                      1
                    )
                  )}
                </span>
              </div>

              <ProgressBar
                now={game.unlockedAchievementCount ?? 0}
                max={game.achievementCount ?? 1}
                label={`${game.title} achievements`}
                completed={isCompleted}
                trackClassName="user-library-game__achievements-progress-track"
                barClassName="user-library-game__achievements-progress"
              />
            </div>
          )}
        </div>
      </VerticalCoverCard>
    </li>
  );
});
