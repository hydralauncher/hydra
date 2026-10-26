import { LibraryGame } from "@types";
import {
  buildCoverThumbnailUrl,
  getDisplayedPlayTimeInMilliseconds,
} from "@shared";
import cn from "classnames";
import { getLibraryPresentationImportSources } from "./library-category";
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
import { AchievementProgress, SteamLibraryBadge } from "@renderer/components";
import { GameVisibilityBadge } from "@renderer/components/game-visibility-badge/game-visibility-badge";
import { memo, useEffect, useState, type SyntheticEvent } from "react";
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
  thumbnailWidth?: number;
  onShowTooltip?: (gameId: string) => void;
  onHideTooltip?: () => void;
}

const failedCoverSources = new Set<string>();
const failedCoverThumbnails = new Set<string>();

const markCoverLoaded = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.dataset.loaded = "true";
};

const markCoverLoadedIfComplete = (image: HTMLImageElement | null) => {
  if (image?.complete && image.naturalWidth > 0) image.dataset.loaded = "true";
};

const getNextUsableSourceIndex = (
  sources: (string | null | undefined)[],
  fromIndex: number
) => {
  for (let index = fromIndex; index < sources.length; index++) {
    const source = sources[index];
    if (source && !failedCoverSources.has(source)) return index;
  }
  return sources.length;
};

export const LibraryGameCard = memo(function LibraryGameCard({
  game,
  onContextMenu,
  thumbnailWidth,
}: Readonly<LibraryGameCardProps>) {
  const { t } = useTranslation("library");
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const hideBadges = userPreferences?.hideLibraryGameBadges ?? false;
  const hideReadySizeBadges =
    userPreferences?.hideLibraryReadySizeBadges ?? false;
  const hideClassicsBadges =
    userPreferences?.hideLibraryClassicsBadges ?? false;
  const importSources = getLibraryPresentationImportSources(game);
  const showEpicLibraryBadge =
    importSources.epic && !userPreferences?.hideEpicLibraryBadges;
  const showSteamLibraryBadge =
    importSources.steam && !userPreferences?.hideSteamLibraryBadges;
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

  const [fallbackIndex, setFallbackIndex] = useState(() =>
    getNextUsableSourceIndex(sources, 0)
  );
  const [imageError, setImageError] = useState(false);
  const [failedThumbnailSource, setFailedThumbnailSource] = useState<
    string | null
  >(null);

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
  const isAwaitingPoster =
    !thumbnailWidth && shouldHoldFrame && coverPoster === undefined;

  useAnimatedSourceWarmup(
    activeImageSource,
    isAnimatedCover && !autoplayAnimatedArtwork && Boolean(coverPoster)
  );

  const isPlayingAnimatedCover =
    isAnimatedCover && Boolean(coverPoster) && !shouldHoldFrame;

  const canUseThumbnail =
    Boolean(thumbnailWidth) &&
    failedThumbnailSource !== activeImageSource &&
    !failedCoverThumbnails.has(activeImageSource);

  let displayImageSource = activeImageSource;
  if (thumbnailWidth && canUseThumbnail && !isPlayingAnimatedCover) {
    displayImageSource = buildCoverThumbnailUrl(
      activeImageSource,
      thumbnailWidth
    );
  } else if (shouldHoldFrame && coverPoster) {
    displayImageSource = resolveImageSource(coverPoster);
  }

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
  const showReadyBadge = !hideReadySizeBadges && isInstalled;

  const handleImageError = () => {
    const isThumbnailFailure = displayImageSource !== activeImageSource;

    logger.warn(`Image failed to load for ${game.title}`, {
      failedUrl: sources[fallbackIndex],
      level: fallbackIndex,
      thumbnail: isThumbnailFailure,
    });

    if (isThumbnailFailure && thumbnailWidth && canUseThumbnail) {
      failedCoverThumbnails.add(activeImageSource);
      setFailedThumbnailSource(activeImageSource);
      return;
    }

    const failedSource = sources[fallbackIndex];
    if (failedSource) failedCoverSources.add(failedSource);

    const nextIndex = getNextUsableSourceIndex(sources, fallbackIndex + 1);
    if (nextIndex < sources.length) {
      setFallbackIndex(nextIndex);
    } else {
      setImageError(true);
    }
  };

  useEffect(() => {
    setFallbackIndex(
      getNextUsableSourceIndex(
        [
          game.customCoverImageUrl,
          game.coverImageUrl,
          game.libraryImageUrl,
          game.iconUrl,
        ].filter((url) => url && url.trim() !== ""),
        0
      )
    );
    setImageError(false);
    setFailedThumbnailSource(null);
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
            key={`backdrop:${displayImageSource}`}
            ref={markCoverLoadedIfComplete}
            src={displayImageSource}
            alt=""
            aria-hidden="true"
            className="library-game-card__classics-backdrop"
            decoding="async"
            onLoad={markCoverLoaded}
            onError={handleImageError}
          />
          <img
            key={displayImageSource}
            ref={markCoverLoadedIfComplete}
            src={displayImageSource}
            alt=""
            className="library-game-card__classics-image"
            decoding="async"
            onLoad={markCoverLoaded}
            onError={handleImageError}
          />
        </div>
      );
    }

    return (
      <img
        key={displayImageSource}
        ref={markCoverLoadedIfComplete}
        src={displayImageSource}
        alt=""
        className={cn("library-game-card__game-image", {
          "library-game-card__game-image--contain": isChosenCoverActive,
        })}
        decoding="async"
        onLoad={markCoverLoaded}
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
      aria-label={game.title}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className={cn("library-game-card__overlay", {
          "library-game-card__overlay--classics":
            game.shop === "launchbox" && !isChosenCoverActive,
          "library-game-card__overlay--no-fade":
            hideAchievementProgress ||
            ((game.achievementCount ?? 0) === 0 &&
              (game.unlockedAchievementCount ?? 0) === 0),
        })}
      >
        <div className="library-game-card__top-section">
          <div className="library-game-card__top-left">
            <GameVisibilityBadge
              isHiddenFromOthers={game.isHiddenFromOthers}
              isConcealed={game.isConcealed}
            />
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
                  {formatPlayTime(getDisplayedPlayTimeInMilliseconds(game))}
                </span>
                <span className="library-game-card__playtime-short">
                  {formatPlayTime(
                    getDisplayedPlayTimeInMilliseconds(game),
                    true
                  )}
                </span>
              </div>
            )}
          </div>

          {(showSteamLibraryBadge ||
            showEpicLibraryBadge ||
            showPlatformBadge ||
            showReadyBadge) && (
            <div className="library-game-card__top-right">
              {(showSteamLibraryBadge || showEpicLibraryBadge) && (
                <div className="library-game-card__import-badges">
                  {showSteamLibraryBadge && (
                    <SteamLibraryBadge availableShops={game.availableShops} />
                  )}
                  {showEpicLibraryBadge && (
                    <SteamLibraryBadge
                      source="epic"
                      availableShops={game.availableShops}
                    />
                  )}
                </div>
              )}

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

        {!hideAchievementProgress &&
          ((game.achievementCount ?? 0) > 0 ||
            (game.unlockedAchievementCount ?? 0) > 0) && (
            <AchievementProgress
              achievementCount={Math.max(
                game.achievementCount ?? 0,
                game.unlockedAchievementCount ?? 0
              )}
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
