import { LibraryGame } from "@types";
import { useGameCard, useGameDiskUsage } from "@renderer/hooks";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  DatabaseIcon,
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

  const { installedSize, isLoading: isDiskUsageLoading } = useGameDiskUsage(
    game.shop,
    game.objectId
  );

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
          {installedSize && !isDiskUsageLoading && (
            <div
              className="library-game-card-large__disk-usage"
              title={t("disk_usage_tooltip")}
            >
              <DatabaseIcon size={11} />
              <span className="library-game-card-large__disk-usage-text">
                {installedSize}
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
