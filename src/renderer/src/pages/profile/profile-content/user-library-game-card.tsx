import { UserGame } from "@types";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import {
  useFormat,
  useToast,
  useCoverPoster,
  isAnimatedCoverCandidate,
} from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  buildGameAchievementPath,
  buildGameDetailsPath,
  formatDownloadProgress,
  isGameCompleted,
} from "@renderer/helpers";
import { userProfileContext } from "@renderer/context";
import {
  ClockIcon,
  TrophyIcon,
  AlertFillIcon,
  ImageIcon,
} from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import { ProgressBar, GameContextMenu } from "@renderer/components";
import "./user-library-game-card.scss";

interface UserLibraryGameCardProps {
  game: UserGame;
  statIndex: number;
  sortBy?: string;
}

export function UserLibraryGameCard({
  game,
  statIndex,
  sortBy,
}: UserLibraryGameCardProps) {
  const { userProfile, isMe, getUserLibraryGames } =
    useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const { showSuccessToast } = useToast();
  const navigate = useNavigate();
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
  }>({ visible: false, position: { x: 0, y: 0 } });

  const coverImageUrl = game.customLibraryImageUrl ?? game.coverImageUrl;

  const isAnimatedCover = isAnimatedCoverCandidate(coverImageUrl);
  const coverPoster = useCoverPoster(coverImageUrl, isAnimatedCover);
  const [isCoverHovered, setIsCoverHovered] = useState(false);
  const displayCoverUrl =
    (isAnimatedCover && !isCoverHovered && coverPoster
      ? coverPoster
      : coverImageUrl) ?? undefined;

  useEffect(() => {
    setImageError(false);
  }, [coverImageUrl]);

  const isCompleted = isGameCompleted(
    game.achievementCount,
    game.unlockedAchievementCount
  );

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

    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu({ visible: false, position: { x: 0, y: 0 } });
  };

  const toggleGamePinned = async () => {
    try {
      await window.electron.toggleGamePin(
        game.shop,
        game.objectId,
        !game.isPinned
      );

      await getUserLibraryGames(sortBy);

      try {
        window.dispatchEvent(
          new CustomEvent("hydra:game-pin-toggled", {
            detail: { shop: game.shop, objectId: game.objectId },
          })
        );
      } catch {
        /* empty */
      }

      if (game.isPinned) {
        showSuccessToast(t("game_removed_from_pinned"));
      } else {
        showSuccessToast(t("game_added_to_pinned"));
      }
    } finally {
      setContextMenu({ visible: false, position: { x: 0, y: 0 } });
    }
  };

  const renderCoverMedia = () => {
    if (imageError || !coverImageUrl) {
      return (
        <div className="user-library-game__cover-placeholder">
          <ImageIcon size={48} />
        </div>
      );
    }

    if (game.shop === "launchbox" && !game.customLibraryImageUrl) {
      return (
        <div className="user-library-game__classics-cover">
          <img
            src={displayCoverUrl}
            alt=""
            aria-hidden="true"
            className="user-library-game__classics-backdrop"
            loading="lazy"
            decoding="async"
            onError={() => setImageError(true)}
          />
          <img
            src={displayCoverUrl}
            alt={game.title}
            className="user-library-game__classics-image"
            loading="lazy"
            decoding="async"
            onError={() => setImageError(true)}
          />
        </div>
      );
    }

    return (
      <img
        src={displayCoverUrl}
        alt={game.title}
        className="user-library-game__game-image"
        loading="lazy"
        decoding="async"
        onError={() => setImageError(true)}
      />
    );
  };

  return (
    <>
      <li
        className="user-library-game__wrapper"
        title={isTooltipHovered ? undefined : game.title}
      >
        <button
          type="button"
          className="user-library-game__cover"
          onClick={() => navigate(buildUserGameDetailsPath(game))}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsCoverHovered(true)}
          onMouseLeave={() => setIsCoverHovered(false)}
        >
          <div
            className={`user-library-game__overlay${game.shop === "launchbox" && !game.customLibraryImageUrl ? " user-library-game__overlay--classics" : ""}${(game.achievementCount ?? 0) > 0 ? "" : " user-library-game__overlay--no-fade"}`}
          >
            <div
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
              <span className="user-library-game__playtime-long">
                {formatPlayTime(game.playTimeInSeconds)}
              </span>
              <span className="user-library-game__playtime-short">
                {formatPlayTime(game.playTimeInSeconds, true)}
              </span>
            </div>

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
                        {!isCompleted && <TrophyIcon size={13} />}
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

          {renderCoverMedia()}
        </button>
      </li>
      <GameContextMenu
        game={game}
        visible={contextMenu.visible}
        position={contextMenu.position}
        onClose={handleCloseContextMenu}
        onPinToggle={toggleGamePinned}
        isPinned={game.isPinned}
      />
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
