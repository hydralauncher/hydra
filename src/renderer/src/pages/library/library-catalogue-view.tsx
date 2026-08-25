import { useNavigate } from "react-router-dom";
import { useGameCard } from "@renderer/hooks/use-game-card";
import { memo, useCallback, useMemo, useState } from "react";
import {
  QuestionIcon,
  HeartIcon,
  ClockIcon,
  TrophyIcon,
  HeartFillIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import { LibraryGame } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import "./library-catalogue-view.scss";

interface LibraryCatCardProps {
  game: LibraryGame;
  onContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
  onToggleFavorite?: (game: LibraryGame) => void;
  onRemoveFromLibrary?: (game: LibraryGame) => void;
  onRemoveFromFolder?: (game: LibraryGame) => void;
  isSelected?: boolean;
  onToggleSelect?: (game: LibraryGame) => void;
  selectOnClick?: boolean;
}

const LibraryCatCard = memo(function LibraryCatCard({
  game,
  onContextMenu,
  onToggleFavorite,
  onRemoveFromLibrary,
  onRemoveFromFolder,
  isSelected,
  onToggleSelect,
  selectOnClick = false,
}: Readonly<LibraryCatCardProps>) {
  const navigate = useNavigate();
  const { formatPlayTime, handleContextMenuClick } = useGameCard(
    game,
    onContextMenu ?? (() => {})
  );

  const [imgError, setImgError] = useState(false);

  // Landscape image priority
  // For Steam games: libraryImageUrl is the landscape grid capsule (460x215)
  // For custom games: we don't upload a dedicated grid capsule, so use the Hero (landscape) before falling back to others.
  const defaultCover =
    game.shop === "custom"
      ? game.customHeroImageUrl ||
        game.libraryHeroImageUrl ||
        game.libraryImageUrl ||
        game.coverImageUrl ||
        game.iconUrl
      : game.libraryImageUrl || game.coverImageUrl || game.iconUrl;

  const coverSrc = !imgError ? defaultCover || "" : "";

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

  const handleClick = selectOnClick
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        onToggleSelect?.(game);
        (e.currentTarget as HTMLElement).blur();
      }
    : () =>
        navigate(
          buildGameDetailsPath({
            objectId: game.objectId,
            shop: game.shop,
            title: game.title,
          })
        );

  const handleFavorite = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onToggleFavorite?.(game);
    },
    [game, onToggleFavorite]
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onRemoveFromLibrary?.(game);
    },
    [game, onRemoveFromLibrary]
  );

  const handleRemoveFromFolder = useCallback(
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

  const achievementPercent =
    (game.achievementCount ?? 0) > 0
      ? Math.round(
          ((game.unlockedAchievementCount ?? 0) /
            (game.achievementCount ?? 1)) *
            100
        )
      : null;

  return (
    <div
      className={`lib-cat-card${isSelected ? " lib-cat-card--selected" : ""}`}
      onClick={handleClick}
      onContextMenu={!selectOnClick ? handleContextMenuClick : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onToggleSelect?.(game);
          e.currentTarget.blur();
        }
      }}
      aria-label={game.title}
    >
      {/* Cover image */}
      <div className="lib-cat-card__cover-wrap">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={game.title}
            className="lib-cat-card__cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="lib-cat-card__placeholder">
            <QuestionIcon size={24} />
          </div>
        )}

        {/* Logo overlay */}
        {game.shop === "custom" && logoUrl && (
          <img
            src={logoUrl}
            alt={`${game.title} logo`}
            className="lib-cat-card__logo"
            draggable={false}
          />
        )}

        {/* Checkbox de seleção — apenas fora do picker mode */}
        {!selectOnClick && onToggleSelect && (
          <button
            type="button"
            className={`lib-cat-card__checkbox${isSelected ? " lib-cat-card__checkbox--checked" : ""}`}
            onClick={handleCheckboxClick}
            aria-label={isSelected ? "Desmarcar" : "Selecionar"}
            title={isSelected ? "Desmarcar" : "Selecionar"}
          >
            {isSelected && (
              <span className="lib-cat-card__checkbox-mark">✓</span>
            )}
          </button>
        )}

        {/* Favorite + Remove buttons — ocultos no picker mode */}
        {!selectOnClick && (
          <div className="lib-cat-card__actions">
            <button
              type="button"
              className={`lib-cat-card__fav-btn${game.favorite ? " lib-cat-card__fav-btn--active" : ""}`}
              onClick={handleFavorite}
              aria-label={
                game.favorite
                  ? "Remover dos favoritos"
                  : "Adicionar aos favoritos"
              }
              title={
                game.favorite
                  ? "Remover dos favoritos"
                  : "Adicionar aos favoritos"
              }
            >
              {game.favorite ? (
                <HeartFillIcon size={11} />
              ) : (
                <HeartIcon size={11} />
              )}
            </button>

            {onRemoveFromFolder && (
              <button
                type="button"
                className="lib-cat-card__folder-remove-btn"
                onClick={handleRemoveFromFolder}
                aria-label="Remover da pasta"
                title="Remover da pasta"
              >
                <XIcon size={11} />
              </button>
            )}

            {onRemoveFromLibrary && (
              <button
                type="button"
                className="lib-cat-card__remove-btn"
                onClick={handleRemove}
                aria-label="Remover da biblioteca"
                title="Remover da biblioteca"
              >
                <TrashIcon size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Info strip */}
      <div className="lib-cat-card__info">
        <span className="lib-cat-card__title">{game.title}</span>

        <div className="lib-cat-card__meta">
          {/* Play time */}
          <span className="lib-cat-card__meta-item" title="Tempo jogado">
            <ClockIcon size={10} />
            <span>{formatPlayTime(game.playTimeInMilliseconds, true)}</span>
          </span>

          {/* Achievements */}
          {achievementPercent !== null && (
            <span
              className="lib-cat-card__meta-item lib-cat-card__meta-item--trophy"
              title="Conquistas"
            >
              <TrophyIcon size={10} />
              <span>{achievementPercent}%</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

interface LibraryCatalogueViewProps {
  games: LibraryGame[];
  onContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
  onToggleFavorite?: (game: LibraryGame) => void;
  onRemoveFromLibrary?: (game: LibraryGame) => void;
  onRemoveFromFolder?: (game: LibraryGame) => void;
  selectedGameIds?: Set<string>;
  onToggleSelect?: (game: LibraryGame) => void;
  selectOnClick?: boolean;
}

export function LibraryCatalogueView({
  games,
  onContextMenu,
  onToggleFavorite,
  onRemoveFromLibrary,
  onRemoveFromFolder,
  selectedGameIds,
  onToggleSelect,
  selectOnClick = false,
}: Readonly<LibraryCatalogueViewProps>) {
  const favorites = useMemo(() => games.filter((g) => g.favorite), [games]);
  const others = useMemo(() => games.filter((g) => !g.favorite), [games]);

  return (
    <div className="lib-cat-view">
      {favorites.length > 0 && (
        <section className="lib-cat-view__section">
          <h2 className="lib-cat-view__section-title">
            <HeartIcon size={14} className="lib-cat-view__section-icon" />
            Favoritos
          </h2>
          <div className="lib-cat-view__grid">
            {favorites.map((game) => (
              <LibraryCatCard
                key={`${game.shop}-${game.objectId}`}
                game={game}
                onContextMenu={onContextMenu}
                onToggleFavorite={onToggleFavorite}
                onRemoveFromLibrary={onRemoveFromLibrary}
                onRemoveFromFolder={onRemoveFromFolder}
                isSelected={selectedGameIds?.has(String(game.objectId))}
                onToggleSelect={onToggleSelect}
                selectOnClick={selectOnClick}
              />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="lib-cat-view__section">
          {favorites.length > 0 && (
            <h2 className="lib-cat-view__section-title">Outros jogos</h2>
          )}
          <div className="lib-cat-view__grid">
            {others.map((game) => (
              <LibraryCatCard
                key={`${game.shop}-${game.objectId}`}
                game={game}
                onContextMenu={onContextMenu}
                onToggleFavorite={onToggleFavorite}
                onRemoveFromLibrary={onRemoveFromLibrary}
                onRemoveFromFolder={onRemoveFromFolder}
                isSelected={selectedGameIds?.has(String(game.objectId))}
                onToggleSelect={onToggleSelect}
                selectOnClick={selectOnClick}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
