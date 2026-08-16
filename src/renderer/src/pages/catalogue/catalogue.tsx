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

const SECTION_SIZE = 14;

let globalCachedResults: CatalogueSearchResult[] | null = null;
let globalCachedCount: number = 0;
let globalCachedPage: number = 1;
let globalCachedKey: string = "";

const getCachedResults = () => {
  if (globalCachedResults) return globalCachedResults;
  if ((window as any).__HYDRA_CATALOGUE_CACHE__) {
    const cache = (window as any).__HYDRA_CATALOGUE_CACHE__;
    globalCachedResults = cache.results;
    globalCachedCount = cache.count;
    globalCachedPage = cache.page;
    globalCachedKey = cache.key;
  }
  return globalCachedResults;
};

export default function Catalogue() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const { downloadSources } = useCatalogue();
  const { library } = useLibrary();
  const { steamGenres, steamUserTags, filters, page, mode, viewMode } =
    useAppSelector((state) => state.catalogueSearch);
  const launchboxFilters = useLaunchboxFilters(mode === "classics");

  const [isLoading, setIsLoading] = useState(
    getCachedResults() === null || globalCachedPage !== page
  );
  const [results, setResults] = useState<CatalogueSearchResult[]>(
    globalCachedPage === page ? getCachedResults() || [] : []
  );
  const [itemsCount, setItemsCount] = useState(
    globalCachedPage === page ? globalCachedCount : 0
  );
  const [resultsMode, setResultsMode] = useState<CatalogueMode>(mode);
  const pageSize = mode === "classics" ? 104 : 80;
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

  const searchCatalogue = useCallback(
    async (
      filtersArg: CatalogueSearchPayload,
      sources: DownloadSource[],
      take: number,
      offset: number,
      activeMode: CatalogueMode
    ) => {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
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
            : ["Sony Playstation 2"];

        const requestData =
          activeMode === "classics"
            ? {
                title: filtersArg.title ?? "",
                sortBy: filtersArg.sortBy ?? "popularity",
                sortOrder: filtersArg.sortOrder ?? "desc",
                shops: ["launchbox"],
                platforms:
                  filtersArg.platforms && filtersArg.platforms.length > 0
                    ? filtersArg.platforms
                    : fallbackPlatform,
                genres: filtersArg.genres ?? [],
                downloadSourceFingerprints:
                  filtersArg.downloadSourceFingerprints ?? [],
                developers: filtersArg.developers ?? [],
                publishers: filtersArg.publishers ?? [],
                take,
                skip: offset,
                downloadSourceIds: sources.map((s) => s.id),
              }
            : {
                ...filtersArg,
                take,
                skip: offset,
                downloadSourceIds: sources.map((s) => s.id),
              };

        const response = await window.electron.hydraApi.post<{
          edges: CatalogueSearchResult[];
          count: number;
        }>("/catalogue/search", {
          data: requestData,
          needsAuth: false,
        });

        if (abortController.signal.aborted) return;

        setResults(response.edges || []);
        setResultsMode(activeMode);
        setItemsCount(response.count || 0);

        globalCachedResults = response.edges || [];
        globalCachedCount = response.count || 0;
        globalCachedPage = page;
        globalCachedKey = JSON.stringify({
          filtersArg,
          sources,
          take,
          offset,
          activeMode,
        });
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error(err);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [page, launchboxFilters.platforms]
  );

  const decodeHTML = (s: string) =>
    s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

  useEffect(() => {
    setResults([]);
    setIsLoading(true);
  }, [mode]);

  useEffect(() => {
    const key = JSON.stringify({
      filtersArg: filters,
      sources: downloadSources,
      take: pageSize,
      offset: (page - 1) * pageSize,
      activeMode: mode,
    });
    if (globalCachedKey === key && globalCachedResults !== null) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    abortControllerRef.current?.abort();
    searchCatalogue(
      filters,
      downloadSources,
      pageSize,
      (page - 1) * pageSize,
      mode
    );

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [filters, downloadSources, page, pageSize, mode, searchCatalogue]);

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

  const sections = useMemo(() => {
    if (hasActiveFilters) return [];
    const inLibraryIds = new Set(library.map((l) => l.objectId));
    const notInLibrary = results.filter((g) => !inLibraryIds.has(g.objectId));
    const destaques = dailyShuffled.slice(0, SECTION_SIZE);
    const populares = results.slice(SECTION_SIZE, SECTION_SIZE * 2);
    const recomendados = notInLibrary.slice(0, SECTION_SIZE);

    return [
      { title: "Destaques do Dia", games: destaques },
      { title: "Mais Populares", games: populares },
      { title: "Recomendados para Você", games: recomendados },
    ].filter((s) => s.games.length > 0);
  }, [results, hasActiveFilters, dailyShuffled, library]);

  const featuredGames = useMemo(() => results.slice(0, 13), [results]);

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
            <FeaturedCarousel games={isLoading ? [] : featuredGames} />
            {sections.map((s) => (
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
            <TopSellers games={results} isLoading={isLoading} />
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
            {resultsMode === "classics"
              ? results.map((game) => (
                  <GameItemClassics key={game.id} game={game} />
                ))
              : results.map((game) => <GameItem key={game.id} game={game} />)}

            {isLoading && results.length === 0 && (
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
