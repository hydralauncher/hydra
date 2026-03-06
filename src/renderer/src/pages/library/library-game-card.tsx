import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import { memo, useEffect, useMemo, useState } from "react";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  ImageIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./library-game-card.scss";
import { logger } from "@renderer/logger";

interface ProgressInfo {
  raw: number;
  formatted: string;
}

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
  downloadProgress: ProgressInfo | null;
  extractionProgress: ProgressInfo | null;
}

export const LibraryGameCard = memo(function LibraryGameCard({
  game,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  downloadProgress,
  extractionProgress,
}: Readonly<LibraryGameCardProps>) {
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);
  const { t } = useTranslation("library");

  const sources = useMemo(
    () =>
      [
        game.customIconUrl,
        game.coverImageUrl,
        game.libraryImageUrl,
        game.iconUrl,
      ].filter((url): url is string => !!url && url.trim() !== ""),
    [
      game.customIconUrl,
      game.coverImageUrl,
      game.libraryImageUrl,
      game.iconUrl,
    ]
  );

  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const resolveImageSource = (imageUrl: string | null | undefined): string => {
    if (!imageUrl) return "";

    const trimmedImageUrl = imageUrl.trim();
    if (!trimmedImageUrl) return "";

    if (
      trimmedImageUrl.startsWith("http://") ||
      trimmedImageUrl.startsWith("https://") ||
      trimmedImageUrl.startsWith("data:") ||
      trimmedImageUrl.startsWith("blob:")
    ) {
      return trimmedImageUrl;
    }

    if (trimmedImageUrl.startsWith("local:")) {
      const normalizedLocalPath = trimmedImageUrl
        .slice("local:".length)
        .replaceAll("\\", "/");
      return `local:${normalizedLocalPath}`;
    }

    const normalizedPath = trimmedImageUrl.replaceAll("\\", "/");
    if (/^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("/")) {
      return `local:${normalizedPath}`;
    }

    return normalizedPath;
  };

  const activeImageSource = resolveImageSource(sources[fallbackIndex]);

  const handleImageError = () => {
    logger.warn(`Image failed to load for ${game.title}`, {
      failedUrl: sources[fallbackIndex],
      level: fallbackIndex,
    });

    if (fallbackIndex < sources.length - 1) {
      setFallbackIndex((prevIndex) => prevIndex + 1);
    } else {
      setImageError(true);
    }
  };

  useEffect(() => {
    setFallbackIndex(0);
    setImageError(false);
  }, [game.id]);

  const gameState = useMemo(() => {
    if (extractionProgress) return "extracting";
    if (downloadProgress) return "downloading";
    if (game.download?.queued) return "queued";
    if (game.download?.status === "paused") return "paused";
    if (
      game.download?.progress === 1 &&
      game.download?.status === "complete" &&
      !game.executablePath
    )
      return "installer-ready";
    if (!game.executablePath) return "not-installed";
    return "installed";
  }, [
    extractionProgress,
    downloadProgress,
    game.download,
    game.executablePath,
  ]);

  const stateLabel = useMemo(() => {
    switch (gameState) {
      case "extracting":
        return extractionProgress!.formatted;
      case "downloading":
        return downloadProgress!.formatted;
      case "queued":
        return t("queued");
      case "paused":
        return t("paused");
      case "installer-ready":
        return t("installer_ready");
      default:
        return null;
    }
  }, [gameState, extractionProgress, downloadProgress, t]);

  const wrapperClass = useMemo(() => {
    const base = "library-game-card__wrapper";
    if (gameState === "not-installed") return `${base} ${base}--not-installed`;
    if (gameState === "installer-ready")
      return `${base} ${base}--installer-ready`;
    if (gameState === "downloading") return `${base} ${base}--downloading`;
    if (gameState === "extracting") return `${base} ${base}--extracting`;
    if (gameState === "queued") return `${base} ${base}--queued`;
    if (gameState === "paused") return `${base} ${base}--paused`;
    return base;
  }, [gameState]);

  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={wrapperClass}
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

          {stateLabel && (
            <div
              className={`library-game-card__status-badge library-game-card__status-badge--${gameState}`}
            >
              {stateLabel}
            </div>
          )}
        </div>

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

        {(gameState === "downloading" || gameState === "extracting") && (
          <div className="library-game-card__progress-bar">
            <div
              className={`library-game-card__progress-fill library-game-card__progress-fill--${gameState}`}
              style={{
                width: `${(gameState === "downloading" ? downloadProgress!.raw : extractionProgress!.raw) * 100}%`,
              }}
            />
          </div>
        )}
      </div>

      {imageError || !activeImageSource ? (
        <div className="library-game-card__cover-placeholder">
          <ImageIcon size={48} />
        </div>
      ) : (
        <img
          src={activeImageSource}
          alt={game.title}
          className="library-game-card__game-image"
          loading="lazy"
          onError={handleImageError}
        />
      )}
    </button>
  );
});
