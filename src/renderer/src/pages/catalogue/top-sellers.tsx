import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CatalogueSearchResult,
  ShopDetailsWithAssets,
  ShopAssets,
} from "@types";
import { QuestionIcon } from "@primer/octicons-react";
import {
  buildGameDetailsPath,
  getSteamLanguage,
  globalImageCache,
} from "@renderer/helpers";
import { useSteamGridHeroAndLogo } from "@renderer/hooks/use-steamgrid-cover";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { useAppSelector, useLibrary } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import "./top-sellers.scss";

const TABS = [
  { key: "new", label: "Novidades populares" },
  { key: "popular", label: "Mais vendidos" },
  { key: "recent", label: "Mais recentes" },
];

interface TopSellersProps {
  games: CatalogueSearchResult[];
  isLoading?: boolean;
}

function GameRow({
  game,
  rank,
  isActive,
  onHover,
}: Readonly<{
  game: CatalogueSearchResult;
  rank: number;
  isActive: boolean;
  onHover: () => void;
}>) {
  const navigate = useNavigate();
  const genres = game.genres?.slice(0, 3).join(", ") ?? "";
  const imgRef = useRef<HTMLImageElement>(null);
  const steamHeader =
    game.shop === "steam"
      ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/header.jpg`
      : null;
  const steamCapsule =
    game.shop === "steam"
      ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/capsule_616x353.jpg`
      : null;
  const initialThumbUrl =
    game.coverImageUrl || game.libraryImageUrl || steamHeader;

  const [primaryFailed, setPrimaryFailed] = useState(!initialThumbUrl);
  const [finalFailed, setFinalFailed] = useState(false);

  const steamGridArt = useSteamGridHeroAndLogo(
    game.objectId,
    game.title,
    primaryFailed
  );

  const activeSrc = primaryFailed
    ? steamGridArt.heroUrl === undefined
      ? undefined
      : (steamGridArt.heroUrl ??
        steamCapsule ??
        game.libraryImageUrl ??
        game.coverImageUrl ??
        null)
    : initialThumbUrl;

  const [imageLoaded, setImageLoaded] = useState(() =>
    activeSrc ? globalImageCache.has(activeSrc) : false
  );

  useEffect(() => {
    setImageLoaded(activeSrc ? globalImageCache.has(activeSrc) : false);

    if (activeSrc && imgRef.current?.complete) {
      if (imgRef.current.naturalWidth > 1) {
        globalImageCache.add(activeSrc);
        setImageLoaded(true);
      } else {
        if (!primaryFailed) {
          setPrimaryFailed(true);
        } else {
          setFinalFailed(true);
        }
      }
    }
  }, [activeSrc, primaryFailed]);

  return (
    <button
      type="button"
      className={`top-sellers__row${isActive ? " top-sellers__row--active" : ""}`}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={onHover}
      aria-label={game.title}
    >
      <span className="top-sellers__rank">{rank}</span>
      <div
        className="top-sellers__thumb"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {finalFailed || activeSrc === null ? (
          <QuestionIcon size={20} />
        ) : (
          <>
            {!imageLoaded && (
              <Skeleton
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  height: "100%",
                }}
              />
            )}
            {activeSrc !== undefined && (
              <>
                <img
                  ref={imgRef}
                  key={activeSrc}
                  src={activeSrc}
                  alt={game.title}
                  loading="lazy"
                  onError={() => {
                    if (!primaryFailed) {
                      setPrimaryFailed(true);
                    } else {
                      setFinalFailed(true);
                    }
                  }}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth <= 1) {
                      if (!primaryFailed) setPrimaryFailed(true);
                      else setFinalFailed(true);
                    } else {
                      if (activeSrc) globalImageCache.add(activeSrc);
                      setImageLoaded(true);
                    }
                  }}
                  style={{
                    opacity: imageLoaded
                      ? primaryFailed && steamGridArt.logoUrl
                        ? 0.6
                        : 1
                      : 0,
                    transition: "opacity 0.3s ease",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                {primaryFailed && steamGridArt.logoUrl && imageLoaded && (
                  <img
                    src={steamGridArt.logoUrl}
                    alt={`${game.title} logo`}
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      maxWidth: "85%",
                      maxHeight: "85%",
                      zIndex: 3,
                      objectFit: "contain",
                    }}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="top-sellers__meta">
        <span className="top-sellers__name">{game.title}</span>
        <span className="top-sellers__genres">{genres}</span>
      </div>
    </button>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.replace(/\./g, "").split(/[\s/]+/);
  if (parts.length < 3) return dateStr;

  const months: Record<string, string> = {
    jan: "Jan.",
    feb: "Fev.",
    mar: "Mar.",
    apr: "Abr.",
    may: "Mai.",
    jun: "Jun.",
    jul: "Jul.",
    aug: "Ago.",
    sep: "Set.",
    oct: "Out.",
    nov: "Nov.",
    dec: "Dez.",
    janeiro: "Jan.",
    fevereiro: "Fev.",
    março: "Mar.",
    abril: "Abr.",
    maio: "Mai.",
    junho: "Jun.",
    julho: "Jul.",
    agosto: "Ago.",
    setembro: "Set.",
    outubro: "Out.",
    novembro: "Nov.",
    dezembro: "Dez.",
  };

  const monthWord = parts.find((p) => isNaN(Number(p)))?.toLowerCase();
  const year = parts.find((p) => p.length === 4 && !isNaN(Number(p)));

  if (monthWord && year) {
    const month =
      months[monthWord] ||
      monthWord.charAt(0).toUpperCase() + monthWord.slice(1);
    return `${month} ${year}`;
  }

  return dateStr;
}

const detailsCache = new Map<string, ShopDetailsWithAssets>();

// Parseia formatos de data Steam: "21 Nov, 2023", "Nov 21, 2023", "Q4 2023", etc.
const parseReleaseDate = (dateStr: string | undefined): number => {
  if (!dateStr) return 0;
  // Normaliza "21 Nov, 2023" → "Nov 21, 2023"
  const normalized = dateStr.replace(
    /^(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})$/,
    "$2 $1, $3"
  );
  const ts = new Date(normalized).getTime();
  return isNaN(ts) ? 0 : ts;
};

export function TopSellers({
  games,
  isLoading = false,
}: Readonly<TopSellersProps>) {
  const [activeTab, setActiveTab] = useState("new");
  const [hoveredIndex, setHoveredIndex] = useState(0);
  const [activeGameDetails, setActiveGameDetails] =
    useState<ShopDetailsWithAssets | null>(null);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [isHoveringPanel, setIsHoveringPanel] = useState(false);
  const panelImgRef = useRef<HTMLImageElement>(null);
  const [panelImageLoaded, setPanelImageLoaded] = useState(() => {
    // Only check if it's the active media full url
    return false; // Initialize correctly in effect based on activeMedia
  });
  const [releaseTimestamps, setReleaseTimestamps] = useState<
    Record<string, number>
  >({});
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortFetchRef = useRef<AbortController | null>(null);
  const { i18n } = useTranslation("catalogue");
  const navigate = useNavigate();

  const { downloadSources } = useCatalogue();
  const [steamTrending, setSteamTrending] = useState<{
    topSellers: ShopAssets[];
    newReleases: ShopAssets[];
    comingSoon: ShopAssets[];
    specials: ShopAssets[];
  } | null>(null);
  const [isSteamLoading, setIsSteamLoading] = useState(true);
  const [recentGames, setRecentGames] = useState<CatalogueSearchResult[]>([]);
  const [isRecentLoading, setIsRecentLoading] = useState(false);

  useEffect(() => {
    setIsSteamLoading(true);
    if (typeof window.electron.getSteamTrending === "function") {
      window.electron
        .getSteamTrending(getSteamLanguage(i18n.language))
        .then((data) => {
          setSteamTrending(data);
        })
        .catch(() => {})
        .finally(() => {
          setIsSteamLoading(false);
        });
    } else {
      setIsSteamLoading(false);
    }
  }, [i18n.language]);

  const { library } = useLibrary();
  const { hideOwned } = useAppSelector((s) => s.catalogueSearch);

  const isOwned = useCallback(
    (g: { shop?: string; objectId: string | number }) =>
      library.some(
        (l) =>
          (g.shop ? l.shop === g.shop : true) &&
          String(l.objectId) === String(g.objectId)
      ),
    [library]
  );

  useEffect(() => {
    setIsRecentLoading(true);
    let isCancelled = false;

    async function fetchRecent() {
      try {
        const collected: CatalogueSearchResult[] = [];
        let skip = 0;
        let attempts = 4;

        while (attempts > 0 && !isCancelled) {
          attempts--;
          const res = await window.electron.hydraApi.post<{
            edges: CatalogueSearchResult[];
            count: number;
          }>("/catalogue/search", {
            data: {
              sortBy: "releaseDate",
              sortOrder: "desc",
              take: 25,
              skip,
              downloadSourceIds: downloadSources.map((s) => s.id),
            },
            needsAuth: false,
          });

          const edges = res?.edges || [];
          if (edges.length === 0) break;

          for (const edge of edges) {
            if (hideOwned && isOwned(edge)) continue;
            if (
              !collected.some(
                (g) => String(g.objectId) === String(edge.objectId)
              )
            ) {
              collected.push(edge);
            }
            if (collected.length >= 10) break;
          }

          if (collected.length >= 10 || edges.length < 25) break;
          skip += edges.length;
        }

        if (!isCancelled && collected.length > 0) {
          setRecentGames(collected);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!isCancelled) {
          setIsRecentLoading(false);
        }
      }
    }

    fetchRecent();

    return () => {
      isCancelled = true;
    };
  }, [downloadSources, hideOwned, isOwned]);

  const cleanGames = useMemo(() => {
    if (!hideOwned) return games;
    return games.filter((g) => !isOwned(g));
  }, [games, hideOwned, isOwned]);

  const tabGames = useMemo(() => {
    const localPopular = [...cleanGames].sort(
      (a, b) =>
        (b.downloadSources?.length ?? 0) - (a.downloadSources?.length ?? 0)
    );

    const fillToTen = (
      steamList: ShopAssets[],
      fallbackList: CatalogueSearchResult[]
    ) => {
      const filteredSteam = hideOwned
        ? steamList.filter((sg) => !isOwned(sg))
        : steamList;

      let result = filteredSteam.map((steamGame) => {
        const localEquiv = cleanGames.find(
          (g) => String(g.objectId) === String(steamGame.objectId)
        );
        if (localEquiv) {
          return {
            ...localEquiv,
            coverImageUrl: steamGame.coverImageUrl,
            libraryImageUrl: steamGame.libraryImageUrl,
          } as CatalogueSearchResult;
        }
        return steamGame as unknown as CatalogueSearchResult;
      });

      if (hideOwned) {
        result = result.filter((g) => !isOwned(g));
      }

      if (result.length < 10 && fallbackList.length > 0) {
        const cleanFallback = hideOwned
          ? fallbackList.filter((lg) => !isOwned(lg))
          : fallbackList;
        const remaining = cleanFallback.filter(
          (lg) =>
            !result.some((rg) => String(rg.objectId) === String(lg.objectId))
        );
        result = [...result, ...remaining];
      }
      return result.slice(0, 10);
    };

    if (
      activeTab === "popular" &&
      steamTrending?.topSellers &&
      steamTrending.topSellers.length > 0
    ) {
      return fillToTen(steamTrending.topSellers, localPopular);
    }

    if (
      activeTab === "new" &&
      steamTrending?.newReleases &&
      steamTrending.newReleases.length > 0
    ) {
      const localNew = [...cleanGames].sort((a, b) => {
        const tsA = releaseTimestamps[a.objectId];
        const tsB = releaseTimestamps[b.objectId];
        if (tsA && tsB) return tsB - tsA;
        if (tsA) return -1;
        if (tsB) return 1;
        return parseInt(b.objectId) - parseInt(a.objectId);
      });
      return fillToTen(steamTrending.newReleases, localNew);
    }

    if (activeTab === "recent") {
      const cleanRecent = hideOwned
        ? recentGames.filter((g) => !isOwned(g))
        : recentGames;
      if (cleanRecent.length >= 10) {
        return cleanRecent.slice(0, 10);
      }
      const sorted = [...cleanGames].sort((a, b) => {
        const yearA = a.releaseYear ?? 0;
        const yearB = b.releaseYear ?? 0;
        if (yearA !== yearB) return yearB - yearA;
        const tsA = releaseTimestamps[a.objectId];
        const tsB = releaseTimestamps[b.objectId];
        if (tsA && tsB) return tsB - tsA;
        return parseInt(b.objectId) - parseInt(a.objectId);
      });
      const combined = [
        ...cleanRecent,
        ...sorted.filter(
          (sg) =>
            !cleanRecent.some(
              (rg) => String(rg.objectId) === String(sg.objectId)
            )
        ),
      ];
      return combined.slice(0, 10);
    }

    if (!cleanGames.length) return [];

    if (activeTab === "popular") {
      return localPopular.slice(0, 10);
    }

    return [...cleanGames]
      .sort((a, b) => {
        const tsA = releaseTimestamps[a.objectId];
        const tsB = releaseTimestamps[b.objectId];
        if (tsA && tsB) return tsB - tsA;
        if (tsA) return -1;
        if (tsB) return 1;
        return parseInt(b.objectId) - parseInt(a.objectId);
      })
      .slice(0, 10);
  }, [
    activeTab,
    cleanGames,
    hideOwned,
    isOwned,
    recentGames,
    releaseTimestamps,
    steamTrending,
  ]);

  // Pré-busca datas de lançamento em lotes de 5 quando a aba "Lançamentos" está ativa
  useEffect(() => {
    if ((activeTab !== "new" && activeTab !== "recent") || !games.length)
      return;

    abortFetchRef.current?.abort();
    const abort = new AbortController();
    abortFetchRef.current = abort;

    const fetchBatch = async (batch: CatalogueSearchResult[]) => {
      await Promise.all(
        batch.map(async (game) => {
          if (abort.signal.aborted) return;
          const cached = detailsCache.get(game.objectId);
          const source = cached
            ? cached
            : await window.electron
                .getGameShopDetails(
                  game.objectId,
                  game.shop,
                  getSteamLanguage(i18n.language)
                )
                .catch(() => null);
          if (source && !abort.signal.aborted) {
            detailsCache.set(game.objectId, source);
            const ts = parseReleaseDate(source.release_date?.date);
            if (ts > 0) {
              setReleaseTimestamps((prev) => ({
                ...prev,
                [game.objectId]: ts,
              }));
            }
          }
        })
      );
    };

    const run = async () => {
      const BATCH = 5;
      for (let i = 0; i < games.length; i += BATCH) {
        if (abort.signal.aborted) break;
        await fetchBatch(games.slice(i, i + BATCH));
      }
    };

    run();
    return () => abort.abort();
  }, [activeTab, games, i18n.language]);

  const activeGame = tabGames[hoveredIndex] ?? tabGames[0];
  const activeGameRef = useRef<CatalogueSearchResult | null>(null);
  activeGameRef.current = activeGame ?? null;

  // Pré-carrega detalhes e imagens de todos os 10 jogos da aba ativa em paralelo
  useEffect(() => {
    if (!tabGames.length) return;

    const lang = getSteamLanguage(i18n.language);
    tabGames.forEach((game) => {
      const key = game.objectId;
      if (detailsCache.has(key)) return;

      window.electron
        .getGameShopDetails(key, game.shop, lang)
        .then((result) => {
          if (result) {
            detailsCache.set(key, result);

            // Pré-carrega as imagens das screenshots na memória do navegador
            result.screenshots?.slice(0, 4).forEach((s) => {
              if (s.path_thumbnail) {
                const img = new Image();
                img.src = s.path_thumbnail;
              }
              if (s.path_full) {
                const fullImg = new Image();
                fullImg.src = s.path_full;
              }
            });

            // Se for o jogo que está sendo visualizado no momento, atualiza instantaneamente
            if (activeGameRef.current?.objectId === key) {
              setActiveGameDetails(result);
            }
          }
        })
        .catch(() => {});
    });
  }, [tabGames, i18n.language]);

  const mediaItems = useMemo(() => {
    const items: { thumb: string; full: string }[] = [];
    if (
      activeGameDetails?.screenshots &&
      activeGameDetails.screenshots.length > 0
    ) {
      activeGameDetails.screenshots.slice(0, 4).forEach((s) => {
        items.push({ thumb: s.path_thumbnail, full: s.path_full });
      });
    } else {
      const fallbackUrl =
        activeGame?.coverImageUrl || activeGame?.libraryImageUrl;
      if (fallbackUrl) {
        items.push({
          thumb: fallbackUrl,
          full: fallbackUrl,
        });
      }
    }
    return items;
  }, [activeGame, activeGameDetails]);

  const activeMedia = mediaItems[selectedMediaIndex] ?? mediaItems[0];

  useEffect(() => {
    setSelectedMediaIndex(0);
    if (!activeGame) {
      setActiveGameDetails(null);
      return;
    }

    const key = activeGame.objectId;
    const cached = detailsCache.get(key);
    if (cached) {
      setActiveGameDetails(cached);
      return;
    }

    // Se ainda não estiver em cache, busca imediatamente sem atraso artificial
    setActiveGameDetails(null);
    window.electron
      .getGameShopDetails(key, activeGame.shop, getSteamLanguage(i18n.language))
      .then((result) => {
        if (result) {
          detailsCache.set(key, result);
          if (activeGameRef.current?.objectId === key) {
            setActiveGameDetails(result);
          }
        }
      })
      .catch(() => {});
  }, [activeGame, i18n.language]);

  // Autoplay: avança a imagem a cada 3s, pausa no hover
  useEffect(() => {
    if (mediaItems.length <= 1) return;
    if (isHoveringPanel) {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
      return;
    }
    autoplayRef.current = setInterval(() => {
      setSelectedMediaIndex((prev) => (prev + 1) % mediaItems.length);
    }, 3000);
    return () => {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
    };
  }, [mediaItems.length, isHoveringPanel]);

  useEffect(() => {
    setPanelImageLoaded(
      activeMedia ? globalImageCache.has(activeMedia.full) : false
    );
    if (
      activeMedia &&
      panelImgRef.current?.complete &&
      panelImgRef.current.naturalWidth > 1
    ) {
      globalImageCache.add(activeMedia.full);
      setPanelImageLoaded(true);
    }
  }, [activeMedia]);

  if (!isLoading && !isSteamLoading && !games.length && !steamTrending)
    return null;

  return (
    <section className="top-sellers">
      <div className="top-sellers__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`top-sellers__tab${activeTab === tab.key ? " top-sellers__tab--active" : ""}`}
            onClick={() => {
              setActiveTab(tab.key);
              setHoveredIndex(0);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="top-sellers__body">
        <div className="top-sellers__list">
          {(
            activeTab === "recent"
              ? isRecentLoading && recentGames.length === 0
              : isLoading || isSteamLoading
          )
            ? Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="top-sellers__row top-sellers__row--skeleton"
                >
                  <div className="top-sellers__skeleton-thumb" />
                  <div className="top-sellers__skeleton-meta">
                    <div className="top-sellers__skeleton-line" />
                    <div className="top-sellers__skeleton-line top-sellers__skeleton-line--short" />
                  </div>
                </div>
              ))
            : tabGames.map((game, i) => (
                <GameRow
                  key={game.id ?? game.objectId}
                  game={game}
                  rank={i + 1}
                  isActive={i === hoveredIndex}
                  onHover={() => setHoveredIndex(i)}
                />
              ))}
        </div>

        {activeGame &&
          !(activeTab === "recent"
            ? isRecentLoading && recentGames.length === 0
            : isLoading || isSteamLoading) && (
            <div
              className="top-sellers__panel"
              onMouseEnter={() => setIsHoveringPanel(true)}
              onMouseLeave={() => setIsHoveringPanel(false)}
            >
              <div
                role="button"
                tabIndex={0}
                className="top-sellers__detail"
                onClick={() => navigate(buildGameDetailsPath(activeGame))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    navigate(buildGameDetailsPath(activeGame));
                  }
                }}
                aria-label={`Ver detalhes de ${activeGame.title}`}
              >
                <div className="top-sellers__detail-header">
                  {activeGame.title}
                </div>

                <div className="top-sellers__detail-body">
                  <div className="top-sellers__cover-section">
                    <div
                      className="top-sellers__detail-cover"
                      style={{ position: "relative" }}
                    >
                      {activeMedia ? (
                        <>
                          {!panelImageLoaded && (
                            <Skeleton
                              style={{
                                position: "absolute",
                                inset: 0,
                                zIndex: 2,
                                height: "100%",
                                borderRadius: "inherit",
                              }}
                            />
                          )}
                          <img
                            ref={panelImgRef}
                            key={activeMedia.full}
                            src={activeMedia.full}
                            alt={activeGame.title}
                            loading="lazy"
                            onLoad={(e) => {
                              if (e.currentTarget.naturalWidth <= 1) {
                                setPanelImageLoaded(false);
                              } else {
                                if (activeMedia)
                                  globalImageCache.add(activeMedia.full);
                                setPanelImageLoaded(true);
                              }
                            }}
                            style={{
                              opacity: panelImageLoaded ? 1 : 0,
                              transition: "opacity 0.3s ease",
                            }}
                          />
                        </>
                      ) : (
                        <div className="top-sellers__detail-placeholder">
                          <QuestionIcon size={40} />
                        </div>
                      )}
                    </div>

                    {mediaItems.length > 1 && (
                      <div className="top-sellers__media-previews">
                        {mediaItems.slice(0, 4).map((m, i) => (
                          <button
                            key={m.thumb}
                            type="button"
                            className={`top-sellers__media-preview${i === selectedMediaIndex ? " top-sellers__media-preview--active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMediaIndex(i);
                            }}
                          >
                            <img src={m.thumb} alt="Preview" loading="lazy" />
                            {i === selectedMediaIndex && (
                              <span
                                className="top-sellers__media-progress"
                                key={`${activeGame.objectId}-${i}`}
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {activeGame.genres?.length > 0 && (
                      <div className="top-sellers__detail-tags">
                        {activeGame.genres.slice(0, 4).map((g) => (
                          <span key={g} className="top-sellers__detail-tag">
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="top-sellers__detail-info">
                    {activeGameDetails?.short_description && (
                      <div className="top-sellers__detail-description">
                        {activeGameDetails.short_description}
                      </div>
                    )}

                    <div className="top-sellers__detail-grid">
                      {((activeGameDetails as any)?.developers?.[0] ||
                        activeGame.developers?.[0]) && (
                        <div className="top-sellers__detail-block">
                          <span className="top-sellers__detail-label">
                            Desenvolvedor:
                          </span>
                          <span className="top-sellers__detail-value">
                            {(activeGameDetails as any)?.developers?.[0] ??
                              activeGame.developers?.[0]}
                          </span>
                        </div>
                      )}

                      {((activeGameDetails as any)?.publishers?.[0] ||
                        activeGame.publishers?.[0]) && (
                        <div className="top-sellers__detail-block">
                          <span className="top-sellers__detail-label">
                            Distribuidora:
                          </span>
                          <span className="top-sellers__detail-value">
                            {(activeGameDetails as any)?.publishers?.[0] ??
                              activeGame.publishers?.[0]}
                          </span>
                        </div>
                      )}

                      {(activeGameDetails?.release_date?.date ||
                        activeGame.releaseYear) && (
                        <div className="top-sellers__detail-block">
                          <span className="top-sellers__detail-label">
                            Lançamento:
                          </span>
                          <span className="top-sellers__detail-value">
                            {activeGameDetails?.release_date?.date
                              ? formatDate(activeGameDetails.release_date.date)
                              : String(activeGame.releaseYear)}
                          </span>
                        </div>
                      )}

                      {(activeGameDetails as any)?.metacritic?.score && (
                        <div className="top-sellers__detail-block">
                          <span className="top-sellers__detail-label">
                            Metacritic:
                          </span>
                          <span
                            className="top-sellers__detail-value"
                            style={{ color: "#2ecc71" }}
                          >
                            {(activeGameDetails as any).metacritic.score}
                          </span>
                        </div>
                      )}
                    </div>

                    <div
                      className="top-sellers__detail-block"
                      style={{ marginTop: "16px" }}
                    >
                      <span className="top-sellers__detail-label">Fontes:</span>
                      <div className="top-sellers__detail-sources">
                        {activeGame.downloadSources &&
                        activeGame.downloadSources.length > 0 ? (
                          activeGame.downloadSources.map((source) => (
                            <span
                              key={source}
                              className="top-sellers__detail-source-badge"
                            >
                              {source}
                            </span>
                          ))
                        ) : (
                          <span className="top-sellers__detail-source-badge top-sellers__detail-source-badge--none">
                            Sem fontes de download
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    </section>
  );
}
