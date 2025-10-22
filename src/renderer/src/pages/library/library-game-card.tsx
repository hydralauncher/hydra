import { LibraryGame } from "@types";
import { useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useState } from "react";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  ClockIcon,
  AlertFillIcon,
  ThreeBarsIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import { GameContextMenu } from "@renderer/components";
import "./library-game-card.scss";

interface LibraryGameCardProps {
  game: LibraryGame;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function LibraryGameCard({
  game,
  onMouseEnter,
  onMouseLeave,
}: LibraryGameCardProps) {
  const { t } = useTranslation("library");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
  }>({ visible: false, position: { x: 0, y: 0 } });

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenu({
      visible: true,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  const handleMenuButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu({
      visible: true,
      position: {
        x: e.currentTarget.getBoundingClientRect().right,
        y: e.currentTarget.getBoundingClientRect().bottom,
      },
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu({ visible: false, position: { x: 0, y: 0 } });
  };

  const coverImage =
    game.coverImageUrl ??
    game.libraryImageUrl ??
    game.libraryHeroImageUrl ??
    game.iconUrl ??
    undefined;

  return (
    <>
      <button
        type="button"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="library-game-card__wrapper"
        title={isTooltipHovered ? undefined : game.title}
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
      >
        <div className="library-game-card__overlay">
          <div className="library-game-card__top-section">
            <div
              className="library-game-card__playtime"
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
                    size={14}
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
        />
      </button>
      <Tooltip
        id={game.objectId}
        style={{
          zIndex: 9999,
        }}
        openOnClick={false}
        afterShow={() => setIsTooltipHovered(true)}
        afterHide={() => setIsTooltipHovered(false)}
      />
      <GameContextMenu
        game={game}
        visible={contextMenu.visible}
        position={contextMenu.position}
        onClose={handleCloseContextMenu}
      />
    </>
  );
}
