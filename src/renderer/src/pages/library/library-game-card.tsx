import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import { memo, useCallback, useEffect, useState, useRef } from "react";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  ImageIcon,
  HeartIcon,
  HeartFillIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import SteamIcon from "@renderer/assets/launcher-icons/steam.svg?react";
import EpicGamesIcon from "@renderer/assets/launcher-icons/epic-games.svg?react";
import "./library-game-card.scss";
import { logger } from "@renderer/logger";
import Skeleton from "react-loading-skeleton";
import { globalImageCache } from "@renderer/helpers";

interface LibraryGameCardProps {
  game: LibraryGame;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
  onShowTooltip?: (gameId: string) => void;
  onHideTooltip?: () => void;
  onToggleFavorite?: (game: LibraryGame) => void;
  onRemoveFromLibrary?: (game: LibraryGame) => void;
  onRemoveFromFolder?: (game: LibraryGame) => void;
  isSelected?: boolean;
  onToggleSelect?: (game: LibraryGame) => void;
  selectOnClick?: boolean;
}

export const LibraryGameCard = memo(function LibraryGameCard({
  game,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  onToggleFavorite,
  onRemoveFromLibrary,
  onRemoveFromFolder,
  isSelected,
  onToggleSelect,
  selectOnClick = false,
}: Readonly<LibraryGameCardProps>) {
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu ?? (() => {}));

  const handleClick = selectOnClick
    ? (e: React.MouseEvent<HTMLButtonElement>) => {
        onToggleSelect?.(game);
        e.currentTarget.blur();
      }
    : handleCardClick;

  const handleFavClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onToggleFavorite?.(game);
    },
    [game, onToggleFavorite]
  );

  const handleRemoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onRemoveFromLibrary?.(game);
    },
    [game, onRemoveFromLibrary]
  );

  const handleRemoveFromFolderClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onRemoveFromFolder?.(game);
    },
    [game, onRemoveFromFolder]
  );

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onToggleSelect?.(game);
    },
    [game, onToggleSelect]
  );

  const sources = [
    game.customIconUrl,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.iconUrl,
    game.shop === "steam"
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/header.jpg`
      : null,
  ].filter((url) => url && typeof url === "string" && url.trim() !== "");

  const resolveImageSource = (imageUrl: string | null | undefined): string => {
    if (!imageUrl) return "";
    const trimmed = imageUrl.trim();
    if (!trimmed) return "";
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:")
    )
      return trimmed;
    if (trimmed.startsWith("local:"))
      return `local:${trimmed.slice("local:".length).replaceAll("\\", "/")}`;
    const normalized = trimmed.replaceAll("\\", "/");
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/"))
      return `local:${normalized}`;
    return normalized;
  };

  const rawLogoUrl = game.customLogoImageUrl ?? game.logoImageUrl ?? null;
  const logoUrl = rawLogoUrl ? resolveImageSource(rawLogoUrl) : null;

  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const activeImageSource = resolveImageSource(sources[fallbackIndex]);
  const [imageLoaded, setImageLoaded] = useState(() =>
    activeImageSource ? globalImageCache.has(activeImageSource) : false
  );

  const handleImageError = () => {
    logger.warn(`Image failed to load for ${game.title}`, {
      failedUrl: sources[fallbackIndex],
      level: fallbackIndex,
    });
    if (fallbackIndex < sources.length - 1) {
      setFallbackIndex((prev) => prev + 1);
    } else {
      setImageError(true);
    }
  };

  useEffect(() => {
    setFallbackIndex(0);
    setImageError(false);
  }, [game.id]);

  useEffect(() => {
    setImageLoaded(
      activeImageSource ? globalImageCache.has(activeImageSource) : false
    );
    if (activeImageSource && imgRef.current?.complete) {
      if (imgRef.current.naturalWidth > 0) {
        globalImageCache.add(activeImageSource);
        setImageLoaded(true);
      } else {
        handleImageError();
      }
    }
  }, [activeImageSource]);

  const achievementPercent =
    (game.achievementCount ?? 0) > 0
      ? Math.round(
          ((game.unlockedAchievementCount ?? 0) /
            (game.achievementCount ?? 1)) *
            100
        )
      : null;

  const isSteam = game.executablePath?.startsWith("steam://");
  const isEpic = game.executablePath?.startsWith("com.epicgames.launcher://");

  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onMouseEnter}
      onBlur={onMouseLeave}
      className={`library-game-card__wrapper${isSelected ? " library-game-card__wrapper--selected" : ""}`}
      title={game.title}
      onClick={handleClick}
      onContextMenu={!selectOnClick ? handleContextMenuClick : undefined}
    >
      {/* Image */}
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {!imageLoaded && !imageError && activeImageSource && (
          <Skeleton
            className="library-game-card__game-image"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              borderRadius: "inherit",
              height: "100%",
            }}
          />
        )}
        {imageError || !activeImageSource ? (
          <div className="library-game-card__cover-placeholder">
            <ImageIcon size={32} />
          </div>
        ) : (
          <img
            ref={imgRef}
            key={activeImageSource}
            src={activeImageSource}
            alt={game.title}
            className="library-game-card__game-image"
            loading="lazy"
            onLoad={() => {
              if (activeImageSource) globalImageCache.add(activeImageSource);
              setImageLoaded(true);
            }}
            onError={handleImageError}
            style={{
              opacity: imageLoaded ? 1 : 0,
              transition: "opacity 0.3s ease",
            }}
          />
        )}
      </div>

      {/* Gradient overlay with info at bottom */}
      <div className="library-game-card__overlay">
        {/* Platform badge — top left */}
        <div className="library-game-card__platform-badge">
          {isSteam ? (
            <SteamIcon
              style={{ width: 14, height: 14, fill: "currentColor" }}
            />
          ) : isEpic ? (
            <EpicGamesIcon
              style={{ width: 14, height: 14, fill: "currentColor" }}
            />
          ) : (
            <HydraIcon
              style={{ width: 14, height: 14, fill: "currentColor" }}
            />
          )}
        </div>

        {/* Logo — top right, above action buttons */}
        {game.shop === "custom" && logoUrl && (
          <img
            src={logoUrl}
            alt={`${game.title} logo`}
            className="library-game-card__logo"
            draggable={false}
          />
        )}

        {/* Checkbox — apenas fora do picker mode */}
        {!selectOnClick && onToggleSelect && (
          <button
            type="button"
            className={`library-game-card__checkbox${isSelected ? " library-game-card__checkbox--checked" : ""}`}
            onClick={handleCheckboxClick}
            aria-label={isSelected ? "Desmarcar" : "Selecionar"}
            title={isSelected ? "Desmarcar" : "Selecionar"}
          >
            {isSelected && (
              <span className="library-game-card__checkbox-mark">✓</span>
            )}
          </button>
        )}

        {/* Action buttons — ocultos no picker mode */}
        {!selectOnClick && (
          <div className="library-game-card__actions">
            {onToggleFavorite && (
              <button
                type="button"
                className={`library-game-card__fav-btn${game.favorite ? " library-game-card__fav-btn--active" : ""}`}
                onClick={handleFavClick}
                aria-label={
                  game.favorite ? "Remover dos favoritos" : "Favoritar"
                }
                title={game.favorite ? "Remover dos favoritos" : "Favoritar"}
              >
                {game.favorite ? (
                  <HeartFillIcon size={11} />
                ) : (
                  <HeartIcon size={11} />
                )}
              </button>
            )}

            {onRemoveFromFolder && (
              <button
                type="button"
                className="library-game-card__folder-remove-btn"
                onClick={handleRemoveFromFolderClick}
                aria-label="Remover da pasta"
                title="Remover da pasta"
              >
                <XIcon size={11} />
              </button>
            )}

            {onRemoveFromLibrary && (
              <button
                type="button"
                className="library-game-card__remove-btn"
                onClick={handleRemoveClick}
                aria-label="Remover da biblioteca"
                title="Remover da biblioteca"
              >
                <TrashIcon size={11} />
              </button>
            )}
          </div>
        )}

        {/* Info strip at bottom */}
        <div className="library-game-card__info">
          <span className="library-game-card__info-title">{game.title}</span>
          <div className="library-game-card__meta">
            <span className="library-game-card__meta-item" title="Tempo jogado">
              {game.hasManuallyUpdatedPlaytime ? (
                <AlertFillIcon
                  size={10}
                  className="library-game-card__manual-playtime"
                />
              ) : (
                <ClockIcon size={10} />
              )}
              <span>{formatPlayTime(game.playTimeInMilliseconds, true)}</span>
            </span>

            {achievementPercent !== null && (
              <span
                className="library-game-card__meta-item library-game-card__meta-item--trophy"
                title="Conquistas"
              >
                <TrophyIcon size={10} />
                <span>{achievementPercent}%</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
});
