import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import { isGameCompleted } from "@renderer/helpers";
import { ProgressBar } from "@renderer/components";
import { formatBytes } from "@shared";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  DatabaseIcon,
  FileZipIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformToSystem, SYSTEM_TO_BINARY } from "@renderer/helpers";
import { EMULATOR_ICONS } from "@renderer/pages/settings/emulation/emulator-icons";
import "./library-game-card-large.scss";

const PLATFORM_LABELS: Record<string, string> = {
  ps1: "PS",
  ps2: "PS2",
  ps3: "PS3",
};

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

export const LibraryGameCardLarge = memo(function LibraryGameCardLarge({
  game,
  onContextMenu,
}: Readonly<LibraryGameCardLargeProps>) {
  const { t } = useTranslation("library");
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);

  const isInstalled = Boolean(game.executablePath);

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

  const heroSources = useMemo(
    () =>
      [
        game.customHeroImageUrl,
        game.libraryHeroImageUrl,
        game.libraryImageUrl,
        game.iconUrl,
      ].filter((url) => !!url && url.trim() !== ""),
    [game]
  );

  const [heroIndex, setHeroIndex] = useState(0);

  const [unlockedAchievementsCount, setUnlockedAchievementsCount] = useState(
    game.unlockedAchievementCount ?? 0
  );

  useEffect(() => {
    setHeroIndex(0);
  }, [game.objectId]);

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
  }, [heroIndex, heroSources]);

  const backgroundStyle = useMemo(() => {
    const url = heroSources[heroIndex];
    return url ? { backgroundImage: `url("${normalizePathForCss(url)}")` } : {};
  }, [heroIndex, heroSources]);

  const isCompleted = useMemo(
    () => isGameCompleted(game.achievementCount, unlockedAchievementsCount),
    [game.achievementCount, unlockedAchievementsCount]
  );

  const isClassics = game.shop === "launchbox";
  const classicsForegroundUrl = useMemo(() => {
    if (!isClassics) return null;
    const url = heroSources[heroIndex];
    return url ? normalizePathForCss(url) : null;
  }, [isClassics, heroIndex, heroSources]);

  const logoImage = game.customLogoImageUrl ?? game.logoImageUrl;

  const classicsSystem = isClassics ? platformToSystem(game.platform) : null;
  const classicsPlatformLabel = classicsSystem
    ? PLATFORM_LABELS[classicsSystem]
    : null;
  const classicsEmulatorIcon = classicsSystem
    ? EMULATOR_ICONS[SYSTEM_TO_BINARY[classicsSystem]]
    : undefined;

  return (
    <button
      type="button"
      className={`library-game-card-large ${isClassics ? "library-game-card-large--classics" : ""}`}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className="library-game-card-large__background"
        style={backgroundStyle}
      />
      {classicsForegroundUrl && (
        <img
          src={classicsForegroundUrl}
          alt={game.title}
          className="library-game-card-large__classics-foreground"
          loading="lazy"
        />
      )}
      <div className="library-game-card-large__gradient" />

      <div className="library-game-card-large__overlay">
        <div className="library-game-card-large__top-section">
          {sizeBars.length > 0 && (
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
            {isInstalled && (
              <div
                className="library-game-card-large__installed-badge"
                title={t("installed_tooltip")}
              >
                <CheckCircleFillIcon
                  size={12}
                  className="library-game-card-large__installed-icon"
                />
                <span className="library-game-card-large__installed-text">
                  {t("installed")}
                </span>
              </div>
            )}

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

            {classicsPlatformLabel && (
              <div className="library-game-card-large__classics-badges">
                <span className="library-game-card-large__platform-badge">
                  {classicsPlatformLabel}
                </span>
                {classicsEmulatorIcon && (
                  <span className="library-game-card-large__emulator-badge">
                    <img src={classicsEmulatorIcon} alt="" />
                  </span>
                )}
              </div>
            )}
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
          {/* Achievements section */}
          {(game.achievementCount ?? 0) > 0 && (
            <div className="library-game-card-large__achievements">
              <div className="library-game-card-large__achievement-header">
                <div className="library-game-card-large__achievements-gap">
                  {!isCompleted && (
                    <TrophyIcon
                      size={14}
                      className="library-game-card-large__achievement-trophy"
                    />
                  )}
                  <span className="library-game-card-large__achievement-count">
                    {unlockedAchievementsCount} / {game.achievementCount ?? 0}
                  </span>
                </div>
                <span
                  className={`library-game-card-large__achievement-percentage${isCompleted ? " library-game-card-large__achievement-percentage--completed" : ""}`}
                >
                  {isCompleted ? (
                    <TrophyIcon size={14} />
                  ) : (
                    <>
                      {Math.round(
                        (unlockedAchievementsCount /
                          (game.achievementCount ?? 1)) *
                          100
                      )}
                      %
                    </>
                  )}
                </span>
              </div>
              <ProgressBar
                now={unlockedAchievementsCount}
                max={game.achievementCount ?? 1}
                label={`${game.title} achievements`}
                completed={isCompleted}
                trackClassName="library-game-card-large__achievement-progress"
                barClassName="library-game-card-large__achievement-bar"
              />
            </div>
          )}
        </div>
      </div>
    </button>
  );
});
