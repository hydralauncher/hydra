import { UserGame } from "@types";
import { useToast } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  buildGameAchievementPath,
  buildGameDetailsPath,
} from "@renderer/helpers";
import { userProfileContext } from "@renderer/context";
import {
  ClockIcon,
  TrophyIcon,
  AlertFillIcon,
  PinIcon,
  PinSlashIcon,
  ImageIcon,
} from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import "./user-library-game-card.scss";

interface UserLibraryGameCardProps {
  game: UserGame;
  statIndex: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  sortBy?: string;
}

export function UserLibraryGameCard({
  game,
  onMouseEnter,
  onMouseLeave,
}: UserLibraryGameCardProps) {
  const { userProfile, isMe, getUserLibraryGames } =
    useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { showSuccessToast } = useToast();
  const navigate = useNavigate();
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const [isPinning, setIsPinning] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [game.coverImageUrl]);

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

  const formatPlayTime = useCallback(
    (playTimeInSeconds = 0) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < 60) {
        return t("amount_minutes_short", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      const hoursAmount = Math.floor(hours);

      return t("amount_hours_short", { amount: hoursAmount });
    },
    [t]
  );

  const toggleGamePinned = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsPinning(true);

    try {
      await window.electron.toggleGamePin(
        game.shop,
        game.objectId,
        !game.isPinned
      );

      await getUserLibraryGames();

      if (game.isPinned) {
        showSuccessToast(t("game_removed_from_pinned"));
      } else {
        showSuccessToast(t("game_added_to_pinned"));
      }
    } finally {
      setIsPinning(false);
    }
  };

  const achievementPercent =
    (game.achievementCount ?? 0) > 0
      ? Math.round(
          ((game.unlockedAchievementCount ?? 0) /
            (game.achievementCount ?? 1)) *
            100
        )
      : null;

  return (
    <>
      <button
        type="button"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onMouseEnter}
        onBlur={onMouseLeave}
        className="user-library-game-card__wrapper"
        title={isTooltipHovered ? undefined : game.title}
        onClick={() => navigate(buildUserGameDetailsPath(game))}
      >
        {/* Image */}
        {imageError || !game.coverImageUrl ? (
          <div className="user-library-game-card__cover-placeholder">
            <ImageIcon size={32} />
          </div>
        ) : (
          <img
            src={game.coverImageUrl}
            alt={game.title}
            className="user-library-game-card__game-image"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        )}

        {/* Gradient overlay with info at bottom */}
        <div className="user-library-game-card__overlay">
          {/* Pin button — top right (matches Fav behavior in library) */}
          {isMe && (
            <button
              type="button"
              className={`user-library-game-card__pin-btn${game.isPinned ? " user-library-game-card__pin-btn--active" : ""}`}
              onClick={toggleGamePinned}
              aria-label={game.isPinned ? t("unpin") : t("pin")}
              title={game.isPinned ? t("unpin") : t("pin")}
              disabled={isPinning}
            >
              {game.isPinned ? (
                <PinSlashIcon size={11} />
              ) : (
                <PinIcon size={11} />
              )}
            </button>
          )}

          {/* Info strip at bottom */}
          <div className="user-library-game-card__info">
            <span className="user-library-game-card__info-title">
              {game.title}
            </span>
            <div className="user-library-game-card__meta">
              <span
                className="user-library-game-card__meta-item"
                data-tooltip-id={game.objectId}
              >
                {game.hasManuallyUpdatedPlaytime ? (
                  <AlertFillIcon
                    size={10}
                    className="user-library-game-card__manual-playtime"
                  />
                ) : (
                  <ClockIcon size={10} />
                )}
                <span>{formatPlayTime(game.playTimeInSeconds)}</span>
              </span>

              {achievementPercent !== null &&
                userProfile?.hasActiveSubscription && (
                  <span className="user-library-game-card__meta-item user-library-game-card__meta-item--trophy">
                    <TrophyIcon size={10} />
                    <span>{achievementPercent}%</span>
                  </span>
                )}
            </div>
          </div>
        </div>
      </button>

      <Tooltip
        id={game.objectId}
        style={{
          zIndex: 9999,
        }}
        openOnClick={false}
        afterShow={() => setIsTooltipHovered(true)}
        afterHide={() => setIsTooltipHovered(false)}
        content={
          game.hasManuallyUpdatedPlaytime
            ? t("manual_playtime_tooltip")
            : undefined
        }
      />
    </>
  );
}
