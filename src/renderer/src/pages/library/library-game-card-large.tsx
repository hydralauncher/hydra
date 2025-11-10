import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { memo, useMemo } from "react";
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
  const {
    formatPlayTime,
    handleCardClick,
    handleContextMenuClick,
  } = useGameCard(game, onContextMenu);

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
        </div>
      </div>
    </button>
  );
});
