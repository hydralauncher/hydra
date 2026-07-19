import { LibraryGame } from "@types";
import {
  useGameCard,
  useCoverPoster,
  isAnimatedCoverCandidate,
} from "@renderer/hooks";
import { AchievementProgress } from "@renderer/components";
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  AlertFillIcon,
  ImageIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import { getClassicsPlatformDetails } from "@renderer/helpers";
import "./library-game-card.scss";
import { logger } from "@renderer/logger";

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
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);

  const isInstalled = Boolean(game.executablePath);

  const hasPickedCover = Boolean(game.selectedArtworkTypes?.includes("grid"));

  const candidates = [
    { url: game.customCoverImageUrl, isChosenCover: true }, // Level 0
    { url: game.coverImageUrl, isChosenCover: hasPickedCover }, // Level 1
    { url: game.libraryImageUrl, isChosenCover: false }, // Level 2
    { url: game.iconUrl, isChosenCover: false }, // Level 3
  ].filter(({ url }) => url && url.trim() !== "");

  const sources = candidates.map(({ url }) => url);

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
  const isChosenCoverActive = Boolean(candidates[fallbackIndex]?.isChosenCover);

  const rawActiveSource = sources[fallbackIndex];
  const isAnimatedCover = isAnimatedCoverCandidate(rawActiveSource);
  const coverPoster = useCoverPoster(rawActiveSource, isAnimatedCover);
  const [isCoverHovered, setIsCoverHovered] = useState(false);
  const displayImageSource =
    isAnimatedCover && coverPoster && !isCoverHovered
      ? resolveImageSource(coverPoster)
      : activeImageSource;

  const { label: classicsPlatformLabel, emulatorIcon: classicsEmulatorIcon } =
    getClassicsPlatformDetails(game.platform);

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

  const renderCoverMedia = () => {
    if (imageError || !activeImageSource) {
      return (
        <div className="library-game-card__cover-placeholder">
          <ImageIcon size={48} />
        </div>
      );
    }

    if (game.shop === "launchbox" && !isChosenCoverActive) {
      return (
        <div className="library-game-card__classics-cover">
          <img
            src={displayImageSource}
            alt=""
            aria-hidden="true"
            className="library-game-card__classics-backdrop"
            loading="lazy"
            onError={handleImageError}
          />
          <img
            src={displayImageSource}
            alt={game.title}
            className="library-game-card__classics-image"
            loading="lazy"
            onError={handleImageError}
          />
        </div>
      );
    }

    return (
      <img
        src={displayImageSource}
        alt={game.title}
        className={`library-game-card__game-image ${
          isChosenCoverActive ? "library-game-card__game-image--contain" : ""
        }`}
        loading="lazy"
        onError={handleImageError}
      />
    );
  };

  return (
    <button
      type="button"
      onMouseEnter={() => {
        setIsCoverHovered(true);
        onMouseEnter();
      }}
      onMouseLeave={() => {
        setIsCoverHovered(false);
        onMouseLeave();
      }}
      className="library-game-card__wrapper"
      title={game.title}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className={`library-game-card__overlay${game.shop === "launchbox" && !isChosenCoverActive ? " library-game-card__overlay--classics" : ""}${(game.achievementCount ?? 0) > 0 ? "" : " library-game-card__overlay--no-fade"}`}
      >
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

          {classicsPlatformLabel && (
            <div className="library-game-card__classics-badges">
              <span className="library-game-card__platform-badge">
                {classicsPlatformLabel}
              </span>
              {classicsEmulatorIcon && (
                <span className="library-game-card__emulator-badge">
                  <img src={classicsEmulatorIcon} alt="" />
                </span>
              )}
            </div>
          )}

          {isInstalled && (
            <div
              className="library-game-card__installed-badge"
              title={t("installed_tooltip")}
            >
              <CheckCircleFillIcon
                size={11}
                className="library-game-card__installed-icon"
              />
              <span className="library-game-card__installed-text">
                {t("installed")}
              </span>
            </div>
          )}
        </div>

        {(game.achievementCount ?? 0) > 0 && (
          <AchievementProgress
            achievementCount={game.achievementCount ?? 0}
            unlockedAchievementCount={game.unlockedAchievementCount ?? 0}
            classNamePrefix="library-game-card"
            label={`${game.title} achievements`}
          />
        )}
      </div>

      {renderCoverMedia()}
    </button>
  );
});
