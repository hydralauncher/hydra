import { LibraryGame } from "@types";
import cn from "classnames";
import {
  useGameCard,
  useCoverPoster,
  isAnimatedCoverCandidate,
  useAppSelector,
  useAnimatedSourceWarmup,
} from "@renderer/hooks";
import {
  CLASSICS_PS_PLATFORM_LABELS,
  isGameReadyToPlay,
  resolveClassicsBadge,
} from "@renderer/helpers";
import { AchievementProgress } from "@renderer/components";
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  AlertFillIcon,
  ImageIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import {
  EMULATOR_ICONS,
  RETROARCH_EMULATOR_ICON,
} from "@renderer/pages/settings/emulation/emulator-icons";
import "./library-game-card.scss";
import { logger } from "@renderer/logger";

interface LibraryGameCardProps {
  game: LibraryGame;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
  onShowTooltip?: (gameId: string) => void;
  onHideTooltip?: () => void;
}

export const LibraryGameCard = memo(function LibraryGameCard({
  game,
  onContextMenu,
}: Readonly<LibraryGameCardProps>) {
  const { t } = useTranslation("library");
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const hideBadges = userPreferences?.hideLibraryGameBadges ?? false;
  const hideClassicsBadges =
    userPreferences?.hideLibraryClassicsBadges ?? false;
  const hideAchievementProgress =
    userPreferences?.hideLibraryAchievementProgress ?? false;
  const autoplayAnimatedArtwork =
    userPreferences?.autoplayAnimatedArtwork ?? false;

  const isInstalled = isGameReadyToPlay(game);

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
  const shouldHoldFrame =
    isAnimatedCover && !isCoverHovered && !autoplayAnimatedArtwork;
  const isAwaitingPoster = shouldHoldFrame && coverPoster === undefined;

  useAnimatedSourceWarmup(
    activeImageSource,
    isAnimatedCover && !autoplayAnimatedArtwork && Boolean(coverPoster)
  );
  const displayImageSource =
    shouldHoldFrame && coverPoster
      ? resolveImageSource(coverPoster)
      : activeImageSource;

  const { label: classicsPlatformLabel, icon: classicsEmulatorIcon } =
    resolveClassicsBadge(
      game.shop,
      game.platform,
      CLASSICS_PS_PLATFORM_LABELS,
      {
        emulatorIcons: EMULATOR_ICONS,
        retroarchIcon: RETROARCH_EMULATOR_ICON,
      }
    );

  const showPlatformBadge =
    !hideClassicsBadges && Boolean(classicsPlatformLabel);
  const showReadyBadge = !hideBadges && isInstalled;

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
  }, [
    game.id,
    game.customCoverImageUrl,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.iconUrl,
  ]);

  const renderCoverMedia = () => {
    if (imageError || !activeImageSource) {
      return (
        <div className="library-game-card__cover-placeholder">
          <ImageIcon size={48} />
        </div>
      );
    }

    if (isAwaitingPoster) {
      return <div className="library-game-card__cover-placeholder" />;
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
      onMouseEnter={() => setIsCoverHovered(true)}
      onMouseLeave={() => setIsCoverHovered(false)}
      className="library-game-card__wrapper"
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className={cn("library-game-card__overlay", {
          "library-game-card__overlay--classics":
            game.shop === "launchbox" && !isChosenCoverActive,
          "library-game-card__overlay--no-fade":
            hideAchievementProgress || (game.achievementCount ?? 0) === 0,
        })}
      >
        <div className="library-game-card__top-section">
          {!hideBadges && (
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
          )}

          {(showPlatformBadge || showReadyBadge) && (
            <div className="library-game-card__top-right">
              {showPlatformBadge && (
                <div className="library-game-card__classics-badges">
                  <span className="library-game-card__platform-badge">
                    {classicsPlatformLabel}
                  </span>
                </div>
              )}

              {showReadyBadge && (
                <div
                  className={cn("library-game-card__installed-badge", {
                    "library-game-card__installed-badge--classics":
                      classicsEmulatorIcon,
                  })}
                  title={t("installed_tooltip")}
                >
                  {classicsEmulatorIcon ? (
                    <img
                      src={classicsEmulatorIcon}
                      alt=""
                      className="library-game-card__installed-emulator-icon"
                    />
                  ) : (
                    <CheckCircleFillIcon
                      size={11}
                      className="library-game-card__installed-icon"
                    />
                  )}
                  <span className="library-game-card__installed-text">
                    {t("installed")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {!hideAchievementProgress && (game.achievementCount ?? 0) > 0 && (
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
