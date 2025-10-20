import { LibraryGame } from "@types";
import { useFormat, useDownload } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useState } from "react";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  ClockIcon,
  PlayIcon,
  DownloadIcon,
  AlertFillIcon,
  ThreeBarsIcon,
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
  const { lastPacket } = useDownload();
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
  }>({ visible: false, position: { x: 0, y: 0 } });

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

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

  const handleActionClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (game.executablePath) {
      // Game is installed, launch it
      window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
    } else {
      // Game is not installed, navigate to download options
      navigate(buildGameDetailsPath(game));
    }
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

          {/* Action button - Play or Download */}
          <button
            type="button"
            className="library-game-card__action-button"
            onClick={handleActionClick}
            title={game.executablePath ? t("play") : t("download")}
          >
            {isGameDownloading ? (
              <DownloadIcon
                size={16}
                className="library-game-card__action-icon library-game-card__action-icon--downloading"
              />
            ) : game.executablePath ? (
              <PlayIcon size={16} className="library-game-card__action-icon" />
            ) : (
              <DownloadIcon
                size={16}
                className="library-game-card__action-icon"
              />
            )}
          </button>
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
