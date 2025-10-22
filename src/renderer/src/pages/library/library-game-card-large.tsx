import { LibraryGame } from "@types";
import { useDownload, useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  PlayIcon,
  DownloadIcon,
  ClockIcon,
  AlertFillIcon,
  ThreeBarsIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { GameContextMenu } from "@renderer/components";
import "./library-game-card-large.scss";

interface LibraryGameCardLargeProps {
  game: LibraryGame;
}

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export function LibraryGameCardLarge({ game }: LibraryGameCardLargeProps) {
  const { t } = useTranslation("library");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();
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
      window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
    } else {
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

  // Use libraryHeroImageUrl as background, fallback to libraryImageUrl
  const backgroundImage = getImageWithCustomPriority(
    game.libraryHeroImageUrl,
    game.libraryImageUrl,
    game.iconUrl
  );

  // For logo, check if logoImageUrl exists (similar to game details page)
  const logoImage = game.logoImageUrl;

  return (
    <>
      <button
        type="button"
        className="library-game-card-large"
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
      >
        <div
          className="library-game-card-large__background"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        />
        <div className="library-game-card-large__gradient" />

        <div className="library-game-card-large__overlay">
          <div className="library-game-card-large__top-section">
            <div className="library-game-card-large__playtime">
              {game.hasManuallyUpdatedPlaytime ? (
                <AlertFillIcon
                  size={11}
                  className="library-game-card-large__manual-playtime"
                />
              ) : (
                <ClockIcon size={11} />
              )}
              <span className="library-game-card-large__playtime-text">
                {formatPlayTime(game.playTimeInMilliseconds)}
              </span>
            </div>
            <button
              type="button"
              className="library-game-card-large__menu-button"
              onClick={handleMenuButtonClick}
              title="More options"
            >
              <ThreeBarsIcon size={16} />
            </button>
          </div>

          <div className="library-game-card-large__logo-container">
            {logoImage ? (
              <img
                src={logoImage}
                alt={game.title}
                className="library-game-card-large__logo"
              />
            ) : (
              <h3 className="library-game-card-large__title">{game.title}</h3>
            )}
          </div>

          <div className="library-game-card-large__info-bar">
            {/* Achievements section */}
            {(game.achievementCount ?? 0) > 0 && (
              <div className="library-game-card-large__achievements">
                <div className="library-game-card-large__achievement-header">
                  <div className="library-game-card-large__achievements-gap">
                    <TrophyIcon
                      size={14}
                      className="library-game-card-large__achievement-trophy"
                    />
                    <span className="library-game-card-large__achievement-count">
                      {game.unlockedAchievementCount ?? 0} /{" "}
                      {game.achievementCount ?? 0}
                    </span>
                  </div>
                  <span className="library-game-card-large__achievement-percentage">
                    {Math.round(
                      ((game.unlockedAchievementCount ?? 0) /
                        (game.achievementCount ?? 1)) *
                        100
                    )}
                    %
                  </span>
                </div>
                <div className="library-game-card-large__achievement-progress">
                  <div
                    className="library-game-card-large__achievement-bar"
                    style={{
                      width: `${((game.unlockedAchievementCount ?? 0) / (game.achievementCount ?? 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              className="library-game-card-large__action-button"
              onClick={handleActionClick}
            >
              {isGameDownloading ? (
                <>
                  <DownloadIcon
                    size={16}
                    className="library-game-card-large__action-icon--downloading"
                  />
                  {t("downloading")}
                </>
              ) : game.executablePath ? (
                <>
                  <PlayIcon size={16} />
                  {t("play")}
                </>
              ) : (
                <>
                  <DownloadIcon size={16} />
                  {t("download")}
                </>
              )}
            </button>
          </div>
        </div>
      </button>
      <GameContextMenu
        game={game}
        visible={contextMenu.visible}
        position={contextMenu.position}
        onClose={handleCloseContextMenu}
      />
    </>
  );
}
