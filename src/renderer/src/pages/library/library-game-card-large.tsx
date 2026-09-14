import cn from "classnames";

import { LibraryGame } from "@types";
import {
  isAnimatedCoverCandidate,
  useAppSelector,
  useCoverPoster,
  useGameCard,
  useAnimatedSourceWarmup,
} from "@renderer/hooks";
import {
  CLASSICS_PS_PLATFORM_LABELS,
  isGameReadyToPlay,
  resolveClassicsBadge,
} from "@renderer/helpers";
import { AchievementProgress } from "@renderer/components";
import { formatBytes } from "@shared";
import {
  ClockIcon,
  AlertFillIcon,
  DatabaseIcon,
  FileZipIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EMULATOR_ICONS,
  RETROARCH_EMULATOR_ICON,
} from "@renderer/pages/settings/emulation/emulator-icons";
import "./library-game-card-large.scss";

interface LibraryGameCardLargeProps {
  game: LibraryGame;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
}

const normalizePathForCss = (url: string | null | undefined): string => {
  if (!url) return "";
  return url.replaceAll("\\", "/");
};

interface InstalledBadgeProps {
  emulatorIcon: string | null | undefined;
}

function InstalledBadge({ emulatorIcon }: Readonly<InstalledBadgeProps>) {
  const { t } = useTranslation("library");

  return (
    <div
      className={cn("library-game-card-large__installed-badge", {
        "library-game-card-large__installed-badge--classics": emulatorIcon,
      })}
      title={t("installed_tooltip")}
    >
      {emulatorIcon ? (
        <img
          src={emulatorIcon}
          alt=""
          className="library-game-card-large__installed-emulator-icon"
        />
      ) : (
        <CheckCircleFillIcon
          size={12}
          className="library-game-card-large__installed-icon"
        />
      )}
      <span className="library-game-card-large__installed-text">
        {t("installed")}
      </span>
    </div>
  );
}

export const LibraryGameCardLarge = memo(function LibraryGameCardLarge({
  game,
  onContextMenu,
}: Readonly<LibraryGameCardLargeProps>) {
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

  const [isCoverHovered, setIsCoverHovered] = useState(false);

  const isInstalled = isGameReadyToPlay(game);

  const sizeBars = useMemo(() => {
    const items: {
      type: "installer" | "installed";
      bytes: number;
      formatted: string;
      icon: typeof FileZipIcon;
      tooltipKey: string;
    }[] = [];

    if (game.installerSizeInBytes) {
      items.push({
        type: "installer",
        bytes: game.installerSizeInBytes,
        formatted: formatBytes(game.installerSizeInBytes),
        icon: FileZipIcon,
        tooltipKey: "installer_size_tooltip",
      });
    }

    if (game.installedSizeInBytes) {
      items.push({
        type: "installed",
        bytes: game.installedSizeInBytes,
        formatted: formatBytes(game.installedSizeInBytes),
        icon: DatabaseIcon,
        tooltipKey: "disk_usage_tooltip",
      });
    }

    if (items.length === 0) return [];

    // Sort by size descending (larger first)
    items.sort((a, b) => b.bytes - a.bytes);

    // Calculate proportional widths in pixels (max bar is 80px)
    const maxBytes = items[0].bytes;
    const maxWidth = 80;
    return items.map((item) => ({
      ...item,
      widthPx: Math.round((item.bytes / maxBytes) * maxWidth),
    }));
  }, [game.installerSizeInBytes, game.installedSizeInBytes]);

  const isClassics = game.shop === "launchbox";

  const heroCandidates = useMemo(() => {
    const isSelectedHero = Boolean(game.selectedArtworkTypes?.includes("hero"));
    const isSelectedGrid = Boolean(game.selectedArtworkTypes?.includes("grid"));

    const candidates: { url: string | null | undefined; isChosen: boolean }[] =
      [
        { url: game.customHeroImageUrl, isChosen: true },
        { url: game.libraryHeroImageUrl, isChosen: isSelectedHero },
      ];

    if (!isClassics) {
      candidates.push(
        { url: game.customCoverImageUrl, isChosen: true },
        { url: game.coverImageUrl, isChosen: isSelectedGrid }
      );
    }

    candidates.push(
      { url: game.libraryImageUrl, isChosen: false },
      { url: game.iconUrl, isChosen: false }
    );

    return candidates.filter(
      (candidate): candidate is { url: string; isChosen: boolean } =>
        Boolean(candidate.url && candidate.url.trim() !== "")
    );
  }, [game, isClassics]);

  const heroSources = useMemo(
    () => heroCandidates.map((candidate) => candidate.url),
    [heroCandidates]
  );

  const [heroIndex, setHeroIndex] = useState(0);

  const [unlockedAchievementsCount, setUnlockedAchievementsCount] = useState(
    game.unlockedAchievementCount ?? 0
  );

  useEffect(() => {
    setHeroIndex(0);
  }, [
    game.objectId,
    game.customHeroImageUrl,
    game.libraryHeroImageUrl,
    game.customCoverImageUrl,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.iconUrl,
  ]);

  useEffect(() => {
    if (game.unlockedAchievementCount != null) {
      setUnlockedAchievementsCount(game.unlockedAchievementCount);
      return;
    }

    setUnlockedAchievementsCount(0);

    if ((game.achievementCount ?? 0) <= 0) return;

    let isStale = false;

    window.electron
      .getUnlockedAchievements(game.objectId, game.shop)
      .then((achievements) => {
        if (isStale) return;
        setUnlockedAchievementsCount(
          achievements.filter((a) => a.unlocked).length
        );
      })
      .catch(() => void 0);

    return () => {
      isStale = true;
    };
  }, [
    game.achievementCount,
    game.objectId,
    game.shop,
    game.unlockedAchievementCount,
  ]);

  useEffect(() => {
    const currentUrl = heroSources[heroIndex];
    if (!currentUrl) return;

    const img = new Image();
    img.src = normalizePathForCss(currentUrl);

    img.onerror = () => {
      if (heroIndex < heroSources.length - 1) {
        setHeroIndex((prev) => prev + 1);
      }
    };

    return () => {
      img.onerror = null;
    };
  }, [heroIndex, heroSources]);

  const rawHeroSource = heroSources[heroIndex];
  const isAnimatedHero = isAnimatedCoverCandidate(rawHeroSource);
  const heroPoster = useCoverPoster(rawHeroSource, isAnimatedHero);
  const shouldHoldHeroFrame =
    isAnimatedHero && !isCoverHovered && !autoplayAnimatedArtwork;
  const isAwaitingHeroPoster = shouldHoldHeroFrame && heroPoster === undefined;

  useAnimatedSourceWarmup(
    normalizePathForCss(rawHeroSource),
    isAnimatedHero && !autoplayAnimatedArtwork && Boolean(heroPoster)
  );

  let displayHeroSource: string | null | undefined = rawHeroSource;
  if (isAwaitingHeroPoster) {
    displayHeroSource = undefined;
  } else if (shouldHoldHeroFrame && heroPoster) {
    displayHeroSource = heroPoster;
  }

  const activeHeroCandidate = heroCandidates[heroIndex];
  const isActiveHeroChosen = activeHeroCandidate?.isChosen ?? false;
  const renderClassicsBlurred = isClassics && !isActiveHeroChosen;

  const usesAnimatedHeroLayer = isAnimatedHero && !renderClassicsBlurred;

  const animatedHeroSource = usesAnimatedHeroLayer
    ? normalizePathForCss(displayHeroSource)
    : "";

  const backgroundStyle = useMemo(
    () =>
      !usesAnimatedHeroLayer && displayHeroSource
        ? {
            backgroundImage: `url("${normalizePathForCss(displayHeroSource)}")`,
          }
        : {},
    [usesAnimatedHeroLayer, displayHeroSource]
  );

  const classicsForegroundUrl = useMemo(() => {
    if (!renderClassicsBlurred || !activeHeroCandidate) return null;

    return normalizePathForCss(displayHeroSource);
  }, [renderClassicsBlurred, activeHeroCandidate, displayHeroSource]);

  const logoImage = game.customLogoImageUrl ?? game.logoImageUrl;

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

  const installedBadge =
    !hideBadges && isInstalled ? (
      <InstalledBadge emulatorIcon={classicsEmulatorIcon} />
    ) : null;

  return (
    <button
      type="button"
      className={`library-game-card-large ${renderClassicsBlurred ? "library-game-card-large--classics" : ""}`}
      onMouseEnter={() => setIsCoverHovered(true)}
      onMouseLeave={() => setIsCoverHovered(false)}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className="library-game-card-large__background"
        style={backgroundStyle}
      />
      {usesAnimatedHeroLayer && animatedHeroSource && (
        <img
          src={animatedHeroSource}
          alt=""
          aria-hidden="true"
          className="library-game-card-large__animated-hero"
        />
      )}
      {classicsForegroundUrl && (
        <img
          src={classicsForegroundUrl}
          alt={game.title}
          className="library-game-card-large__classics-foreground"
          loading="lazy"
        />
      )}
      {!hideAchievementProgress && (game.achievementCount ?? 0) > 0 && (
        <div className="library-game-card-large__gradient" />
      )}

      <div className="library-game-card-large__overlay">
        <div className="library-game-card-large__top-section">
          {!hideBadges && sizeBars.length > 0 && (
            <div className="library-game-card-large__size-badges">
              {sizeBars.map((bar) => (
                <div
                  key={bar.type}
                  className="library-game-card-large__size-bar"
                  title={t(bar.tooltipKey)}
                >
                  <bar.icon size={11} />
                  <div
                    className={`library-game-card-large__size-bar-line library-game-card-large__size-bar-line--${bar.type}`}
                    style={{ width: `${bar.widthPx}px` }}
                  />
                  <span className="library-game-card-large__size-bar-text">
                    {bar.formatted}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="library-game-card-large__top-right">
            {!hideBadges && (
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
            )}

            {!hideClassicsBadges && classicsPlatformLabel && (
              <div className="library-game-card-large__classics-badges">
                <span className="library-game-card-large__platform-badge">
                  {classicsPlatformLabel}
                </span>
              </div>
            )}

            {installedBadge}
          </div>
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
          {!hideAchievementProgress && (game.achievementCount ?? 0) > 0 && (
            <AchievementProgress
              achievementCount={game.achievementCount ?? 0}
              unlockedAchievementCount={unlockedAchievementsCount}
              classNamePrefix="library-game-card-large"
              label={`${game.title} achievements`}
              trophyIconSize={14}
            />
          )}
        </div>
      </div>
    </button>
  );
});
