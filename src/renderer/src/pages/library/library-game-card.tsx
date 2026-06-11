import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import { isGameCompleted } from "@renderer/helpers";
import { ProgressBar } from "@renderer/components";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  ImageIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import { platformToSystem, SYSTEM_TO_BINARY } from "@renderer/helpers";
import { EMULATOR_ICONS } from "@renderer/pages/settings/emulation/emulator-icons";
import "./library-game-card.scss";
import { logger } from "@renderer/logger";

const PLATFORM_LABELS: Record<string, string> = {
  ps1: "PS",
  ps2: "PS2",
  ps3: "PS3",
};

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

  const isCompleted = useMemo(
    () => isGameCompleted(game.achievementCount, game.unlockedAchievementCount),
    [game.achievementCount, game.unlockedAchievementCount]
  );

  const isInstalled = Boolean(game.executablePath);

  const sources = [
    game.customIconUrl, // Level 0
    game.coverImageUrl, // Level 1
    game.libraryImageUrl, // Level 2
    game.iconUrl, // Level 3
  ].filter((url) => url && url.trim() !== "");

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

  const classicsSystem =
    game.shop === "launchbox" ? platformToSystem(game.platform) : null;
  const classicsPlatformLabel = classicsSystem
    ? PLATFORM_LABELS[classicsSystem]
    : null;
  const classicsEmulatorIcon = classicsSystem
    ? EMULATOR_ICONS[SYSTEM_TO_BINARY[classicsSystem]]
    : undefined;

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

  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="library-game-card__wrapper"
      title={game.title}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div
        className={`library-game-card__overlay${game.shop === "launchbox" ? " library-game-card__overlay--classics" : ""}`}
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
          <div className="library-game-card__achievements">
            <div className="library-game-card__achievement-header">
              <div className="library-game-card__achievements-gap">
                {!isCompleted && (
                  <TrophyIcon
                    size={13}
                    className="library-game-card__achievement-trophy"
                  />
                )}
                <span className="library-game-card__achievement-count">
                  {game.unlockedAchievementCount ?? 0} /{" "}
                  {game.achievementCount ?? 0}
                </span>
              </div>
              <span
                className={`library-game-card__achievement-percentage${isCompleted ? " library-game-card__achievement-percentage--completed" : ""}`}
              >
                {isCompleted ? (
                  <TrophyIcon size={13} />
                ) : (
                  <>
                    {Math.round(
                      ((game.unlockedAchievementCount ?? 0) /
                        (game.achievementCount ?? 1)) *
                        100
                    )}
                    %
                  </>
                )}
              </span>
            </div>
            <ProgressBar
              now={game.unlockedAchievementCount ?? 0}
              max={game.achievementCount ?? 1}
              label={`${game.title} achievements`}
              completed={isCompleted}
              trackClassName="library-game-card__achievement-progress"
              barClassName="library-game-card__achievement-bar"
            />
          </div>
        )}
      </div>

      {imageError || !activeImageSource ? (
        <div className="library-game-card__cover-placeholder">
          <ImageIcon size={48} />
        </div>
      ) : game.shop === "launchbox" ? (
        <div className="library-game-card__classics-cover">
          <img
            src={activeImageSource}
            alt=""
            aria-hidden="true"
            className="library-game-card__classics-backdrop"
            loading="lazy"
            onError={handleImageError}
          />
          <img
            src={activeImageSource}
            alt={game.title}
            className="library-game-card__classics-image"
            loading="lazy"
            onError={handleImageError}
          />
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
