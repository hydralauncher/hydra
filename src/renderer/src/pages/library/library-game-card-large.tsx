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
  XIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useCallback, memo, useMemo } from "react";
import { useGameActions } from "@renderer/components/game-context-menu/use-game-actions";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { logger } from "@renderer/logger";
import "./library-game-card-large.scss";

interface LibraryGameCardLargeProps {
  game: LibraryGame;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
}

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export const LibraryGameCardLarge = memo(function LibraryGameCardLarge({
  game,
  onContextMenu,
}: Readonly<LibraryGameCardLargeProps>) {
  const { t } = useTranslation("library");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();
  const { lastPacket } = useDownload();

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

  const {
    handlePlayGame,
    handleOpenDownloadOptions,
    handleCloseGame,
    isGameRunning,
  } = useGameActions(game);

  const handleActionClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isGameRunning) {
      try {
        await handleCloseGame();
      } catch (e) {
        logger.error(e);
      }
      return;
    }
    try {
      await handlePlayGame();
    } catch (err) {
      logger.error(err);
      try {
        handleOpenDownloadOptions();
      } catch (e) {
        logger.error(e);
      }
    }
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

  const backgroundImage = useMemo(
    () =>
      getImageWithCustomPriority(
        game.libraryHeroImageUrl,
        game.libraryImageUrl,
        game.iconUrl
      ),
    [game.libraryHeroImageUrl, game.libraryImageUrl, game.iconUrl]
  );

  const backgroundStyle = useMemo(
    () => ({ backgroundImage: `url(${backgroundImage})` }),
    [backgroundImage]
  );

  const achievementBarStyle = useMemo(
    () => ({
      width: `${((game.unlockedAchievementCount ?? 0) / (game.achievementCount ?? 1)) * 100}%`,
    }),
    [game.unlockedAchievementCount, game.achievementCount]
  );

  const logoImage = game.logoImageUrl;

  return (
    <button
      type="button"
      className="library-game-card-large"
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className="library-game-card-large__background"
        style={backgroundStyle}
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
                  style={achievementBarStyle}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            className="library-game-card-large__action-button"
            onClick={handleActionClick}
          >
            {(() => {
              if (isGameDownloading) {
                return (
                  <>
                    <DownloadIcon
                      size={16}
                      className="library-game-card-large__action-icon--downloading"
                    />
                    {t("downloading")}
                  </>
                );
              }

              if (isGameRunning) {
                return (
                  <>
                    <XIcon size={16} />
                    {t("close")}
                  </>
                );
              }

              if (game.executablePath) {
                return (
                  <>
                    <PlayIcon size={16} />
                    {t("play")}
                  </>
                );
              }

              return (
                <>
                  <DownloadIcon size={16} />
                  {t("download")}
                </>
              );
            })()}
          </button>
        </div>
      </div>
    </button>
  );
});
