import { useNavigate } from "react-router-dom";
import { useAppSelector, useLibrary } from "@renderer/hooks";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  PlusIcon,
  DashIcon,
  QuestionIcon,
  CheckIcon,
} from "@primer/octicons-react";
import type { CatalogueSearchResult } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useSteamGridHeroAndLogo } from "@renderer/hooks/use-steamgrid-cover";
import "./catalogue-section.scss";
import cn from "classnames";

interface CatalogueSectionProps {
  title: string;
  games: CatalogueSearchResult[];
  isLoading?: boolean;
}

export function CatalogueCard({
  game,
}: Readonly<{ game: CatalogueSearchResult }>) {
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();
  const { steamGenres } = useAppSelector((s) => s.catalogueSearch);
  const [added, setAdded] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const [primaryFailed, setPrimaryFailed] = useState(!game.libraryImageUrl);
  const [finalFailed, setFinalFailed] = useState(false);
  const { heroUrl, logoUrl } = useSteamGridHeroAndLogo(
    game.objectId,
    game.title,
    primaryFailed
  );

  const [isDarkBg, setIsDarkBg] = useState(true);

  useEffect(() => {
    if (heroUrl) {
      import("color.js").then(({ average }) => {
        average(heroUrl, { amount: 1, format: "hex" })
          .then((heroHex) => {
            const getLuminance = (hex: string) => {
              if (!hex || hex.length < 7) return 0;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            };
            const heroLum = getLuminance(heroHex as string);
            setIsDarkBg(heroLum <= 0.6);
          })
          .catch(() => setIsDarkBg(true));
      });
    }
  }, [heroUrl]);

  const activeSrc = primaryFailed ? (heroUrl ?? null) : game.libraryImageUrl;

  useEffect(() => {
    setAdded(
      library.some((l) => l.shop === game.shop && l.objectId === game.objectId)
    );
  }, [library, game]);

  const handleLibrary = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isBusy) return;
      setIsBusy(true);
      try {
        if (added) {
          await window.electron.removeGameFromLibrary(game.shop, game.objectId);
        } else {
          await window.electron.addGameToLibrary(
            game.shop,
            game.objectId,
            game.title
          );
          setIsAnimating(true);
          setTimeout(() => setIsAnimating(false), 300);
        }
        updateLibrary();
      } finally {
        setIsBusy(false);
      }
    },
    [added, isBusy, game, updateLibrary]
  );

  const genres = game.genres
    ?.map((g) => {
      const enIdx = steamGenres["en"]?.indexOf(g);
      return enIdx !== undefined && enIdx >= 0
        ? (steamGenres["pt"]?.[enIdx] ?? g)
        : g;
    })
    .slice(0, 3);

  const [sourcesHovered, setSourcesHovered] = useState(false);
  const [sourcesCoords, setSourcesCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    if (!sourcesHovered) return;

    const handleDismiss = () => {
      setSourcesHovered(false);
    };

    window.addEventListener("blur", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);
    document.addEventListener("visibilitychange", handleDismiss);

    return () => {
      window.removeEventListener("blur", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
      document.removeEventListener("visibilitychange", handleDismiss);
    };
  }, [sourcesHovered]);

  const handleSourcesMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSourcesCoords({
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
    setSourcesHovered(true);
  };

  const handleSourcesMouseLeave = () => {
    setSourcesHovered(false);
  };

  return (
    <div
      className="cat-card"
      onClick={() => navigate(buildGameDetailsPath(game))}
      role="button"
      tabIndex={0}
      onKeyDown={(e) =>
        e.key === "Enter" && navigate(buildGameDetailsPath(game))
      }
      aria-label={game.title}
    >
      {/* Cover image area - fixed ratio */}
      <div className="cat-card__cover-wrap">
        {activeSrc && !finalFailed ? (
          <>
            <img
              src={activeSrc}
              alt={game.title}
              className="cat-card__cover"
              loading="lazy"
              onError={() => {
                if (!primaryFailed) {
                  setPrimaryFailed(true);
                } else {
                  setFinalFailed(true);
                }
              }}
            />
            {activeSrc === heroUrl && logoUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: isDarkBg
                    ? "linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 60%)"
                    : "linear-gradient(to right, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 60%)",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "16px",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              >
                <img
                  src={logoUrl}
                  alt=""
                  style={{
                    width: "55%",
                    maxHeight: "60%",
                    objectFit: "contain",
                    objectPosition: "left center",
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="cat-card__placeholder">
            <QuestionIcon size={28} />
          </div>
        )}

        {added && (
          <div className="cat-card__owned-overlay">
            <span className="cat-card__owned-text">
              <CheckIcon size={12} />
              <span>Já possui</span>
            </span>
          </div>
        )}

        <button
          type="button"
          className={cn("cat-card__action-btn", {
            "cat-card__action-btn--animate": isAnimating,
          })}
          onClick={handleLibrary}
          disabled={isBusy}
          style={{ zIndex: 2 }}
          aria-label={
            added ? "Remover da biblioteca" : "Adicionar à biblioteca"
          }
        >
          {added ? <DashIcon size={14} /> : <PlusIcon size={14} />}
        </button>
      </div>

      <div className="cat-card__info">
        <div className="cat-card__top">
          <span className="cat-card__title">{game.title}</span>
          <div
            className="cat-card__sources"
            role="presentation"
            onMouseEnter={handleSourcesMouseEnter}
            onMouseLeave={handleSourcesMouseLeave}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {game.downloadSources?.slice(0, 2).map((s) => (
              <span key={s} className="cat-card__source-badge">
                {s}
              </span>
            ))}
            {game.downloadSources && game.downloadSources.length > 2 && (
              <span className="cat-card__source-badge cat-card__source-badge--more">
                +{game.downloadSources.length - 2}
              </span>
            )}
          </div>

          {sourcesHovered &&
            sourcesCoords &&
            game.downloadSources &&
            game.downloadSources.length > 0 &&
            createPortal(
              <div
                className="cat-card__sources-tooltip-popup"
                style={{
                  position: "fixed",
                  top: sourcesCoords.top,
                  left: sourcesCoords.left,
                  transform: "translateY(-50%)",
                  zIndex: 999999,
                  pointerEvents: "none",
                }}
              >
                <div className="cat-card__sources-popup">
                  <span className="cat-card__sources-popup-title">
                    Fontes disponíveis
                  </span>
                  <div className="cat-card__sources-popup-list">
                    {game.downloadSources.map((s) => (
                      <span key={s} className="cat-card__sources-popup-badge">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>,
              document.body
            )}
        </div>
        <span className="cat-card__genres">
          {genres?.length > 0 ? genres.join(", ") : "\u00A0"}
        </span>
      </div>
    </div>
  );
}

export function CatalogueSection({
  title,
  games,
  isLoading = false,
}: Readonly<CatalogueSectionProps>) {
  if (!isLoading && !games.length) return null;

  return (
    <section className="cat-section">
      <div className="cat-section__header">
        <h2 className="cat-section__title">{title}</h2>
      </div>

      <div className="cat-section__grid">
        {isLoading
          ? Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="cat-card cat-card--skeleton">
                <div className="cat-card__cover-wrap cat-card__skeleton-img" />
                <div className="cat-card__info">
                  <div className="cat-card__skeleton-line" />
                  <div className="cat-card__skeleton-line cat-card__skeleton-line--short" />
                </div>
              </div>
            ))
          : games.map((game) => (
              <CatalogueCard key={game.id ?? game.objectId} game={game} />
            ))}
      </div>
    </section>
  );
}
