import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import { formatBytes } from "@shared";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  DatabaseIcon,
  FileZipIcon,
} from "@primer/octicons-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  const selectedUrl = customUrl || originalUrl || fallbackUrl || "";
  return normalizePathForCss(selectedUrl);
};

export const LibraryGameCardLarge = memo(function LibraryGameCardLarge({
  game,
  onContextMenu,
}: Readonly<LibraryGameCardLargeProps>) {
  const { t } = useTranslation("library");
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);

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

  const backgroundImage = useMemo(
    () =>
      getImageWithCustomPriority(
        game.customHeroImageUrl,
        game.libraryHeroImageUrl,
        game.libraryImageUrl ?? game.iconUrl
      ),
    [
      game.customHeroImageUrl,
      game.libraryHeroImageUrl,
      game.libraryImageUrl,
      game.iconUrl,
    ]
  );

  const [unlockedAchievementsCount, setUnlockedAchievementsCount] = useState(
    game.unlockedAchievementCount ?? 0
  );

  useEffect(() => {
    if (game.unlockedAchievementCount) return;

    window.electron
      .getUnlockedAchievements(game.objectId, game.shop)
      .then((achievements) => {
        setUnlockedAchievementsCount(
          achievements.filter((a) => a.unlocked).length
        );
      });
  }, [game]);

  const backgroundStyle = useMemo(
    () =>
      backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : {},
    [backgroundImage]
  );

  const achievementBarStyle = useMemo(
    () => ({
      width: `${(unlockedAchievementsCount / (game.achievementCount ?? 1)) * 100}%`,
    }),
    [unlockedAchievementsCount, game.achievementCount]
  );

  const logoImage = game.customLogoImageUrl ?? game.logoImageUrl;

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
                    {unlockedAchievementsCount} / {game.achievementCount ?? 0}
                  </span>
                </div>
                <span className="library-game-card-large__achievement-percentage">
                  {Math.round(
                    (unlockedAchievementsCount / (game.achievementCount ?? 1)) *
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
        </div>
      </div>
    </button>
  );
});
