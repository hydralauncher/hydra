import type {
  CatalogueSearchResult,
  CatalogueSearchPayload,
  DownloadSource,
} from "@types";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { useLibrary } from "@renderer/hooks/use-library";
import { useLaunchboxFilters } from "@renderer/hooks/use-launchbox-filters";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./catalogue.scss";
import { setFilters, setPage, type CatalogueMode } from "@renderer/features";
import { useTranslation } from "react-i18next";
import { Pagination } from "./pagination";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { FilterItem } from "./filter-item";
import { Button } from "@renderer/components/button/button";
import {
  TagIcon,
  DownloadIcon,
  PeopleIcon,
  BriefcaseIcon,
  ProjectIcon,
  DeviceDesktopIcon,
  CalendarIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { FeaturedCarousel } from "./featured-carousel";
import { CatalogueSection } from "./catalogue-section";
import { CategoryExplorer } from "./category-explorer";
import { TopSellers } from "./top-sellers";
import { GameItem } from "./game-item";
import { GameItemClassics } from "./game-item-classics";
import { Tooltip } from "react-tooltip";

type CompatibilityThreshold<Value extends string> = {
  value: string;
  labelKey: string;
  values: Value[];
  color?: string;
};

const clearAllCategoryFilters = {
  genres: [],
  tags: [],
  downloadSourceFingerprints: [],
  developers: [],
  publishers: [],
  protondbSupportBadges: [],
  deckCompatibility: [],
  releaseYear: undefined,
  platforms: [],
};

const protonCompatibilityThresholds: CompatibilityThreshold<
  CatalogueSearchPayload["protondbSupportBadges"][number]
>[] = [
  {
    value: "silver_plus",
    labelKey: "protondb_silver_plus",
    values: ["silver", "gold", "platinum"],
    color: "rgb(166,166,166)",
  },
  {
    value: "gold_plus",
    labelKey: "protondb_gold_plus",
    values: ["gold", "platinum"],
    color: "rgb(207,181,59)",
  },
  {
    value: "platinum_only",
    labelKey: "protondb_platinum_only",
    values: ["platinum"],
    color: "rgb(180,199,220)",
  },
];

const areSameValues = (a: string[], b: string[]) =>
  a.length === b.length && a.every((i) => b.includes(i));

const SECTION_SIZE = 15;

const catalogueCacheMap = new Map<
  string,
  { edges: CatalogueSearchResult[]; count: number }
>();

export default function Catalogue() {
  const requestSequenceRef = useRef(0);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const { downloadSources } = useCatalogue();
  const { library } = useLibrary();
  const {
    steamGenres,
    steamUserTags,
    filters,
    page,
    mode,
    viewMode,
    hideOwned,
  } = useAppSelector((state) => state.catalogueSearch);
  const launchboxFilters = useLaunchboxFilters(mode === "classics");

  const [isLoading, setIsLoading] = useState(true);
  const [results, setResults] = useState<CatalogueSearchResult[]>([]);
  const [itemsCount, setItemsCount] = useState(0);
  const [resultsMode, setResultsMode] = useState<CatalogueMode>(mode);
  const pageSize = 100;
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation("catalogue");
  const shouldShowProtonFeatures = window.electron.platform === "linux";

  const hasActiveFilters = useMemo(
    () =>
      mode === "classics" ||
      viewMode === "all" ||
      filters.genres.length > 0 ||
      filters.tags.length > 0 ||
      filters.downloadSourceFingerprints.length > 0 ||
      filters.developers.length > 0 ||
      filters.publishers.length > 0 ||
      filters.protondbSupportBadges.length > 0 ||
      filters.deckCompatibility.length > 0 ||
      filters.releaseYear !== undefined ||
      (filters.platforms && filters.platforms.length > 0) ||
      (filters.title?.trim().length ?? 0) > 0,
    [filters, mode, viewMode]
  );

  const isGameOwned = useCallback(
    (game: CatalogueSearchResult) =>
      library.some(
        (l) =>
          l.shop === game.shop && String(l.objectId) === String(game.objectId)
      ),
    [library]
  );

  const searchCatalogue = useCallback(
    async (
      filtersArg: CatalogueSearchPayload,
      sources: DownloadSource[],
      take: number,
      offset: number,
      activeMode: CatalogueMode,
      cacheKey: string,
      requestId: number
    ) => {
      try {
        const { platforms, ...restFilters } = filtersArg;

        const ps2 = launchboxFilters.platforms.find(
          (p) =>
            p.name.toLowerCase().includes("playstation 2") ||
            p.key.toLowerCase().includes("playstation 2") ||
            p.key.toLowerCase() === "ps2"
        );
        const fallbackPlatform = ps2
          ? [ps2.key]
          : launchboxFilters.platforms[0]
            ? [launchboxFilters.platforms[0].key]
            : ["ps2"];

        const collected: CatalogueSearchResult[] = [];
        let currentSkip = offset;
        let totalCount = 0;
        let loops = 8;

        while (loops > 0) {
          loops--;
          const requestData =
            activeMode === "classics"
              ? {
                  title: restFilters.title ?? "",
                  sortBy: restFilters.sortBy ?? "popularity",
                  sortOrder: restFilters.sortOrder ?? "desc",
                  shops: ["launchbox"],
                  platforms:
                    platforms && platforms.length > 0
                      ? platforms
                      : fallbackPlatform,
                  genres: restFilters.genres ?? [],
                  downloadSourceFingerprints:
                    restFilters.downloadSourceFingerprints ?? [],
                  developers: restFilters.developers ?? [],
                  publishers: restFilters.publishers ?? [],
                  take: 25,
                  skip: currentSkip,
                  downloadSourceIds: sources.map((s) => s.id),
                }
              : {
                  ...restFilters,
                  take: 25,
                  skip: currentSkip,
                  downloadSourceIds: sources.map((s) => s.id),
                };

          const response = await window.electron.hydraApi.post<{
            edges: CatalogueSearchResult[];
            count: number;
          }>("/catalogue/search", {
            data: requestData,
            needsAuth: false,
          });

          if (requestId !== requestSequenceRef.current) return;

          const edges = response?.edges || [];
          totalCount = response?.count || 0;

          if (edges.length === 0) break;

          for (const edge of edges) {
            if (hideOwned && isGameOwned(edge)) continue;
            if (
              !collected.some(
                (g) =>
                  g.id === edge.id ||
                  (g.shop === edge.shop &&
                    String(g.objectId) === String(edge.objectId))
              )
            ) {
              collected.push(edge);
            }
            if (collected.length >= take) break;
          }

          if (collected.length >= take || edges.length < 25) {
            break;
          }

          currentSkip += edges.length;
        }

        if (requestId !== requestSequenceRef.current) return;

        setResults(collected);
        setResultsMode(activeMode);
        setItemsCount(totalCount);
        catalogueCacheMap.set(cacheKey, {
          edges: collected,
          count: totalCount,
        });
      } catch (err) {
        if (requestId === requestSequenceRef.current) {
          console.error(err);
        }
      } finally {
        if (requestId === requestSequenceRef.current) {
          setIsLoading(false);
        }
      }
    },
    [launchboxFilters.platforms, hideOwned, isGameOwned]
  );

  const decodeHTML = (s: string) =>
    s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

  useEffect(() => {
    const requestId = ++requestSequenceRef.current;
    const takeAmount = hasActiveFilters ? pageSize : 100;

    const key = JSON.stringify({
      filtersArg: filters,
      sources: downloadSources,
      take: takeAmount,
      offset: (page - 1) * pageSize,
      activeMode: mode,
      hideOwned,
    });

    const cached = catalogueCacheMap.get(key);
    if (cached) {
      setResults(cached.edges);
      setItemsCount(cached.count);
      setResultsMode(mode);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    searchCatalogue(
      filters,
      downloadSources,
      takeAmount,
      (page - 1) * pageSize,
      mode,
      key,
      requestId
    );
  }, [
    filters,
    downloadSources,
    page,
    pageSize,
    mode,
    hasActiveFilters,
    hideOwned,
    searchCatalogue,
  ]);

  const language = i18n.language.split("-")[0];

  const steamGenresMapping = useMemo<Record<string, string>>(() => {
    if (!steamGenres[language]) return {};
    return steamGenres[language].reduce(
      (acc, genre, i) => {
        acc[genre] = steamGenres["en"][i];
        return acc;
      },
      {} as Record<string, string>
    );
  }, [steamGenres, language]);

  const groupedFilters = useMemo(() => {
    const protonThreshold = protonCompatibilityThresholds.find((t) =>
      areSameValues(t.values, filters.protondbSupportBadges)
    );
    const deckCompatible = areSameValues(filters.deckCompatibility, [
      "playable",
      "verified",
    ]);

    return [
      ...(filters.releaseYear !== undefined
        ? [
            {
              label: `${filters.releaseYear.gte ?? 1970} — ${filters.releaseYear.lte ?? new Date().getFullYear()}`,
              filterType: t("release_year", { defaultValue: "Ano" }),
              icon: <CalendarIcon size={14} />,
              key: "releaseYear",
              value: "range",
            },
          ]
        : []),
      ...filters.genres.map((genre) => ({
        label:
          Object.keys(steamGenresMapping).find(
            (k) => steamGenresMapping[k] === genre
          ) || genre,
        filterType: t("genres"),
        icon: <ProjectIcon size={14} />,
        key: "genres",
        value: genre,
      })),
      ...filters.tags.map((tag) => ({
        label: Object.keys(steamUserTags[language] ?? {}).find(
          (k) => steamUserTags[language][k] === tag
        ),
        filterType: t("tags"),
        icon: <TagIcon size={14} />,
        key: "tags",
        value: tag,
      })),
      ...filters.downloadSourceFingerprints.map((fp) => ({
        label: downloadSources.find((s) => s.fingerprint === fp)
          ?.name as string,
        filterType: t("download_sources"),
        icon: <DownloadIcon size={14} />,
        key: "downloadSourceFingerprints",
        value: fp,
      })),
      ...filters.developers.map((dev) => ({
        label: dev,
        filterType: t("developers"),
        icon: <PeopleIcon size={14} />,
        key: "developers",
        value: dev,
      })),
      ...filters.publishers.map((pub) => ({
        label: decodeHTML(pub),
        filterType: t("publishers"),
        icon: <BriefcaseIcon size={14} />,
        key: "publishers",
        value: pub,
      })),
      ...(shouldShowProtonFeatures && protonThreshold?.values.length
        ? [
            {
              label: t(protonThreshold.labelKey),
              filterType: t("protondb"),
              icon: <DeviceDesktopIcon size={14} />,
              key: "protondbSupportBadges",
              value: "threshold",
            },
          ]
        : []),
      ...(shouldShowProtonFeatures && deckCompatible
        ? [
            {
              label: t("steam_deck_compatible"),
              filterType: t("steam_deck_minimum"),
              icon: <DeviceDesktopIcon size={14} />,
              key: "deckCompatibility",
              value: "threshold",
            },
          ]
        : []),
    ];
  }, [
    filters,
    steamUserTags,
    downloadSources,
    steamGenresMapping,
    launchboxFilters.platforms,
    language,
    shouldShowProtonFeatures,
    t,
  ]);

  const selectedFiltersCount = groupedFilters.length;

  const handleGenreClick = useCallback(
    (genre: string) => {
      const enKey = steamGenresMapping[genre];
      if (enKey) dispatch(setFilters({ genres: [enKey] }));
    },
    [steamGenresMapping, dispatch]
  );

  const dailyShuffled = useMemo(() => {
    if (!results.length) return [];
    const today = new Date();
    let seed =
      today.getFullYear() * 10000 +
      (today.getMonth() + 1) * 100 +
      today.getDate();
    const copy = [...results];
    for (let i = copy.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const j = seed % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }, [results]);

  const displayedResults = useMemo(() => {
    if (!hideOwned) return results;
    return results.filter((g) => !isGameOwned(g));
  }, [results, hideOwned, isGameOwned]);

  const displayedDailyShuffled = useMemo(() => {
    if (!dailyShuffled.length) return [];
    if (!hideOwned) return dailyShuffled;
    return dailyShuffled.filter((g) => !isGameOwned(g));
  }, [dailyShuffled, hideOwned, isGameOwned]);

  const displayedFeaturedGames = useMemo(
    () => displayedResults.slice(0, 13),
    [displayedResults]
  );

  const displayedSections = useMemo(() => {
    if (hasActiveFilters) return [];
    const inLibraryIds = new Set(library.map((l) => l.objectId));
    const notInLibrary = displayedResults.filter(
      (g) => !inLibraryIds.has(g.objectId)
    );
    const destaques = displayedDailyShuffled.slice(0, SECTION_SIZE);
    const populares = displayedResults.slice(SECTION_SIZE, SECTION_SIZE * 2);
    const recomendados = notInLibrary.slice(0, SECTION_SIZE);

    return [
      { title: "Destaques do Dia", games: destaques },
      { title: "Mais Populares", games: populares },
      { title: "Recomendados para Você", games: recomendados },
    ].filter((s) => s.games.length > 0);
  }, [displayedResults, displayedDailyShuffled, hasActiveFilters, library]);

  return (
    <div className="catalogue" ref={cataloguePageRef}>
      {/* Active filter tags */}
      {selectedFiltersCount > 0 && (
        <div className="catalogue__active-filters">
          <ul className="catalogue__filters-list">
            {groupedFilters.map((filter) => (
              <li key={`${filter.key}-${filter.value}`}>
                <FilterItem
                  filter={filter.label ?? ""}
                  filterType={filter.filterType}
                  icon={filter.icon}
                  onRemove={() => {
                    if (filter.value === "range") {
                      dispatch(setFilters({ releaseYear: undefined }));
                      return;
                    }
                    if (filter.value === "threshold") {
                      dispatch(setFilters({ [filter.key]: [] }));
                      return;
                    }
                    dispatch(
                      setFilters({
                        [filter.key]: (
                          (filters[
                            filter.key as keyof typeof filters
                          ] as string[]) || []
                        ).filter((i) => i !== filter.value),
                      })
                    );
                  }}
                />
              </li>
            ))}
          </ul>
          <Button
            type="button"
            theme="outline"
            className="catalogue__clear-btn"
            onClick={() => dispatch(setFilters(clearAllCategoryFilters))}
          >
            {t("clear_filters_button", { defaultValue: "Limpar Filtros" })}
          </Button>
        </div>
      )}

      <div className="catalogue__content">
        {/* Curated Highlights View (Modern mode only) */}
        {!hasActiveFilters && (
          <>
            <FeaturedCarousel games={isLoading ? [] : displayedFeaturedGames} />
            {displayedSections.map((s) => (
              <CatalogueSection
                key={s.title}
                title={s.title}
                games={s.games}
                isLoading={isLoading}
              />
            ))}
            {isLoading && (
              <>
                <CatalogueSection
                  title="Destaques do Dia"
                  games={[]}
                  isLoading
                />
                <CatalogueSection title="Mais Populares" games={[]} isLoading />
              </>
            )}
            <CategoryExplorer onSelectGenre={handleGenreClick} />
            <TopSellers games={displayedResults} isLoading={isLoading} />
          </>
        )}

        {/* Full Catalogue Grid / Filtered Results / Classics View */}
        {hasActiveFilters && (
          <div
            className={cn("catalogue__games-container", {
              "catalogue__games-container--classics":
                resultsMode === "classics" || mode === "classics",
            })}
          >
            {isLoading || resultsMode !== mode ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  textAlign: "center",
                  padding: "60px 0",
                  color: "rgba(255, 255, 255, 0.4)",
                  fontSize: "13px",
                }}
              >
                {t("loading", { defaultValue: "Carregando jogos..." })}
              </div>
            ) : mode === "classics" ? (
              displayedResults.map((game) => (
                <GameItemClassics key={game.id} game={game} />
              ))
            ) : (
              displayedResults.map((game) => (
                <GameItem key={game.id} game={game} />
              ))
            )}

            <div className="catalogue__pagination-container">
              <Pagination
                page={page}
                totalPages={Math.ceil(itemsCount / pageSize)}
                onPageChange={(p) => {
                  dispatch(setPage(p));
                  if (cataloguePageRef.current)
                    cataloguePageRef.current.scrollTop = 0;
                }}
              />
            </div>
          </div>
        )}
      </div>

      <Tooltip
        id="classics-tooltip"
        style={{
          zIndex: 9999,
          backgroundColor: "#141416",
          color: "#fff",
          borderRadius: "8px",
          fontSize: "12px",
          fontWeight: 500,
          padding: "6px 12px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.8)",
        }}
      />
    </div>
  );
}
