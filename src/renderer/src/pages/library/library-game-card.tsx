import { LibraryGame } from "@types";
import { useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, memo } from "react";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  ClockIcon,
  AlertFillIcon,
  ThreeBarsIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useTranslation } from "react-i18next";
import "./library-game-card.scss";

interface LibraryGameCardProps {
  game: LibraryGame;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
  onShowTooltip?: (gameId: string) => void;
  onHideTooltip?: () => void;
}

export const LibraryGameCard = memo(function LibraryGameCard({
  game,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
}: Readonly<LibraryGameCardProps>) {
  const { t } = useTranslation("library");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();

  const formatPlayTime = useCallback(
    (playTimeInMilliseconds = 0, isShort = false) => {
      const minutes = playTimeInMilliseconds / 60000;

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

  const handleCardClick = () => {
    navigate(buildGameDetailsPath(game));
  };

  const handleContextMenuClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(game, { x: e.clientX, y: e.clientY });
    },
    [game, onContextMenu]
  );

  const handleMenuButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      onContextMenu(game, { x: rect.right, y: rect.bottom });
    },
    [game, onContextMenu]
  );

  const coverImage =
    game.coverImageUrl ??
    game.libraryImageUrl ??
    game.libraryHeroImageUrl ??
    game.iconUrl ??
    undefined;

  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="library-game-card__wrapper"
      title={game.title}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div className="library-game-card__overlay">
        <div className="library-game-card__top-section">
          <div className="library-game-card__playtime">
            {game.hasManuallyUpdatedPlaytime ? (
              <AlertFillIcon
                size={11}
                className="library-game-card__manual-playtime"
              />
            ) : (
              <ClockIcon size={11} />
            )}
            <span className="library-game-card__playtime-long">
              {formatPlayTime(game.playTimeInMilliseconds)}
            </span>
            <span className="library-game-card__playtime-short">
              {formatPlayTime(game.playTimeInMilliseconds, true)}
            </span>
          </div>

          <button
            type="button"
            className="library-game-card__menu-button"
            onClick={handleMenuButtonClick}
            title="More options"
          >
            <ThreeBarsIcon size={16} />
          </button>
        </div>

        {/* Achievements section - shown on hover */}
        {(game.achievementCount ?? 0) > 0 && (
          <div className="library-game-card__achievements">
            <div className="library-game-card__achievement-header">
              <div className="library-game-card__achievements-gap">
                <TrophyIcon
                  size={13}
                  className="library-game-card__achievement-trophy"
                />
                <span className="library-game-card__achievement-count">
                  {game.unlockedAchievementCount ?? 0} /{" "}
                  {game.achievementCount ?? 0}
                </span>
              </div>
              <span className="library-game-card__achievement-percentage">
                {Math.round(
                  ((game.unlockedAchievementCount ?? 0) /
                    (game.achievementCount ?? 1)) *
                    100
                )}
                %
              </span>
            </div>
            <div className="library-game-card__achievement-progress">
              <div
                className="library-game-card__achievement-bar"
                style={{
                  width: `${((game.unlockedAchievementCount ?? 0) / (game.achievementCount ?? 1)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <img
        src={coverImage ?? undefined}
        alt={game.title}
        className="library-game-card__game-image"
        loading="lazy"
      />
    </button>
  );
});
